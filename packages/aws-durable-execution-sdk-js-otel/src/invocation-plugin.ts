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
  Link,
  HrTime,
} from "@opentelemetry/api";
import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
  isSpanContextValid,
  TraceFlags,
} from "@opentelemetry/api";
import {
  captureInvocationClock,
  readInvocationClock,
  type InvocationClock,
} from "./invocation-clock";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import {
  DeterministicIdGenerator,
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
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
 * Implements the DurableInstrumentationPlugin interface to emit distributed
 * traces that correlate across multiple Lambda invocations of a single
 * durable execution.
 */
export class InvocationOtelPlugin implements DurableInstrumentationPlugin {
  private static readonly [PLUGIN_REGISTRATION] = {
    exclusiveGroup: "durable-opentelemetry-view",
  } as const;

  private tracerProvider: TracerProvider;
  private tracer: Tracer;
  private idGenerator: DeterministicIdGenerator;
  private readonly contextExtractor: ContextExtractor;
  private readonly instrumentationName: string;
  private readonly usesGlobalProvider: boolean;
  private globalIdGeneratorInstalled: boolean;
  private durableSampler: DurableSampler | undefined;
  private tracingEnabled = false;
  private readonly externalCompletions = new ExternalCompletions();
  private readonly workflowSpanName: string;
  private readonly enrichLogger: boolean;

  // Per-invocation state
  private invocationClock: InvocationClock | undefined;
  private spanMap: Map<string, Span> = new Map();
  private spanStack: Span[] = [];
  private invocationSpan: Span | undefined;
  // workflowSpan is a NON-RECORDING context carrying the deterministic Workflow
  // identity for links; the one real recording span is created and ended only at
  // the terminal invocation (see onInvocationEnd), so a Workflow span that spans
  // many invocations is never left un-ended (issue #831).
  private workflowSpan: Span | undefined;
  // The execution ancestor the terminal Workflow span parents onto. Resolved at
  // invocation start and reused when the real span is created at terminal.
  private executionAncestor: SpanContext | undefined;
  // The backend execution start, captured at invocation start so the terminal
  // Workflow span can be backdated to it; the now() fallback is taken here (not
  // at onInvocationEnd, where it would land after the span's own end time).
  private executionStartTimestamp: Date | undefined;
  // Only a backend timestamp can define a retry-stable, zero-duration anchor.
  private syntheticRootAnchorTimestamp: Date | undefined;
  private syntheticRootMaterialized = false;
  private executionArn: string = "";
  private executionTraceId: string = "";
  private executionTraceFlags: number = 0;
  private executionSamplingDecision: SamplingDecision =
    SamplingDecision.NOT_RECORD;

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
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    this.resetInvocationState();
    this.tracingEnabled = this.ensureGlobalIdGeneratorInstalled();
    if (!this.tracingEnabled) {
      return;
    }

    // Match the epoch/elapsed-time model of an ordinary OTel span, but share
    // this anchor across all live spans in the invocation. Never use the
    // process timeOrigin: it can differ from the current wall-clock epoch.
    this.invocationClock = captureInvocationClock();

    // 1. Store the execution ARN
    this.executionArn = info.executionArn;

    // 2. Invoke the context extractor
    const extractedContext = this.contextExtractor(info);

    // 3. Resolve the one execution ancestor both the Workflow and Invocation
    // spans parent onto so they share a single execution trace. The canonical
    // trace ID is the propagated remote trace when valid, else one derived from
    // the ARN and start time. The execution ancestor is a complete remote
    // parent, else a synthetic execution root. A live ambient span is not used
    // as the ancestor (its trace is not stable across reinvocations); the
    // Invocation span may still parent onto a same-trace ambient span below.
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

    // 4. Resolve the Workflow span identity as a NON-RECORDING context.
    //
    // The Workflow span joins the execution trace (parented onto the execution
    // ancestor) with a deterministic span ID derived from the ARN, so every
    // invocation of the same durable execution shares one root. But a single
    // execution spans many invocations, so only the terminal one can complete
    // it: carrying a real recording span across invocations would leak it
    // un-ended (issue #831), and ending one per invocation would export
    // duplicate (traceId, spanId). Its identity is therefore carried by a
    // non-recording context here — operation and attempt spans link to it (see
    // workflowLinks) while staying parented to the per-invocation span — and the
    // single real span is created and ended once, at the terminal invocation
    // (see onInvocationEnd). It carries the execution sampled bit so a
    // parent-based sampler stays consistent with the eventual root.
    const workflowSpanId = deriveWorkflowSpanId(info.executionArn);
    this.executionAncestor = execTraceContext.executionAncestor;
    // Snapshot the Date: another hook must not be able to alter a later copy
    // of this invocation's anchor by mutating the input object.
    this.syntheticRootAnchorTimestamp = info.executionStartTimestamp
      ? new Date(info.executionStartTimestamp.getTime())
      : undefined;
    this.executionStartTimestamp =
      this.syntheticRootAnchorTimestamp ??
      new Date(this.invocationClock.epochMillis);
    this.workflowSpan = trace.wrapSpanContext({
      traceId: this.executionTraceId,
      spanId: workflowSpanId,
      traceFlags: this.executionTraceFlags,
      isRemote: false,
    });

    // 5. Create the invocation span parented onto the same-trace ambient span
    //    when available (under ADOT/X-Ray the active context at
    //    onInvocationStart is the Lambda execution-environment span), otherwise
    //    onto the execution ancestor so it stays within the execution trace.
    //    The invocation span is intentionally NOT a child of the Workflow span:
    //    this plugin stays invocation-rooted. Execution-scoped correlation to
    //    the Workflow span is expressed via links on the operation/attempt
    //    spans (see onOperationStart / onOperationAttemptStart), matching the
    //    Java and Python reference plugins.
    const invocationParentContext = this.invocationParentContext(
      execTraceContext.executionAncestor,
      canonical,
    );

    this.invocationSpan = this.startSpan(
      "Invocation",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "durable.execution.arn": info.executionArn,
          "durable.invocation.first": info.isFirstInvocation,
        },
        startTime: this.liveTimestamp(),
      },
      invocationParentContext,
    );
    this.externalCompletions.observe(info.updatedOperations);

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
    if (!this.tracingEnabled || !this.invocationSpan) {
      return fn();
    }
    return context.with(
      trace.setSpan(context.active(), this.invocationSpan),
      fn,
    );
  }

  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      this.resetInvocationState();
      return;
    }

    // Prefer normal lifecycle hooks, which preserve live parent scopes. Before
    // returning, export any fresh completion the workflow did not reach. A
    // later resume may label it replay even though it has never been exported.
    for (const operation of this.externalCompletions.pending.values()) {
      await this.onOperationEnd({ ...operation, isReplay: false });
    }

    const endTime = this.liveTimestamp();

    // 1. End all spans in the stack in reverse order
    while (this.spanStack.length > 0) {
      const span = this.spanStack.pop()!;
      span.end(endTime);
    }

    // 1b. End any still-recording span left in spanMap (attempt spans, which are
    // not on the stack; operation spans were unwound above). Safeguard against a
    // leak on a non-terminal invocation (issue #831). isRecording() skips spans
    // already ended by the stack unwind.
    for (const span of this.spanMap.values()) {
      if (span.isRecording()) {
        span.end(endTime);
      }
    }

    // 2. End the invocation span if it exists
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

      this.invocationSpan.end(endTime);
    }

    // 3. Terminal invocation ONLY: create and end the one real Workflow span,
    //    so a single span ever claims the deterministic (traceId, spanId) and no
    //    span is left un-ended on a non-terminal invocation (issue #831). It is
    //    parented onto the execution ancestor (the join-trace model) and
    //    backdated to the execution start captured at invocation start. Skipped
    //    when the execution decision was not sampled, so a dropped execution
    //    does not export a lone root. PluginInvocationStatus collapses
    //    TIMED_OUT/STOPPED into FAILED -> ERROR.
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
      workflowSpan.end(endTime);
      syntheticRootSpan?.end(this.syntheticRootAnchorTimestamp ?? endTime);
    }
    // PENDING/RETRYING never materializes Workflow. A sampled invocation may
    // already have ended its stable synthetic anchor before customer code ran.

    // 4. Force flush the tracer provider
    if ("forceFlush" in this.tracerProvider) {
      try {
        await (
          this.tracerProvider as { forceFlush: () => Promise<void> }
        ).forceFlush();
      } catch {
        // Gracefully handle flush errors
      }
    }

    // 5. Clear all per-invocation state
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
      "[InvocationOtelPlugin] Expected a compatible OpenTelemetry SDK tracer at invocation start; telemetry is disabled for this invocation. Ensure the OpenTelemetry SDK is configured before invocation start.",
    );
    return false;
  }

  private liveTimestamp(): HrTime {
    return readInvocationClock(this.invocationClock!);
  }

  private resetInvocationState(): void {
    this.externalCompletions.clear();
    this.invocationClock = undefined;
    this.spanMap.clear();
    this.spanStack = [];
    this.invocationSpan = undefined;
    this.workflowSpan = undefined;
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
   * is on the execution trace, otherwise the execution ancestor so the
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
   * A link to the initial logical operation span, whose span ID is
   * deterministic on (executionArn, operationId) and lives on the execution
   * trace. A continuation or replay segment carries this link so the segments
   * of one logical operation stay correlated across invocations.
   *
   * Because the initial operation span's ID is reproducible, this restores the
   * cross-invocation link that was previously dropped as "fabricated" — it now
   * targets a genuinely exported span (open operation spans are ended on
   * non-terminal invocations; see onInvocationEnd).
   */
  private initialOperationLink(operationId: string): Link | undefined {
    if (!this.executionTraceId) {
      return undefined;
    }
    const initialContext: SpanContext = {
      traceId: this.executionTraceId,
      spanId: deriveSpanIdFromOperationId(operationId, this.executionArn),
      traceFlags: this.executionTraceFlags,
      isRemote: false,
    };
    return { context: initialContext };
  }

  async onOperationStart(info: OperationInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    // Same-invocation replay of an operation we already started: the span
    // already exists (e.g. a child context that is replayed after an internal
    // step retry, or a retried step). Reuse it rather than emitting a duplicate
    // span — the existing span is finalized at onOperationEnd. A genuine
    // cross-invocation continuation has no span in the map and still creates
    // its link span below.
    if (info.isReplay && this.spanMap.has(info.id)) {
      return;
    }

    // All live spans use the invocation's wall-anchored monotonic clock, so
    // wall-clock adjustments cannot collapse or inflate their durations.
    // Invocation cleanup shares one end time for open spans. Durable timestamps
    // can predate this invocation and are used only for the backdated Workflow
    // and synthetic execution root starts.
    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );
    const spanName = info.name ?? info.type;

    // Resolve parent span: use parentId from map, or fall back to invocation span
    let parentSpan: Span | undefined;
    if (info.parentId && this.spanMap.has(info.parentId)) {
      parentSpan = this.spanMap.get(info.parentId);
    } else {
      parentSpan = this.invocationSpan;
    }

    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    const attributes: Record<string, string> = {
      "durable.execution.arn": this.executionArn,
      "durable.operation.id": info.id,
      "durable.operation.type": info.type,
      // Operations are STARTED when their span is created. Any operation that
      // reaches a terminal status this invocation (STEP / WAIT /
      // CHAINED_INVOKE / CALLBACK / CONTEXT) overwrites this with that terminal
      // status at onOperationEnd. Only operations that suspend and are not
      // resumed in this invocation keep STARTED.
      "durable.operation.status": "STARTED",
    };
    if (info.name) {
      attributes["durable.operation.name"] = info.name;
    }
    if (info.subType) {
      attributes["durable.operation.subtype"] = info.subType;
    }

    let span: Span | undefined;

    if (!info.isReplay) {
      // Non-replay: use deterministic span ID
      span = this.idGenerator.withIds(
        {
          traceId: this.executionTraceId,
          spanId: deterministicSpanId,
        },
        () =>
          this.startSpan(
            spanName,
            {
              attributes,
              links: this.workflowLinks(),
              startTime: this.liveTimestamp(),
            },
            parentContext,
          ),
      );
    } else if (info.type === "CONTEXT" || info.type === "STEP") {
      // This replay segment is a distinct span of an operation whose initial
      // span ran in an earlier invocation. It uses a new (random) span ID, links
      // to the reproducible Workflow span, and links back to the initial logical
      // operation span (deterministic on the execution trace) so the segments
      // stay correlated across invocations.
      span = this.startSpan(
        spanName,
        {
          attributes,
          links: this.replayLinks(info.id),
          startTime: this.liveTimestamp(),
        },
        parentContext,
      );
    }

    // Push to map and stack
    if (span != null) {
      this.spanMap.set(info.id, span);
      this.spanStack.push(span);
    }
  }

  wrapChildContextFn(info: OperationInfo, fn: () => unknown): unknown {
    if (!this.tracingEnabled) {
      return fn();
    }

    const span = this.spanMap.get(info.id);
    if (!span) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), span), fn);
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    // Updates and traversal can report the same completion in either order.
    // The set is reset each invocation so failed-invocation redelivery remains
    // eligible, while normal replay never exports a completion a second time.
    if (this.externalCompletions.shouldSkip(info)) {
      return;
    }

    if (this.spanMap.has(info.id)) {
      // Operation was started in this invocation
      const span = this.spanMap.get(info.id)!;

      // Finalize the operation status from the core-supplied terminal status.
      // Container CONTEXT ops receive a terminal status from the core too:
      // run-in-child-context-handler passes SUCCEEDED/FAILED on both the
      // virtual and non-virtual paths (parallel/map containers route through
      // the same handler). Operations that suspend never reach here this
      // invocation and keep the STARTED stamped at span start.
      if (info.status) {
        span.setAttribute("durable.operation.status", info.status);
      }

      // Set durable.attempt.number for STEP and WAIT_FOR_CONDITION operations
      if (
        (info.type === "STEP" || info.subType === "WAIT_FOR_CONDITION") &&
        info.attempt != null
      ) {
        span.setAttribute("durable.attempt.number", info.attempt);
      }

      // Record error if present; otherwise stamp explicit OK ONLY on a
      // SUCCEEDED terminal status (matches Python OTel plugin #604). Only
      // reached for operations that terminate this invocation — suspended ops
      // early-return above and keep their STARTED status UNSET. Terminal
      // FAILURE statuses (TIMED_OUT/STOPPED/FAILED/CANCELLED) can arrive with
      // NO error object (callback-timeout, chained-invoke fast paths); those
      // must NOT be labelled OK, so they are left UNSET.
      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error, this.liveTimestamp());
      } else if (info.status === "SUCCEEDED") {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // End the span
      span.end(this.liveTimestamp());

      // Remove from map
      this.spanMap.delete(info.id);

      // Remove from stack (find by reference)
      const stackIndex = this.spanStack.indexOf(span);
      if (stackIndex !== -1) {
        this.spanStack.splice(stackIndex, 1);
      }
    } else if (
      !info.isReplay ||
      this.externalCompletions.pending.has(info.id)
    ) {
      // A fresh checkpoint completion can be replay-marked: updated IDs were
      // captured before this invocation received the update. Export it while
      // its child parent is still active, without changing the SDK's info.
      // Operation was started in a prior invocation — create Continuation_Span
      const spanName = info.name ?? info.type;

      // Resolve parent span: use parentId from map (e.g. the CONTEXT span for
      // child operations inside waitForCallback), or fall back to invocation span.
      let continuationParentSpan: Span | undefined;
      if (info.parentId && this.spanMap.has(info.parentId)) {
        continuationParentSpan = this.spanMap.get(info.parentId);
      } else {
        continuationParentSpan = this.invocationSpan;
      }

      const parentContext = continuationParentSpan
        ? trace.setSpan(context.active(), continuationParentSpan)
        : context.active();

      const attributes: Record<string, string | number> = {
        "durable.execution.arn": this.executionArn,
        "durable.operation.id": info.id,
        "durable.operation.type": info.type,
      };
      if (info.name) {
        attributes["durable.operation.name"] = info.name;
      }
      if (info.subType) {
        attributes["durable.operation.subtype"] = info.subType;
      }
      if (info.status) {
        attributes["durable.operation.status"] = info.status;
      }
      // Set durable.attempt.number for STEP and WAIT_FOR_CONDITION operations
      if (
        (info.type === "STEP" || info.subType === "WAIT_FOR_CONDITION") &&
        info.attempt != null
      ) {
        attributes["durable.attempt.number"] = info.attempt;
      }

      const continuationSpan = this.startSpan(
        spanName,
        {
          attributes,
          // This continuation segment completes an operation whose initial span
          // ran in an earlier invocation. It links to the reproducible Workflow
          // span and back to the initial logical operation span, whose ID is
          // deterministic on the execution trace, so the segments of one logical
          // operation stay correlated across invocations.
          links: this.replayLinks(info.id),
          startTime: this.liveTimestamp(),
        },
        parentContext,
      );

      // Record error if present; otherwise stamp explicit OK ONLY on a
      // SUCCEEDED terminal status (matches Python OTel plugin #604). This is
      // the terminal completion path for an operation started in a prior
      // invocation. Terminal FAILURE statuses can arrive with NO error object
      // (callback-timeout, chained-invoke 'already failed' cross-invocation
      // fast paths); those must NOT be labelled OK, so they are left UNSET.
      if (info.error) {
        continuationSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        continuationSpan.recordException(info.error, this.liveTimestamp());
      } else if (info.status === "SUCCEEDED") {
        continuationSpan.setStatus({ code: SpanStatusCode.OK });
      }

      // Immediately end
      continuationSpan.end(this.liveTimestamp());
    }
    this.externalCompletions.markExported(info);
  }

  async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    const baseName = info.name ?? info.type;
    const spanName = `${baseName} attempt ${info.attempt}`;

    // Find the parent Operation_Span for this operation
    const parentSpan = this.spanMap.get(info.id);
    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    const attributes: Record<string, string | number> = {
      "durable.execution.arn": this.executionArn,
      "durable.operation.id": info.id,
      "durable.operation.type": info.type,
      "durable.attempt.number": info.attempt,
      // Attempt spans do NOT carry durable.operation.status; the attempt's
      // success/failure is carried solely by durable.attempt.outcome (set at
      // onOperationAttemptEnd).
    };
    if (info.name) {
      attributes["durable.operation.name"] = info.name;
    }
    if (info.subType) {
      attributes["durable.operation.subtype"] = info.subType;
    }

    const attemptSpan = this.startSpan(
      spanName,
      {
        attributes,
        startTime: this.liveTimestamp(),
      },
      parentContext,
    );

    this.spanMap.set(this.attemptSpanKey(info.id, info.attempt), attemptSpan);
  }

  wrapOperationAttemptFn(info: AttemptInfo, fn: () => unknown): unknown {
    if (!this.tracingEnabled) {
      return fn();
    }

    const attemptSpan = this.spanMap.get(
      this.attemptSpanKey(info.id, info.attempt),
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

    const key = this.attemptSpanKey(info.id, info.attempt);
    const attemptSpan = this.spanMap.get(key);
    if (attemptSpan) {
      attemptSpan.addLinks(this.workflowLinks());
      attemptSpan.setAttribute("durable.attempt.outcome", info.outcome);
      if (info.outcome === "FAILED") {
        attemptSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error?.message ?? "Attempt failed",
        });
        if (info.error) {
          attemptSpan.recordException(info.error, this.liveTimestamp());
        }
      } else {
        // Non-failed attempt: stamp explicit OK (matches Python OTel #604).
        attemptSpan.setStatus({ code: SpanStatusCode.OK });
      }
      attemptSpan.end(this.liveTimestamp());
      this.spanMap.delete(key);
    }
  }

  async onOperationChange(info: OperationChangeInfo): Promise<void> {
    if (this.tracingEnabled) {
      this.externalCompletions.observe(info.updatedOperations);
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

  /**
   * Link(s) to the execution-scoped Workflow span. Operation and attempt spans
   * carry this link so they correlate to the one Workflow span for the durable
   * execution while remaining parented to the invocation/operation hierarchy.
   * The invocation span itself does NOT carry this link. Returns an empty array
   * if the Workflow span was not created.
   */
  private workflowLinks(): Link[] {
    const workflowContext: SpanContext | undefined =
      this.workflowSpan?.spanContext();
    return workflowContext ? [{ context: workflowContext }] : [];
  }

  /**
   * Links for a continuation or replay operation span: a link back to the
   * initial logical operation span (deterministic on the execution trace)
   * FIRST, then the Workflow link, so the links are ordered
   * `[operation, Workflow]`. Restores the cross-invocation operation
   * correlation that was previously dropped as "fabricated" — the initial span
   * ID is reproducible and the span is genuinely exported. The order matters:
   * the conformance contract resolves `links[0]` to the operation span (which
   * carries `durable.operation.id`) and `links[1]` to the Workflow span (which
   * carries `durable.execution.arn`).
   */
  private replayLinks(operationId: string): Link[] {
    const links: Link[] = [];
    const initialLink = this.initialOperationLink(operationId);
    if (initialLink) {
      links.push(initialLink);
    }
    links.push(...this.workflowLinks());
    return links;
  }

  private attemptSpanKey(operationId: string, attempt: number): string {
    return `attempt:${operationId}:${attempt}`;
  }
}
