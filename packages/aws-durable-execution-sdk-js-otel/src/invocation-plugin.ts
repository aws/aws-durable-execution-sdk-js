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
import type { TracerProvider, Tracer, Span, SpanContext, Link } from "@opentelemetry/api";
import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
} from "@opentelemetry/api";
import {
  DeterministicIdGenerator,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
import { xRayContextExtractor } from "./context-extractors";
import type { ContextExtractor } from "./context-extractors";
import type { OtelPluginConfig } from "./otel-plugin-config";
import { createTracerProvider } from "./otel-plugin-provider";
import { registerStandaloneInstrumentations } from "./otel-plugin-instrumentations";

const DEFAULT_INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";

/**
 * OpenTelemetry instrumentation plugin for durable executions.
 *
 * Implements the DurableInstrumentationPlugin interface to emit distributed
 * traces that correlate across multiple Lambda invocations of a single
 * durable execution.
 */
export class InvocationOtelPlugin implements DurableInstrumentationPlugin {
  private readonly tracerProvider: TracerProvider;
  private readonly tracer: Tracer;
  private readonly idGenerator: DeterministicIdGenerator;
  private readonly contextExtractor: ContextExtractor;
  private readonly useDefaultTracerProvider: boolean;
  private readonly workflowSpanName: string;

  // Per-invocation state
  private spanMap: Map<string, Span> = new Map();
  private spanStack: Span[] = [];
  private invocationSpan: Span | undefined;
  private workflowSpan: Span | undefined;
  private executionArn: string = "";

  constructor(config?: OtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;
    this.useDefaultTracerProvider = config?.useDefaultTracerProvider ?? false;
    this.workflowSpanName = config?.workflowSpanName ?? "Workflow";

    // Pass config directly to createTracerProvider — when neither tracerProvider
    // nor useDefaultTracerProvider is set, option 3 creates an internal provider
    // with OTLP export (same behavior as ExecutionOtelPlugin).
    const { tracerProvider } = createTracerProvider(config);
    this.tracerProvider = tracerProvider;

    // Register instrumentations using the shared module
    registerStandaloneInstrumentations(this.tracerProvider, config);

    this.tracer = this.tracerProvider.getTracer(instrumentationName);

    // Monkey-patch the tracer's ID generator so spans use deterministic IDs.
    // The _idGenerator field is internal to @opentelemetry/sdk-trace-base's Tracer class.
    (this.tracer as any)._idGenerator = this.idGenerator;
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    // 1. Store the execution ARN
    this.executionArn = info.executionArn;

    // 2. Invoke the context extractor
    const extractedContext = this.contextExtractor(info);

    // 3. Set the trace ID on the ID generator
    if (extractedContext?.traceId) {
      this.idGenerator.setTraceId(extractedContext.traceId);
    } else {
      // Fallback: derive trace ID from ARN
      const derivedId = deriveTraceIdFromArn(info.executionArn);
      this.idGenerator.setTraceId(derivedId);
    }

    // 4. Create the Workflow root span.
    //
    // The Workflow span is the parentless root of the execution-scoped trace and
    // is emitted in BOTH provider modes (default/ADOT and owned/community
    // collector), matching ExecutionOtelPlugin and the Python/Java reference
    // plugins. It is keyed to a deterministic span ID derived from the execution
    // ARN so every invocation of the same durable execution shares one root, and
    // it is finalized (stamped with a terminal execution status and ended) only
    // once, at the terminal invocation (see onInvocationEnd). Emitting it only in
    // community-collector mode previously left the invocation view without a root
    // Workflow span under ADOT/X-Ray.
    const workflowSpanId = deriveWorkflowSpanId(info.executionArn);
    this.idGenerator.setNextSpanId(workflowSpanId);

    this.workflowSpan = this.tracer.startSpan(
      this.workflowSpanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "durable.execution.arn": info.executionArn,
        },
        startTime: info.executionStartTimestamp ?? new Date(),
      },
      ROOT_CONTEXT,
    );

    // 5. Create the invocation span, parented to the ACTIVE context. Under
    //    ADOT/X-Ray the active context at onInvocationStart is the Lambda
    //    execution-environment span, so the invocation span nests beneath it.
    //    The invocation span is intentionally NOT a child of the Workflow span:
    //    this plugin stays invocation-rooted. Execution-scoped correlation to
    //    the Workflow span is expressed via links on the operation/attempt
    //    spans (see onOperationStart / onOperationAttemptStart), matching the
    //    Java (aws/aws-durable-execution-sdk-java#572) and Python
    //    (aws/aws-durable-execution-sdk-python#593) reference plugins.
    this.invocationSpan = this.tracer.startSpan(
      "Invocation",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "durable.execution.arn": info.executionArn,
          "durable.invocation.first": info.isFirstInvocation,
        },
      },
      context.active(),
    );
  }

  wrapInvocation(
    _info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput> {
    if (!this.invocationSpan) {
      return fn();
    }
    return context.with(
      trace.setSpan(context.active(), this.invocationSpan),
      fn,
    );
  }

  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    // 1. End all spans in the stack in reverse order
    while (this.spanStack.length > 0) {
      const span = this.spanStack.pop()!;
      span.end();
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

      this.invocationSpan.end();
    }

    // 3. Handle Workflow span based on terminal status. The Workflow span is
    //    always created (both provider modes); it is finalized only on a
    //    terminal invocation, and dropped un-exported while non-terminal.
    if (this.workflowSpan) {
      if (info.status === "SUCCEEDED" || info.status === "FAILED") {
        // PluginInvocationStatus only distinguishes SUCCEEDED/FAILED/PENDING/RETRYING,
        // so the plugin cannot tell whether a failed workflow was TIMED_OUT or STOPPED
        // — those are collapsed into FAILED -> ERROR here.
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
      // Non-terminal (PENDING/RETRYING): do NOT end — status stays UNSET and the
      // span is dropped without export
    }

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
    this.spanMap.clear();
    this.spanStack = [];
    this.invocationSpan = undefined;
    this.workflowSpan = undefined;
    this.executionArn = "";
  }

  async onOperationStart(info: OperationInfo): Promise<void> {
    // Same-invocation replay of an operation we already started: the span
    // already exists (e.g. a child context that is replayed after an internal
    // step retry, or a retried step). Reuse it rather than emitting a duplicate
    // span — the existing span is finalized at onOperationEnd. A genuine
    // cross-invocation continuation has no span in the map and still creates
    // its link span below.
    if (info.isReplay && this.spanMap.has(info.id)) {
      return;
    }

    // Operation, continuation, and attempt spans are timed with wall-clock
    // (the tracer's current time) rather than the durable start/end
    // timestamps. The Invocation span is a wall-clock span for the current
    // invocation, and these spans parent to it; using durable timestamps
    // (which can predate this invocation's start, e.g. an operation created in
    // an earlier invocation of the same execution) would push a child outside
    // its parent's [start, end] window and break the parent-timing envelope
    // the conformance suite enforces. Only the root Workflow span keeps a
    // backdated start (it is parentless). Matches the Python/Java reference.
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
      this.idGenerator.setNextSpanId(deterministicSpanId);
      span = this.tracer.startSpan(
        spanName,
        {
          attributes,
          links: this.workflowLinks(),
        },
        parentContext,
      );
    } else if (info.type === "CONTEXT" || info.type === "STEP") {
      // Replay: use random span ID, add Link to deterministic span
      const traceId =
        this.invocationSpan?.spanContext().traceId ??
        this.idGenerator.generateTraceId();
      span = this.tracer.startSpan(
        spanName,
        {
          attributes,
          // Self-link to the deterministic operation span first, then the
          // Workflow link (order-significant per the conformance contract).
          links: [
            {
              context: { traceId, spanId: deterministicSpanId, traceFlags: 1 },
            },
            ...this.workflowLinks(),
          ],
        },
        parentContext,
      );
    }

    // Push to map and stack
    if (span != undefined) {
      this.spanMap.set(info.id, span);
      this.spanStack.push(span);
    }
  }

  wrapChildContextFn(info: OperationInfo, fn: () => unknown): unknown {
    const span = this.spanMap.get(info.id);
    if (!span) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), span), fn);
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
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

    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );

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

      // Record error if present; otherwise stamp explicit OK on the terminal
      // completion path (matches Python OTel plugin #604). Only reached for
      // operations that terminate this invocation — suspended ops early-return
      // above and keep their STARTED status UNSET.
      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // End the span
      span.end();

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
      const traceId =
        this.invocationSpan?.spanContext().traceId ??
        this.idGenerator.generateTraceId();

      const parentContext = this.invocationSpan
        ? trace.setSpan(context.active(), this.invocationSpan)
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

      const continuationSpan = this.tracer.startSpan(
        spanName,
        {
          attributes,
          // Self-link to the deterministic operation span first, then the
          // Workflow link (order-significant per the conformance contract).
          links: [
            {
              context: { traceId, spanId: deterministicSpanId, traceFlags: 1 },
            },
            ...this.workflowLinks(),
          ],
        },
        parentContext,
      );

      // Record error if present; otherwise stamp explicit OK (matches Python
      // OTel plugin #604). This is the terminal completion path for an
      // operation started in a prior invocation.
      if (info.error) {
        continuationSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        continuationSpan.recordException(info.error);
      } else {
        continuationSpan.setStatus({ code: SpanStatusCode.OK });
      }

      // Immediately end
      continuationSpan.end();
    }
  }

  async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );
    const baseName = info.name ?? info.type;
    const spanName = `${baseName} attempt ${info.attempt}`;

    // Find the parent Operation_Span for this operation
    const parentSpan = this.spanMap.get(info.id);
    const parentContext = parentSpan
      ? trace.setSpan(context.active(), parentSpan)
      : context.active();

    // Get current trace ID for the link
    const currentTraceId =
      this.invocationSpan?.spanContext().traceId ??
      this.idGenerator.generateTraceId();

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

    // Create Attempt_Span as child of Operation_Span with Link to deterministic span
    const attemptSpan = this.tracer.startSpan(
      spanName,
      {
        attributes,
        // Self-link to the deterministic operation span first, then the
        // Workflow link (order-significant per the conformance contract).
        links: [
          {
            context: {
              traceId: currentTraceId,
              spanId: deterministicSpanId,
              traceFlags: 1,
            },
          },
          ...this.workflowLinks(),
        ],
      },
      parentContext,
    );

    this.spanMap.set(this.attemptSpanKey(info.id, info.attempt), attemptSpan);
  }

  wrapOperationAttemptFn(info: AttemptInfo, fn: () => unknown): unknown {
    const attemptSpan = this.spanMap.get(
      this.attemptSpanKey(info.id, info.attempt),
    );
    if (!attemptSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), attemptSpan), fn);
  }

  async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
    const key = this.attemptSpanKey(info.id, info.attempt);
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
      attemptSpan.end();
      this.spanMap.delete(key);
    }
  }

  async onOperationChange(_info: OperationChangeInfo): Promise<void> {
    // No-op for this plugin
  }

  enrichLogContext(): Record<string, string | number | boolean> | undefined {
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

  private attemptSpanKey(operationId: string, attempt: number): string {
    return `attempt:${operationId}:${attempt}`;
  }
}
