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

const DEFAULT_INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";

/**
 * OpenTelemetry instrumentation plugin for durable executions.
 *
 * Implements the DurableInstrumentationPlugin interface. The Workflow span joins
 * the execution trace by parenting onto the resolved execution ancestor (a
 * propagated remote parent or a synthetic execution root) and roots the
 * operation spans, so the whole execution shares one trace. Operation span
 * export is deferred, and the per-invocation Invocation span is a correlation
 * sibling (linked from, not a parent of, the operation spans).
 */
export class ExecutionOtelPlugin implements DurableInstrumentationPlugin {
  // Shared utilities (reused from existing package)
  private idGenerator: DeterministicIdGenerator;
  private readonly contextExtractor: ContextExtractor;

  // TracerProvider (global or application-owned)
  private tracerProvider: TracerProvider;
  private tracer: Tracer;
  private readonly instrumentationName: string;

  // Per-invocation state
  private workflowSpan: Span | undefined;
  private invocationSpan: Span | undefined;
  private spanMap: Map<string, Span>;
  private executionArn: string;
  private executionTraceId: string;
  private executionSamplingDecision: SamplingDecision;

  private readonly usesGlobalProvider: boolean;
  private globalIdGeneratorInstalled: boolean;
  private durableSampler: DurableSampler | undefined;
  private tracingEnabled = false;

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
    this.executionSamplingDecision = execTraceContext.samplingDecision;

    // 4. Derive the workflow span ID from execution ARN
    const workflowSpanId = deriveWorkflowSpanId(info.executionArn);

    // 5. Create the Workflow_Span parented onto the execution ancestor so it
    // joins the execution trace. Force the span ID only; the trace ID comes
    // from the parent. The override is scoped to this single startSpan call.
    const executionAncestorContext = trace.setSpanContext(
      ROOT_CONTEXT,
      execTraceContext.executionAncestor,
    );
    this.workflowSpan = this.idGenerator.withIds(
      {
        spanId: workflowSpanId,
      },
      () =>
        this.startSpan(
          this.workflowSpanName,
          {
            kind: SpanKind.INTERNAL,
            attributes: {
              "durable.execution.arn": info.executionArn,
            },
            startTime: info.executionStartTimestamp ?? new Date(),
          },
          executionAncestorContext,
        ),
    );

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

