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
import type { TracerProvider, Tracer, Span } from "@opentelemetry/api";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  DeterministicIdGenerator,
  deriveTraceIdFromArn,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
import { xRayContextExtractor } from "./context-extractors";
import type { ContextExtractor } from "./context-extractors";

/**
 * Configuration options for the InvocationOtelPlugin.
 */
export interface InvocationOtelPluginConfig {
  /** Custom TracerProvider. If omitted, the plugin creates one internally. */
  tracerProvider?: TracerProvider;
  /** Context extractor function. Defaults to xRayContextExtractor. */
  contextExtractor?: ContextExtractor;
  /** Instrumentation scope name. Defaults to "aws-durable-execution-sdk-js". */
  instrumentationName?: string;
}

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

  // Per-invocation state
  private spanMap: Map<string, Span> = new Map();
  private spanStack: Span[] = [];
  private invocationSpan: Span | undefined;
  private executionArn: string = "";
  private attemptSpan: Span | undefined;

  constructor(config?: InvocationOtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;

    if (config?.tracerProvider) {
      this.tracerProvider = config.tracerProvider;
    } else {
      this.tracerProvider = trace.getTracerProvider();
      registerInstrumentations({
        tracerProvider: this.tracerProvider,
        instrumentations: [
          new AwsInstrumentation({
            suppressInternalInstrumentation: true,
            sqsExtractContextPropagationFromPayload: true,
          }),
        ],
      });
    }

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

    // 4. Create the invocation span
    this.invocationSpan = this.tracer.startSpan("invocation", {
      attributes: {
        "durable.execution.arn": info.executionArn,
      },
    });
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

  async onInvocationEnd(_info: InvocationEndInfo): Promise<void> {
    // 1. End all spans in the stack in reverse order
    while (this.spanStack.length > 0) {
      const span = this.spanStack.pop()!;
      span.end();
    }

    // 2. End the invocation span if it exists
    if (this.invocationSpan) {
      this.invocationSpan.end();
    }

    // 3. Force flush the tracer provider
    if ("forceFlush" in this.tracerProvider) {
      try {
        await (
          this.tracerProvider as { forceFlush: () => Promise<void> }
        ).forceFlush();
      } catch {
        // Gracefully handle flush errors
      }
    }

    // 4. Clear all per-invocation state
    this.spanMap.clear();
    this.spanStack = [];
    this.invocationSpan = undefined;
    this.executionArn = "";
    this.attemptSpan = undefined;
  }

  async onOperationStart(info: OperationInfo): Promise<void> {
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
          startTime: info.startTimestamp,
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
          startTime: info.startTimestamp,
          links: [
            {
              context: { traceId, spanId: deterministicSpanId, traceFlags: 1 },
            },
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

      // Record error if present
      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
      }

      // End the span
      span.end(info.endTimestamp);

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

      const continuationSpan = this.tracer.startSpan(
        spanName,
        {
          attributes,
          startTime: info.startTimestamp,
          links: [
            {
              context: { traceId, spanId: deterministicSpanId, traceFlags: 1 },
            },
          ],
        },
        parentContext,
      );

      // Record error if present
      if (info.error) {
        continuationSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        continuationSpan.recordException(info.error);
      }

      // Immediately end
      continuationSpan.end(info.endTimestamp);
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
      "durable.operation.attempt": info.attempt,
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
        startTime: info.startTimestamp,
        links: [
          {
            context: {
              traceId: currentTraceId,
              spanId: deterministicSpanId,
              traceFlags: 1,
            },
          },
        ],
      },
      parentContext,
    );

    this.attemptSpan = attemptSpan;
  }

  wrapOperationAttemptFn(_info: AttemptInfo, fn: () => unknown): unknown {
    if (!this.attemptSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), this.attemptSpan), fn);
  }

  async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
    if (this.attemptSpan) {
      this.attemptSpan.setAttribute("durable.attempt.outcome", info.outcome);
      if (info.error) {
        this.attemptSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        this.attemptSpan.recordException(info.error);
      }
      this.attemptSpan.end(info.endTimestamp);
      this.attemptSpan = undefined;
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
}
