import type {
  DurableInstrumentationPlugin,
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
  OperationEndInfo,
  AttemptInfo,
  AttemptEndInfo,
  OperationChangeInfo,
} from "@aws/durable-execution-sdk-js";
import type { DurableExecutionInvocationOutput } from "@aws/durable-execution-sdk-js";
import type {
  TracerProvider,
  Tracer,
  Span,
  SpanContext,
  Context,
  Link,
} from "@opentelemetry/api";
import {
  context,
  isSpanContextValid,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
  TraceFlags,
} from "@opentelemetry/api";
import {
  DeterministicIdGenerator,
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import { xRayContextExtractor } from "./context-extractors";
import type { ContextExtractor } from "./context-extractors";
import {
  canonicalTraceId,
  resolveExecutionTraceContext,
  rootSamplingDecision,
} from "./execution-trace-context";
import type { OtelPluginConfig } from "./otel-plugin-config";
import { createTracerProvider } from "./otel-plugin-provider";
import { tryInstallGlobalIdGenerator } from "./global-id-generator";
import { DurableSampler, tryInstallDurableSampler } from "./global-sampler";
import { ExternalCompletions } from "./external-completions";

import { PLUGIN_REGISTRATION } from "./plugin-registration";

const DEFAULT_INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";

/**
 * OpenTelemetry instrumentation plugin for durable executions.
 *
 * Implements the DurableInstrumentationPlugin interface. The Workflow span joins
 * the execution trace by parenting onto the resolved execution ancestor (a
 * propagated remote parent or a synthetic execution root), so the whole
 * execution shares one trace. Operation spans parent onto the Workflow span and
 * the per-invocation Invocation span is a correlation sibling (linked from, not
 * a parent of, the operation spans). Both the Workflow span and each operation
 * span are deferred: their identity is carried as a non-recording context and
 * the single recording span is created and ended together at terminal /
 * onOperationEnd, so nothing is left un-ended across invocations (issue #831).
 */
export class ExecutionOtelPlugin implements DurableInstrumentationPlugin {
  private static readonly [PLUGIN_REGISTRATION] = {
    exclusiveGroup: "durable-opentelemetry-view",
  } as const;

  // Shared utilities (reused from existing package)
  private idGenerator: DeterministicIdGenerator;
  private readonly contextExtractor: ContextExtractor;

  // TracerProvider (global or application-owned)
  private tracerProvider: TracerProvider;
  private tracer: Tracer;
  private readonly instrumentationName: string;

  // Non-recording context carrying the deterministic Workflow identity; the real
  // span is created+ended once, at the terminal invocation (issue #831).
  private workflowSpan: Span | undefined;
  private invocationSpan: Span | undefined;
  // Holds only recording ATTEMPT spans; operation spans are deferred (see
  // operationContexts), never recording between start and end.
  private spanMap: Map<string, Span>;
  // Deterministic non-recording placeholders for in-flight operations; the real
  // span is created+ended once in onOperationEnd. Children/attempts parent onto it.
  private operationContexts: Map<string, SpanContext>;
  // Distinguish an immutable parent exported here from one skipped on replay.
  private readonly endedOperationIds = new Set<string>();
  // Naming/timing captured at start, reused when onOperationEnd omits them.
  private operationStarts: Map<
    string,
    { name?: string; subType?: string; startTimestamp?: Date }
  >;
  private executionArn: string;
  private executionTraceId: string;
  private executionTraceFlags: number = 0;
  private executionSamplingDecision: SamplingDecision;
  // The execution ancestor the terminal Workflow span parents onto, and the
  // backend execution start used to backdate it — both captured at invocation
  // start and reused when the real span is created at terminal.
  private executionAncestor: SpanContext | undefined;
  private executionStartTimestamp: Date | undefined;
  // Only a backend timestamp can define a retry-stable, zero-duration anchor.
  private syntheticRootAnchorTimestamp: Date | undefined;
  private syntheticRootMaterialized = false;

  private readonly usesGlobalProvider: boolean;
  private globalIdGeneratorInstalled: boolean;
  private durableSampler: DurableSampler | undefined;
  private tracingEnabled = false;
  private readonly externalCompletions = new ExternalCompletions();

  // Workflow span name (configurable)
  private readonly workflowSpanName: string;

  // Whether enrichLogContext() contributes trace context to log records
  private readonly enrichLogger: boolean;

  constructor(config?: OtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;
    this.instrumentationName = instrumentationName;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;
    this.workflowSpanName = config?.workflowSpanName ?? "Workflow";
    this.enrichLogger = config?.enrichLogger ?? true;

    const { tracerProvider, usesGlobalProvider } = createTracerProvider(
      config,
      this.idGenerator,
    );
    this.tracerProvider = tracerProvider;
    this.usesGlobalProvider = usesGlobalProvider;

    this.tracer = this.tracerProvider.getTracer(instrumentationName);
    this.durableSampler = tryInstallDurableSampler(this.tracer);
    this.globalIdGeneratorInstalled = !this.usesGlobalProvider;
    if (this.usesGlobalProvider) {
      const installedIdGenerator = tryInstallGlobalIdGenerator(this.tracer);
      if (installedIdGenerator) {
        this.idGenerator = installedIdGenerator;
        this.globalIdGeneratorInstalled = true;
      }
    }

    // Initialize per-invocation state
    this.spanMap = new Map();
    this.operationContexts = new Map();
    this.operationStarts = new Map();
    this.executionArn = "";
    this.executionTraceId = "";
    this.executionSamplingDecision = SamplingDecision.NOT_RECORD;
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    this.resetInvocationState();
    this.tracingEnabled = this.ensureGlobalIdGeneratorInstalled();
    if (!this.tracingEnabled) {
      return;
    }

    // 1. Store the execution ARN
    this.executionArn = info.executionArn;

    // 2. Extract trace context via context extractor (same as InvocationOtelPlugin)
    const extractedContext = this.contextExtractor(info);

    // 3. Resolve the one execution ancestor both spans parent onto, so they
    // share a trace and a sampling decision. The canonical trace ID is the
    // propagated remote trace when valid, else one derived from the ARN and
    // start time. The execution ancestor is a complete remote parent, else a
    // synthetic execution root. A live ambient span is not used as the ancestor
    // (its trace is not stable across reinvocations).
    const canonical = canonicalTraceId(
      extractedContext,
      info.executionArn,
      info.executionStartTimestamp,
    );
    const execTraceContext = resolveExecutionTraceContext(
      extractedContext,
      canonical,
      info.executionArn,
      () =>
        rootSamplingDecision(this.tracer, canonical, this.workflowSpanName, {
          "durable.execution.arn": info.executionArn,
        }),
    );
    this.executionTraceId = canonical;
    this.executionTraceFlags = execTraceContext.traceFlags;
    this.executionSamplingDecision = execTraceContext.samplingDecision;

    // 4. Derive the workflow span ID from execution ARN
    const workflowSpanId = deriveWorkflowSpanId(info.executionArn);

    // 5. Resolve the Workflow_Span identity as a NON-RECORDING context. A whole
    // execution spans many invocations, so only the terminal one can complete
    // the real span; carrying a real recording span across invocations would
    // leak it un-ended (issue #831), and ending one per invocation would export
    // duplicate (traceId, spanId). Operations parent onto this non-recording
    // context (a valid parent that stamps the right traceId/parentSpanId on its
    // children); the single real span is created and ended once, at the terminal
    // invocation (see onInvocationEnd), parented onto the execution ancestor. It
    // carries the execution sampled bit so a parent-based sampler stays
    // consistent with the eventual root.
    this.executionAncestor = execTraceContext.executionAncestor;
    // Snapshot the Date: another hook must not be able to alter a later copy
    // of this invocation's anchor by mutating the input object.
    this.syntheticRootAnchorTimestamp = info.executionStartTimestamp
      ? new Date(info.executionStartTimestamp.getTime())
      : undefined;
    this.executionStartTimestamp =
      this.syntheticRootAnchorTimestamp ?? new Date();
    this.workflowSpan = trace.wrapSpanContext({
      traceId: this.executionTraceId,
      spanId: workflowSpanId,
      traceFlags: execTraceContext.traceFlags,
      isRemote: false,
    });

    // 6. Create Invocation_Span parented onto the same-trace ambient span when
    // available, otherwise onto the execution ancestor so it stays within the
    // execution trace. Provider ownership must not change trace topology.
    const invocationParentContext = this.invocationParentContext(
      execTraceContext.executionAncestor,
      canonical,
    );

    const invocationAttributes: Record<string, string | number | boolean> = {
      "durable.execution.arn": info.executionArn,
      "durable.invocation.first": info.isFirstInvocation,
    };

    if (!this.usesGlobalProvider) {
      // Set cloud.resource_id from Lambda environment variables
      const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
      if (functionName) {
        const region = process.env.AWS_REGION;
        // Extract account ID from execution ARN (format: arn:aws:states:{region}:{account}:execution:{sm}:{exec})
        const arnParts = info.executionArn.split(":");
        const accountId = arnParts.length >= 5 ? arnParts[4] : undefined;

        if (region && accountId) {
          const version = process.env.AWS_LAMBDA_FUNCTION_VERSION;
          const resourceId = `arn:aws:lambda:${region}:${accountId}:function:${functionName}${version ? ":" + version : ""}`;
          invocationAttributes["cloud.resource_id"] = resourceId;
        } else {
          invocationAttributes["cloud.resource_id"] = functionName;
        }
      }

      // Set faas.max_memory if available
      const memorySize = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      if (memorySize) {
        const parsed = parseInt(memorySize, 10);
        if (!isNaN(parsed)) {
          invocationAttributes["faas.max_memory"] = parsed;
        }
      }
    }

    this.invocationSpan = this.startSpan(
      "Invocation",
      {
        kind: SpanKind.INTERNAL,
        attributes: invocationAttributes,
      },
      invocationParentContext,
    );
    this.externalCompletions.observe(info.updatedOperations, info.operations);

    // Each sampled invocation can recover an earlier undelivered anchor. An
    // opaque tracer retains terminal-only creation: without the sampler wrapper,
    // an early anchor would independently query its hidden sampler again.
    if (this.durableSampler && this.syntheticRootAnchorTimestamp) {
      this.createSyntheticRoot()?.end(this.syntheticRootAnchorTimestamp);
    }
  }

  wrapInvocation(
    _info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput> {
    if (!this.tracingEnabled || !this.workflowSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), this.workflowSpan), fn);
  }

  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      this.resetInvocationState();
      return;
    }

    // Prefer normal lifecycle hooks, which preserve live parent scopes. Before
    // returning, export any fresh completion the workflow did not reach. A
    // later resume may label it replay even though it has never been exported.
    const terminal = info.status === "SUCCEEDED" || info.status === "FAILED";
    for (const operation of this.externalCompletions.pending.values()) {
      // A terminal handler can abandon an unawaited child. Its still-open
      // placeholder will be discarded below, so it cannot parent this export.
      const parentId =
        (terminal &&
          operation.parentId &&
          this.operationContexts.has(operation.parentId)) ||
        this.hasAbandonedParent(operation.parentId, info.operations)
          ? undefined
          : operation.parentId;
      await this.onOperationEnd({ ...operation, parentId, isReplay: false });
    }
    // 1. Always end and export Invocation_Span
    if (this.invocationSpan) {
      this.invocationSpan.setAttribute(
        "durable.invocation.status",
        info.status,
      );

      // Map PluginInvocationStatus to span status:
      //   FAILED -> ERROR
      //   SUCCEEDED / PENDING -> OK (PENDING is a normal suspension, not an error)
      //   RETRYING -> UNSET. The plugin interface cannot distinguish a STOPPED or
      //   TIMED_OUT invocation from a RETRYING one at onInvocationEnd, so RETRYING
      //   is intentionally left UNSET rather than reported as ERROR.
      if (info.status === "FAILED") {
        this.invocationSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.executionError?.message ?? "Execution failed",
        });
      } else if (info.status === "SUCCEEDED" || info.status === "PENDING") {
        this.invocationSpan.setStatus({ code: SpanStatusCode.OK });
      }
      // RETRYING: leave status UNSET (default)

      this.invocationSpan.end();
    }

    // 2. Terminal invocation ONLY: create and end the one real Workflow_Span,
    // so a single span ever claims the deterministic (traceId, spanId) and no
    // span is left un-ended on a non-terminal invocation (issue #831). It is
    // parented onto the execution ancestor (the join-trace model) and backdated
    // to the execution start captured at invocation start. Skipped when the
    // execution decision was not sampled, so a dropped execution does not export
    // a lone root. PluginInvocationStatus collapses TIMED_OUT/STOPPED into
    // FAILED -> ERROR.
    if (
      this.executionSamplingDecision === SamplingDecision.RECORD_AND_SAMPLED &&
      this.executionAncestor &&
      (info.status === "SUCCEEDED" || info.status === "FAILED")
    ) {
      // Keep terminal-only fallback for providers without an early anchor.
      // An anchor already materialized in this invocation is not emitted twice.
      const syntheticRootSpan = this.createSyntheticRoot();

      const workflowSpanId = deriveWorkflowSpanId(this.executionArn);
      const executionAncestorContext = trace.setSpanContext(
        ROOT_CONTEXT,
        this.executionAncestor,
      );
      const workflowSpan = this.idGenerator.withIds(
        { spanId: workflowSpanId },
        () =>
          this.startSpan(
            this.workflowSpanName,
            {
              kind: SpanKind.INTERNAL,
              attributes: {
                "durable.execution.arn": this.executionArn,
              },
              startTime: this.executionStartTimestamp ?? new Date(),
            },
            executionAncestorContext,
          ),
      );
      workflowSpan.setAttribute("durable.execution.status", info.status);
      if (info.status === "FAILED") {
        workflowSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.executionError?.message ?? "Execution failed",
        });
      } else {
        workflowSpan.setStatus({ code: SpanStatusCode.OK });
      }
      workflowSpan.end();
      syntheticRootSpan?.end(this.syntheticRootAnchorTimestamp);
    }
    // PENDING/RETRYING never materializes Workflow. A sampled invocation may
    // already have ended its stable synthetic anchor before customer code ran.

    // 3. End any attempt span still open (safeguard against a leak on a
    // non-terminal invocation, issue #831). Operation placeholders have no
    // recording span and are dropped in resetInvocationState.
    for (const span of this.spanMap.values()) {
      if (span.isRecording()) {
        span.end();
      }
    }

    // 4. Always flush TracerProvider at invocation boundaries
    if ("forceFlush" in this.tracerProvider) {
      try {
        await (
          this.tracerProvider as { forceFlush: () => Promise<void> }
        ).forceFlush();
      } catch (e) {
        console.error(
          "[ExecutionOtelPlugin] forceFlush failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 5. Clear per-invocation state
    this.resetInvocationState();
  }

  /** Creates at most one SDK-owned root per invocation; the caller ends it. */
  private createSyntheticRoot(): Span | undefined {
    if (
      this.syntheticRootMaterialized ||
      this.executionSamplingDecision !== SamplingDecision.RECORD_AND_SAMPLED ||
      !this.executionAncestor ||
      this.executionAncestor.isRemote
    ) {
      return undefined;
    }

    const span = this.idGenerator.withIds(
      {
        traceId: this.executionTraceId,
        spanId: this.executionAncestor.spanId,
      },
      () =>
        this.startSpan(
          "DurableExecutionRoot",
          {
            kind: SpanKind.INTERNAL,
            attributes: {
              "durable.execution.synthetic_root": true,
              "durable.execution.arn": this.executionArn,
            },
            startTime:
              this.syntheticRootAnchorTimestamp ??
              this.executionStartTimestamp ??
              new Date(),
          },
          ROOT_CONTEXT,
        ),
    );
    this.syntheticRootMaterialized = true;
    return span;
  }

  private ensureGlobalIdGeneratorInstalled(): boolean {
    if (!this.usesGlobalProvider || this.globalIdGeneratorInstalled) {
      return true;
    }

    // A plugin constructed before zero-code instrumentation is registered sees
    // a ProxyTracer without the SDK's ID generator. Resolve the global provider
    // again at invocation start, after preload initialization has completed.
    this.tracerProvider = trace.getTracerProvider();
    this.tracer = this.tracerProvider.getTracer(this.instrumentationName);
    this.durableSampler = tryInstallDurableSampler(this.tracer);

    const installedIdGenerator = tryInstallGlobalIdGenerator(this.tracer);
    if (installedIdGenerator) {
      this.idGenerator = installedIdGenerator;
      this.globalIdGeneratorInstalled = true;
      return true;
    }

    console.warn(
      "[ExecutionOtelPlugin] Expected a compatible OpenTelemetry SDK tracer at invocation start; telemetry is disabled for this invocation. Ensure the OpenTelemetry SDK is configured before invocation start.",
    );
    return false;
  }

  private resetInvocationState(): void {
    this.externalCompletions.clear();
    this.spanMap.clear();
    this.operationContexts.clear();
    this.endedOperationIds.clear();
    this.operationStarts.clear();
    this.workflowSpan = undefined;
    this.invocationSpan = undefined;
    this.executionAncestor = undefined;
    this.executionStartTimestamp = undefined;
    this.syntheticRootAnchorTimestamp = undefined;
    this.syntheticRootMaterialized = false;
    this.executionArn = "";
    this.executionTraceId = "";
    this.executionTraceFlags = 0;
    this.executionSamplingDecision = SamplingDecision.NOT_RECORD;
    this.tracingEnabled = false;
  }

  private startSpan(
    name: string,
    options: Parameters<Tracer["startSpan"]>[1],
    parentContext: Parameters<Tracer["startSpan"]>[2],
  ): Span {
    const fn = () => this.tracer.startSpan(name, options, parentContext);
    return this.durableSampler
      ? this.durableSampler.withDecision(this.executionSamplingDecision, fn)
      : fn();
  }

  /**
   * The parent context for the Invocation span: the active ambient span when it
   * is already on the execution trace, otherwise the execution ancestor so the
   * Invocation span stays within the same trace.
   */
  private invocationParentContext(
    executionAncestor: SpanContext,
    canonical: string,
  ) {
    const activeContext = context.active();
    const ambient = trace.getSpanContext(activeContext);
    // Adopt the ambient span only in propagated-parent mode, when it is on
    // the execution trace AND carries the same sampled bit as the execution
    // ancestor. Synthetic fallback keeps Workflow and Invocation on the same
    // SDK-owned root. Matching the trace ID alone is not enough: if the ambient span's
    // sampled bit differs, the Invocation span would inherit the ambient
    // decision and could export after an explicit Sampled=0, or drop after the
    // root sampler chose sampled. On a mismatch, fall back to the execution
    // ancestor, which carries the authoritative decision.
    if (
      executionAncestor.isRemote &&
      ambient &&
      isSpanContextValid(ambient) &&
      ambient.traceId === canonical &&
      (ambient.traceFlags & TraceFlags.SAMPLED) ===
        (executionAncestor.traceFlags & TraceFlags.SAMPLED)
    ) {
      return activeContext;
    }
    return trace.setSpanContext(ROOT_CONTEXT, executionAncestor);
  }

  /**
   * Builds span links to the invocation span for child spans.
   *
   * Always links to the plugin-created Invocation_Span (this.invocationSpan),
   * which is created in both default-provider and non-default modes.
   */
  private buildInvocationLinks(): Link[] {
    if (this.invocationSpan) {
      return [{ context: this.invocationSpan.spanContext() }];
    }
    return [];
  }

  async onOperationStart(info: OperationInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    // Defer the span: store only a deterministic non-recording placeholder that
    // children/attempts parent onto; the real span is created in onOperationEnd.
    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );
    this.operationContexts.set(info.id, {
      traceId: this.executionTraceId,
      spanId: deterministicSpanId,
      traceFlags: this.executionTraceFlags,
      isRemote: false,
    });

    // Retain naming/timing for onOperationEnd, which may omit them. New
    // operations can reach this hook before the checkpoint response supplies a
    // backend start timestamp, so capture the hook time as the fallback. Keep
    // the earliest observation if the same operation starts again on replay.
    const existingStart = this.operationStarts.get(info.id);
    const observedStart = info.startTimestamp ?? new Date();
    this.operationStarts.set(info.id, {
      name: info.name ?? existingStart?.name,
      subType: info.subType ?? existingStart?.subType,
      startTimestamp: this.earliestStart(
        existingStart?.startTimestamp,
        observedStart,
      ),
    });
  }

  wrapChildContextFn(info: OperationInfo, fn: () => unknown): unknown {
    if (!this.tracingEnabled) {
      return fn();
    }

    // Make the operation's placeholder current so nested calls become its children.
    const operationContext = this.operationContexts.get(info.id);
    if (!operationContext) {
      return fn();
    }
    return context.with(
      trace.setSpanContext(context.active(), operationContext),
      fn,
    );
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    // A queued external completion can precede its live context's end even
    // when traversal never awaited it. Export it while that parent is open.
    if (info.type === "CONTEXT" && !info.isReplay) {
      for (const child of this.externalCompletions.pending.values()) {
        if (child.parentId === info.id) {
          await this.onOperationEnd({ ...child, isReplay: false });
        }
      }
    }

    // Release placeholders even when this is a previously observed completion.
    const started = this.operationStarts.get(info.id);
    this.operationContexts.delete(info.id);
    this.operationStarts.delete(info.id);

    // Updates and traversal can report the same completion in either order.
    // The set is reset each invocation so failed-invocation redelivery remains
    // eligible, while normal replay never exports a completion a second time.
    if (this.externalCompletions.shouldSkip(info)) {
      return;
    }

    // The end event may omit name/subType; fall back to what start captured.
    const name = info.name ?? started?.name;
    const subType = info.subType ?? started?.subType;

    const spanName = name ?? info.type;
    const parentContext = this.resolveOperationParentContext(info.parentId);

    const attributes: Record<string, string | number> = {
      "durable.execution.arn": this.executionArn,
      "durable.operation.id": info.id,
      "durable.operation.type": info.type,
    };
    if (name) {
      attributes["durable.operation.name"] = name;
    }
    if (subType) {
      attributes["durable.operation.subtype"] = subType;
    }
    if (info.status) {
      attributes["durable.operation.status"] = info.status;
    }
    // durable.attempt.number for retriable operations (STEP, WAIT_FOR_CONDITION).
    if (
      (info.type === "STEP" || subType === "WAIT_FOR_CONDITION") &&
      info.attempt != null
    ) {
      attributes["durable.attempt.number"] = info.attempt;
    }

    const links = this.buildInvocationLinks();

    // Earliest known start, so the span never begins after its own attempt/child
    // spans (created earlier at start).
    const startTime = this.earliestStart(
      started?.startTimestamp,
      info.startTimestamp,
    );

    const operationSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );
    const span = this.idGenerator.withIds(
      {
        traceId: this.executionTraceId,
        spanId: operationSpanId,
      },
      () =>
        this.startSpan(
          spanName,
          { attributes, startTime, links },
          parentContext,
        ),
    );

    // Preserve the backend completion on both the exception and the span end.
    // When absent, use the tracer's existing default timestamp behavior.
    const endTime = info.endTimestamp;
    if (info.error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: info.error.message,
      });
      span.recordException(info.error, endTime);
    } else if (info.status === "SUCCEEDED") {
      // Stamp explicit OK ONLY on a SUCCEEDED terminal status. Terminal
      // FAILURE statuses (TIMED_OUT/STOPPED/FAILED/CANCELLED) can arrive with
      // NO error object (callback-timeout, chained-invoke fast paths); those
      // must NOT be labelled OK, so they are left UNSET.
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end(endTime);
    this.endedOperationIds.add(info.id);
    this.externalCompletions.markExported(info);
  }

  /**
   * The parent context for an operation or attempt span: the parent operation's
   * deterministic identity, or the Workflow identity for a top-level operation.
   * A completion notification can arrive without traversing its parent in this
   * invocation (for example, a completed child context skipped during replay).
   * A parent ended in this invocation cannot contain a later completion; attach
   * that completion to Workflow instead of recreating its ended context.
   */
  private resolveOperationParentContext(parentId: string | undefined): Context {
    if (parentId && !this.endedOperationIds.has(parentId)) {
      const parentContext = this.operationContexts.get(parentId) ?? {
        traceId: this.executionTraceId,
        spanId: deriveSpanIdFromOperationId(parentId, this.executionArn),
        traceFlags: this.executionTraceFlags,
        isRemote: false,
      };
      return trace.setSpanContext(context.active(), parentContext);
    }
    const workflowContext = this.workflowSpan?.spanContext();
    if (workflowContext) {
      return trace.setSpanContext(context.active(), workflowContext);
    }
    return context.active();
  }

  private hasAbandonedParent(
    parentId: string | undefined,
    operations: Record<string, OperationInfo> = {},
  ): boolean {
    const parent = parentId ? operations[parentId] : undefined;
    if (
      parent?.type !== "CONTEXT" ||
      !["STARTED", "READY", "PENDING"].includes(parent.status ?? "")
    )
      return false;

    // Replay skips a completed context and all of its body. An unfinished
    // descendant below it cannot later materialize its execution-view span.
    const visited = new Set([parent.id]);
    let ancestorId = parent.parentId;
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId);
      const ancestor = operations[ancestorId];
      if (ancestor?.type !== "CONTEXT") return false;
      if (
        ["SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED", "CANCELLED"].includes(
          ancestor.status ?? "",
        )
      )
        return true;
      ancestorId = ancestor.parentId;
    }
    return false;
  }

  private earliestStart(
    a: Date | undefined,
    b: Date | undefined,
  ): Date | undefined {
    if (!a) {
      return b;
    }
    if (!b) {
      return a;
    }
    return a.getTime() <= b.getTime() ? a : b;
  }

  private getAttemptKey(id: string, attempt: number): string {
    return `${id}:attempt:${attempt}`;
  }

  async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    const baseName = info.name ?? info.type;
    const spanName = `${baseName} attempt ${info.attempt}`;

    // Parent onto the operation's placeholder (the operation span is deferred).
    const parentContext = this.resolveOperationParentContext(info.id);

    const attributes: Record<string, string | number> = {
      "durable.execution.arn": this.executionArn,
      "durable.operation.id": info.id,
      "durable.operation.type": info.type,
      "durable.attempt.number": info.attempt,
    };
    if (info.name) {
      attributes["durable.operation.name"] = info.name;
    }
    if (info.subType) {
      attributes["durable.operation.subtype"] = info.subType;
    }

    const links = this.buildInvocationLinks();

    const attemptSpan = this.startSpan(
      spanName,
      {
        attributes,
        startTime: info.startTimestamp,
        links,
      },
      parentContext,
    );

    this.spanMap.set(this.getAttemptKey(info.id, info.attempt), attemptSpan);
  }

  wrapOperationAttemptFn(info: AttemptInfo, fn: () => unknown): unknown {
    if (!this.tracingEnabled) {
      return fn();
    }

    const attemptSpan = this.spanMap.get(
      this.getAttemptKey(info.id, info.attempt),
    );
    if (!attemptSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), attemptSpan), fn);
  }

  async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    const key = this.getAttemptKey(info.id, info.attempt);
    const attemptSpan = this.spanMap.get(key);
    if (attemptSpan) {
      const endTime = info.endTimestamp;
      attemptSpan.setAttribute("durable.attempt.outcome", info.outcome);
      if (info.outcome === "FAILED") {
        attemptSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error?.message ?? "Attempt failed",
        });
        if (info.error) {
          attemptSpan.recordException(info.error, endTime);
        }
      } else {
        // Non-failed attempt: stamp explicit OK (matches Python OTel #604).
        attemptSpan.setStatus({ code: SpanStatusCode.OK });
      }
      attemptSpan.end(endTime);
      this.spanMap.delete(key);
    }
  }

  async onOperationChange(info: OperationChangeInfo): Promise<void> {
    if (this.tracingEnabled) {
      this.externalCompletions.observe(info.updatedOperations, info.operations);
    }
  }

  enrichLogContext(): Record<string, string | number | boolean> | undefined {
    if (!this.tracingEnabled || !this.enrichLogger) {
      return undefined;
    }
    const span = trace.getSpan(context.active());
    if (!span) {
      return undefined;
    }
    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      otelTraceSampled: (spanContext.traceFlags & 1) !== 0,
    };
  }
}