    // 2. Handle Workflow_Span based on terminal status
    if (info.status === "SUCCEEDED" || info.status === "FAILED") {
      // Terminal: set status attribute, map to span status, end (causes export).
      // PluginInvocationStatus only distinguishes SUCCEEDED/FAILED/PENDING/RETRYING,
      // so the plugin cannot tell whether a failed workflow was TIMED_OUT or STOPPED
      // — those are collapsed into FAILED -> ERROR here.
      if (this.workflowSpan) {
        this.workflowSpan.setAttribute("durable.execution.status", info.status);
        if (info.status === "FAILED") {
          this.workflowSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: info.executionError?.message ?? "Execution failed",
          });
        } else {
          this.workflowSpan.setStatus({ code: SpanStatusCode.OK });
        }
        this.workflowSpan.end();
      }
    }
    // Non-terminal (PENDING/RETRYING): do NOT end workflowSpan — just drop the reference.
    // Its status stays UNSET and the span is never exported (spans that are never
    // .end()'d are never exported by the OTel SDK).

    // 3. Discard open Operation_Spans without ending (they won't be exported)

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
    this.spanMap.clear();
    this.workflowSpan = undefined;
    this.invocationSpan = undefined;
    this.executionArn = "";
    this.executionTraceId = "";
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
    // Adopt the ambient span as the Invocation parent only when it is on the
    // execution trace AND carries the same sampled bit as the execution
    // ancestor. Matching the trace ID alone is not enough: if the ambient span's
    // sampled bit differs, the Invocation span would inherit the ambient
    // decision and could export after an explicit Sampled=0, or drop after the
    // root sampler chose sampled. On a mismatch, fall back to the execution
    // ancestor, which carries the authoritative decision.
    if (
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

    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );
    const spanName = info.name ?? info.type;

    // Resolve parent span: use parentId from map, or fall back to Workflow_Span
    let parentSpan: Span | undefined;
    if (info.parentId && this.spanMap.has(info.parentId)) {
      parentSpan = this.spanMap.get(info.parentId);
    } else {
      parentSpan = this.workflowSpan;
    }

    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    const attributes: Record<string, string> = {
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

    const links = this.buildInvocationLinks();

    // Always use a deterministic span ID regardless of replay status.
    const span = this.idGenerator.withIds(
      {
        traceId: this.executionTraceId,
        spanId: deterministicSpanId,
      },
      () =>
        this.startSpan(
          spanName,
          { attributes, startTime: info.startTimestamp, links },
          parentContext,
        ),
    );

    if (span) {
      this.spanMap.set(info.id, span);
    }
  }

  wrapChildContextFn(info: OperationInfo, fn: () => unknown): unknown {
    if (!this.tracingEnabled) {
      return fn();
    }

    const operationSpan = this.spanMap.get(info.id);

    if (!operationSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), operationSpan), fn);
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
    if (!this.tracingEnabled) {
      return;
    }

    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );

    if (this.spanMap.has(info.id)) {
      // Operation was started in this invocation
      const span = this.spanMap.get(info.id)!;

      // Set operation status attribute
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

      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
      } else if (info.status === "SUCCEEDED") {
        // Stamp explicit OK ONLY on a SUCCEEDED terminal status. Terminal
        // FAILURE statuses (TIMED_OUT/STOPPED/FAILED/CANCELLED) can arrive with
        // NO error object (callback-timeout, chained-invoke fast paths); those
        // must NOT be labelled OK, so they are left UNSET.
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end(info.endTimestamp);
      this.spanMap.delete(info.id);
    } else {
      // Cross-invocation: create span with deterministic ID, export immediately
      const spanName = info.name ?? info.type;

      // Resolve parent: use parentId from map, or fall back to Workflow_Span
      let parentSpan: Span | undefined;
      if (info.parentId && this.spanMap.has(info.parentId)) {
        parentSpan = this.spanMap.get(info.parentId);
      } else {
        parentSpan = this.workflowSpan;
      }

      const parentContext = parentSpan
        ? trace.setSpan(context.active(), parentSpan)
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

      const links = this.buildInvocationLinks();

      const span = this.idGenerator.withIds(
        {
          traceId: this.executionTraceId,
          spanId: deterministicSpanId,
        },
        () =>
          this.startSpan(
            spanName,
            { attributes, startTime: info.startTimestamp, links },
            parentContext,
          ),
      );

      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
      } else if (info.status === "SUCCEEDED") {
        // Stamp explicit OK ONLY on a SUCCEEDED terminal status. Terminal
        // FAILURE statuses (TIMED_OUT/STOPPED/FAILED/CANCELLED) can arrive with
        // NO error object on the cross-invocation fast paths; those must NOT be
        // labelled OK, so they are left UNSET.
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end(info.endTimestamp);
    }
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

    // Find the parent Operation_Span
    const parentSpan = this.spanMap.get(info.id);
    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

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
      attemptSpan.setAttribute("durable.attempt.outcome", info.outcome);
      if (info.outcome === "FAILED") {
        attemptSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error?.message ?? "Attempt failed",
        });
        if (info.error) {
          attemptSpan.recordException(info.error);
        }
      } else {
        // Non-failed attempt: stamp explicit OK (matches Python OTel #604).
        attemptSpan.setStatus({ code: SpanStatusCode.OK });
      }
      attemptSpan.end(info.endTimestamp);
      this.spanMap.delete(key);
    }
  }

  async onOperationChange(_info: OperationChangeInfo): Promise<void> {
    // No-op — same as InvocationOtelPlugin
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
