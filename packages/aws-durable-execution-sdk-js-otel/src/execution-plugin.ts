import type {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
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
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import {
  canonicalTraceId,
  resolveExecutionTraceContext,
  rootSamplingDecision,
} from "./execution-trace-context";
import type { OtelPluginConfig } from "./otel-plugin-config";
import {
  createPluginFactory,
  OtelPluginEnvironment,
} from "./otel-plugin-environment";

const PLUGIN_NAME = "ExecutionOtelPlugin";

/**
 * OpenTelemetry instrumentation plugin for one durable execution invocation.
 *
 * Implements the DurableInstrumentationPlugin interface. The SDK builds one of
 * these per invocation, from that invocation's {@link InvocationInfo}, and drops
 * it when the invocation returns — so every field below describes one execution
 * and no two executions sharing an execution environment (routine under Lambda
 * Managed Instances) can observe each other's spans or operation maps. What
 * outlives the invocation is the {@link OtelPluginEnvironment} it is handed.
 *
 * The Workflow span joins the execution trace by parenting onto the resolved
 * execution ancestor (a propagated remote parent or a synthetic execution root),
 * so the whole execution shares one trace. Operation spans parent onto the
 * Workflow span and the per-invocation Invocation span is a correlation sibling
 * (linked from, not a parent of, the operation spans). Both the Workflow span and
 * each operation span are deferred: their identity is carried as a non-recording
 * context and the single recording span is created and ended together at
 * terminal / onOperationEnd, so nothing is left un-ended across invocations
 * (issue #831).
 */
export class ExecutionOtelPlugin implements DurableInstrumentationPlugin {
  /** The execution this instance instruments, taken from the factory's info. */
  private readonly executionArn: string;
  /**
   * The backend-reported start of the whole execution, or undefined when it
   * reported none. Trace-ID derivation must see the reported value: deriving
   * from a fabricated one would change the trace ID.
   */
  private readonly reportedExecutionStart: Date | undefined;
  /**
   * What the terminal Workflow span is backdated to: the reported execution
   * start, or this instance's creation time. Taken here rather than at
   * onInvocationEnd, where `new Date()` would land after the span's own end time.
   */
  private readonly workflowStartTime: Date;

  // Non-recording context carrying the deterministic Workflow identity; the real
  // span is created+ended once, at the terminal invocation (issue #831).
  private workflowSpan: Span | undefined;
  private invocationSpan: Span | undefined;
  // Holds only recording ATTEMPT spans; operation spans are deferred (see
  // operationContexts), never recording between start and end.
  private readonly spanMap = new Map<string, Span>();
  // Deterministic non-recording placeholders for in-flight operations; the real
  // span is created+ended once in onOperationEnd. Children/attempts parent onto it.
  private readonly operationContexts = new Map<string, SpanContext>();
  // Naming/timing captured at start, reused when onOperationEnd omits them.
  private readonly operationStarts = new Map<
    string,
    { name?: string; subType?: string; startTimestamp?: Date }
  >();
  private executionTraceId = "";
  private executionTraceFlags: number = 0;
  private executionSamplingDecision: SamplingDecision =
    SamplingDecision.NOT_RECORD;
  // The execution ancestor the terminal Workflow span parents onto, captured at
  // invocation start and reused when the real span is created at terminal.
  private executionAncestor: SpanContext | undefined;

  private tracingEnabled = false;

  /**
   * @param environment - State that belongs to the execution environment: the
   * resolved tracer provider and tracer, the deterministic ID generator
   * installed on that tracer, the sampler wrapper, and the immutable
   * config-derived settings. Shared by every instance the factory creates, so
   * those resolutions and installations happen once no matter how many
   * invocations run.
   * @param info - The invocation this instance serves. It is the same object the
   * SDK then passes to {@link onInvocationStart}, so the instance knows which
   * execution it belongs to before its first hook fires.
   *
   * @internal Use {@link createExecutionOtelPluginFactory}; both parameters are
   * internal to this package.
   */
  constructor(
    private readonly environment: OtelPluginEnvironment,
    info: InvocationInfo,
  ) {
    this.executionArn = info.executionArn;
    this.reportedExecutionStart = info.executionStartTimestamp;
    this.workflowStartTime = info.executionStartTimestamp ?? new Date();
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    this.tracingEnabled = this.environment.ensureTracingEnabled(PLUGIN_NAME);
    if (!this.tracingEnabled) {
      return;
    }

    // 1. Extract trace context via context extractor (same as InvocationOtelPlugin)
    const extractedContext = this.environment.contextExtractor(info);

    // 2. Resolve the one execution ancestor both spans parent onto, so they
    // share a trace and a sampling decision. The canonical trace ID is the
    // propagated remote trace when valid, else one derived from the ARN and
    // start time. The execution ancestor is a complete remote parent, else a
    // synthetic execution root. A live ambient span is not used as the ancestor
    // (its trace is not stable across reinvocations).
    const canonical = canonicalTraceId(
      extractedContext,
      this.executionArn,
      this.reportedExecutionStart,
    );
    const execTraceContext = resolveExecutionTraceContext(
      extractedContext,
      canonical,
      this.executionArn,
      () =>
        rootSamplingDecision(
          this.environment.tracer,
          canonical,
          this.environment.workflowSpanName,
          {
            "durable.execution.arn": this.executionArn,
          },
        ),
    );
    this.executionTraceId = canonical;
    this.executionTraceFlags = execTraceContext.traceFlags;
    this.executionSamplingDecision = execTraceContext.samplingDecision;

    // 3. Derive the workflow span ID from execution ARN
    const workflowSpanId = deriveWorkflowSpanId(this.executionArn);

    // 4. Resolve the Workflow_Span identity as a NON-RECORDING context. A whole
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
    this.workflowSpan = trace.wrapSpanContext({
      traceId: this.executionTraceId,
      spanId: workflowSpanId,
      traceFlags: execTraceContext.traceFlags,
      isRemote: false,
    });

    // 5. Create Invocation_Span parented onto the same-trace ambient span when
    // available, otherwise onto the execution ancestor so it stays within the
    // execution trace. Provider ownership must not change trace topology.
    const invocationParentContext = this.invocationParentContext(
      execTraceContext.executionAncestor,
      canonical,
    );

    const invocationAttributes: Record<string, string | number | boolean> = {
      "durable.execution.arn": this.executionArn,
      "durable.invocation.first": info.isFirstInvocation,
    };

    if (!this.environment.usesGlobalProvider) {
      // Set cloud.resource_id from Lambda environment variables
      const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
      if (functionName) {
        const region = process.env.AWS_REGION;
        // Extract account ID from execution ARN (format: arn:aws:states:{region}:{account}:execution:{sm}:{exec})
        const arnParts = this.executionArn.split(":");
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
      const workflowSpanId = deriveWorkflowSpanId(this.executionArn);
      const executionAncestorContext = trace.setSpanContext(
        ROOT_CONTEXT,
        this.executionAncestor,
      );
      const workflowSpan = this.environment.idGenerator.withIds(
        { spanId: workflowSpanId },
        () =>
          this.startSpan(
            this.environment.workflowSpanName,
            {
              kind: SpanKind.INTERNAL,
              attributes: {
                "durable.execution.arn": this.executionArn,
              },
              startTime: this.workflowStartTime,
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
    }
    // Non-terminal (PENDING/RETRYING): no real Workflow_Span is created, so
    // nothing to end — the identity was only ever a non-recording context.

    // 3. End any attempt span still open (safeguard against a leak on a
    // non-terminal invocation, issue #831). Operation placeholders have no
    // recording span, and this instance is dropped with the invocation, so
    // there is nothing else to release.
    for (const span of this.spanMap.values()) {
      if (span.isRecording()) {
        span.end();
      }
    }

    // 4. Always flush TracerProvider at invocation boundaries
    if ("forceFlush" in this.environment.tracerProvider) {
      try {
        await (
          this.environment.tracerProvider as {
            forceFlush: () => Promise<void>;
          }
        ).forceFlush();
      } catch (e) {
        console.error(
          "[ExecutionOtelPlugin] forceFlush failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  private startSpan(
    name: string,
    options: Parameters<Tracer["startSpan"]>[1],
    parentContext: Parameters<Tracer["startSpan"]>[2],
  ): Span {
    const { tracer, durableSampler } = this.environment;
    const fn = () => tracer.startSpan(name, options, parentContext);
    return durableSampler
      ? durableSampler.withDecision(this.executionSamplingDecision, fn)
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

    // The only place an operation span is created: start+end it here under its
    // deterministic ID, so it is exported exactly once even across suspend/resume.
    const started = this.operationStarts.get(info.id);
    this.operationContexts.delete(info.id);
    this.operationStarts.delete(info.id);

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
    const span = this.environment.idGenerator.withIds(
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
  }

  /**
   * The parent context for an operation or attempt span: the parent operation's
   * deterministic placeholder context when known, otherwise the deferred
   * Workflow span's context so the span still hangs off the execution trace.
   */
  private resolveOperationParentContext(parentId: string | undefined): Context {
    if (parentId) {
      const parentContext = this.operationContexts.get(parentId);
      if (parentContext) {
        return trace.setSpanContext(context.active(), parentContext);
      }
    }
    const workflowContext = this.workflowSpan?.spanContext();
    if (workflowContext) {
      return trace.setSpanContext(context.active(), workflowContext);
    }
    return context.active();
  }

  /** The earlier of two timestamps, ignoring undefined; undefined only when both are. */
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
    if (!this.tracingEnabled || !this.environment.enrichLogger) {
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

/**
 * A factory that gives every durable invocation its own
 * {@link ExecutionOtelPlugin}, over one shared tracer provider, tracer,
 * deterministic ID generator and sampler.
 *
 * Pass the result in `plugins`; the SDK calls it once per invocation, with that
 * invocation's info, and drops the instance it returns when the invocation
 * returns:
 *
 * ```typescript
 * export const handler = withDurableExecution(myHandler, {
 *   plugins: [createExecutionOtelPluginFactory()],
 * });
 * ```
 *
 * One instance per invocation is what makes the plugin correct under Lambda
 * Managed Instances. The plugin holds the execution ARN, the execution trace
 * identity, the Workflow and Invocation spans, and maps keyed by operation ID —
 * all of which describe one execution, while operation IDs are only unique
 * within one. A single instance serving two concurrent executions would have the
 * second overwrite the first; per-invocation instances remove that by
 * construction, while the environment-scoped parts are still resolved and
 * installed once.
 *
 * The environment is built on the first invocation, so calling this at module
 * scope resolves no tracer provider and installs nothing.
 *
 * @param config - Plugin configuration, applied once to the shared environment.
 */
export function createExecutionOtelPluginFactory(
  config?: OtelPluginConfig,
): DurableInstrumentationPluginFactory<ExecutionOtelPlugin> {
  return createPluginFactory(
    config,
    (environment, info) => new ExecutionOtelPlugin(environment, info),
  );
}
