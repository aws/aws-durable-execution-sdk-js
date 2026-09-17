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
import type { Tracer, Span, SpanContext, Link } from "@opentelemetry/api";
import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
  isSpanContextValid,
  TraceFlags,
} from "@opentelemetry/api";
import { hrTime } from "@opentelemetry/core";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import {
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
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

const PLUGIN_NAME = "InvocationOtelPlugin";

/**
 * OpenTelemetry instrumentation plugin for one durable execution invocation.
 *
 * Implements the DurableInstrumentationPlugin interface to emit distributed
 * traces that correlate across multiple Lambda invocations of a single durable
 * execution.
 *
 * The SDK builds one of these per invocation, from that invocation's
 * {@link InvocationInfo}, and drops it when the invocation returns — so every
 * field below describes one execution and two executions sharing an execution
 * environment (routine under Lambda Managed Instances) are two objects. What
 * outlives the invocation is the {@link OtelPluginEnvironment} it is handed.
 */
export class InvocationOtelPlugin implements DurableInstrumentationPlugin {
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

  private tracingEnabled = false;

  // Per-invocation state
  private readonly spanMap: Map<string, Span> = new Map();
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
  private executionTraceId: string = "";
  private executionTraceFlags: number = 0;
  private executionSamplingDecision: SamplingDecision =
    SamplingDecision.NOT_RECORD;

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
   * @internal Use {@link createInvocationOtelPluginFactory}; both parameters are
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

    // 1. Invoke the context extractor
    const extractedContext = this.environment.contextExtractor(info);

    // 2. Resolve the one execution ancestor both the Workflow and Invocation
    // spans parent onto so they share a single execution trace. The canonical
    // trace ID is the propagated remote trace when valid, else one derived from
    // the ARN and start time. The execution ancestor is a complete remote
    // parent, else a synthetic execution root. A live ambient span is not used
    // as the ancestor (its trace is not stable across reinvocations); the
    // Invocation span may still parent onto a same-trace ambient span below.
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

    // 3. Resolve the Workflow span identity as a NON-RECORDING context.
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
    const workflowSpanId = deriveWorkflowSpanId(this.executionArn);
    this.executionAncestor = execTraceContext.executionAncestor;
    this.workflowSpan = trace.wrapSpanContext({
      traceId: this.executionTraceId,
      spanId: workflowSpanId,
      traceFlags: this.executionTraceFlags,
      isRemote: false,
    });

    // 4. Create the invocation span parented onto the same-trace ambient span
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
          "durable.execution.arn": this.executionArn,
          "durable.invocation.first": info.isFirstInvocation,
        },
        startTime: hrTime(),
      },
      invocationParentContext,
    );
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
      return;
    }

    const endTime = hrTime();

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
      workflowSpan.end(endTime);
    }
    // Non-terminal (PENDING/RETRYING): no real Workflow span is created, so
    // nothing to end — the identity was only ever a non-recording context.

    // 4. Force flush the tracer provider
    if ("forceFlush" in this.environment.tracerProvider) {
      try {
        await (
          this.environment.tracerProvider as {
            forceFlush: () => Promise<void>;
          }
        ).forceFlush();
      } catch {
        // Gracefully handle flush errors
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
   * is on the execution trace, otherwise the execution ancestor so the
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
  private initialOperationLink(operationId: string): Link {
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

    // Operation, continuation, and attempt spans use explicit monotonic
    // timestamps rather than durable start/end timestamps. Durable timestamps
    // can predate this invocation, while letting each span use the tracer's
    // default timestamp can give it an independent wall-clock anchor. A shared
    // monotonic clock keeps children inside their parent timing envelopes.
    // Only the parentless Workflow span keeps a backdated start.
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
      span = this.environment.idGenerator.withIds(
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
              startTime: hrTime(),
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
      //
      // WaitForCondition is modeled differently by the OTel conformance
      // contract: the resumed operation span keeps only its Workflow link, while
      // the non-terminal first polling attempt links back to the first operation
      // span once it is known to have completed successfully.
      span = this.startSpan(
        spanName,
        {
          attributes,
          links:
            info.subType === "WaitForCondition"
              ? this.workflowLinks()
              : this.replayLinks(info.id),
          startTime: hrTime(),
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

    // Skip span creation for WAIT, INVOKE, CHAINED_INVOKE, and CALLBACK operations on replay
    if (
      info.isReplay &&
      (info.type === "WAIT" ||
        info.type === "INVOKE" ||
        info.type === "CHAINED_INVOKE" ||
        info.type === "CALLBACK")
    ) {
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
        span.recordException(info.error);
      } else if (info.status === "SUCCEEDED") {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // End the span
      span.end(hrTime());

      // Remove from map
      this.spanMap.delete(info.id);

      // Remove from stack (find by reference)
      const stackIndex = this.spanStack.indexOf(span);
      if (stackIndex !== -1) {
        this.spanStack.splice(stackIndex, 1);
      }
    } else if (!info.isReplay) {
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
          startTime: hrTime(),
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
        continuationSpan.recordException(info.error);
      } else if (info.status === "SUCCEEDED") {
        continuationSpan.setStatus({ code: SpanStatusCode.OK });
      }

      // Immediately end
      continuationSpan.end(hrTime());
    }
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
        startTime: hrTime(),
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
      attemptSpan.addLinks(this.attemptLinks(info));
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
      attemptSpan.end(hrTime());
      this.spanMap.delete(key);
    }
  }

  async onOperationChange(_info: OperationChangeInfo): Promise<void> {
    // No-op for this plugin
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

  private attemptLinks(info: AttemptEndInfo): Link[] {
    if (
      info.subType === "WaitForCondition" &&
      info.attempt === 1 &&
      info.outcome === "SUCCEEDED"
    ) {
      return this.replayLinks(info.id);
    }
    return this.workflowLinks();
  }

  private attemptSpanKey(operationId: string, attempt: number): string {
    return `attempt:${operationId}:${attempt}`;
  }
}

/**
 * A factory that gives every durable invocation its own
 * {@link InvocationOtelPlugin}, over one shared tracer provider, tracer,
 * deterministic ID generator and sampler.
 *
 * Pass the result in `plugins`; the SDK calls it once per invocation, with that
 * invocation's info, and drops the instance it returns when the invocation
 * returns:
 *
 * ```typescript
 * export const handler = withDurableExecution(myHandler, {
 *   plugins: [createInvocationOtelPluginFactory()],
 * });
 * ```
 *
 * One instance per invocation is what makes the plugin correct under Lambda
 * Managed Instances. The plugin holds the execution ARN, the execution trace
 * identity, the Workflow and Invocation spans, and a span map keyed by operation
 * ID — all of which describe one execution, while operation IDs are only unique
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
export function createInvocationOtelPluginFactory(
  config?: OtelPluginConfig,
): DurableInstrumentationPluginFactory<InvocationOtelPlugin> {
  return createPluginFactory(
    config,
    (environment, info) => new InvocationOtelPlugin(environment, info),
  );
}
