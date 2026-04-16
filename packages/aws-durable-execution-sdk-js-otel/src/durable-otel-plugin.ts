import {
  trace,
  context as otelContext,
  Span,
  SpanStatusCode,
  Context,
  TracerProvider,
  Tracer,
} from "@opentelemetry/api";
import type {
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationInfo,
  AttemptInfo,
  AttemptEndInfo,
  ExecutionEndInfo,
} from "@aws/durable-execution-sdk-js";
import { shouldSampleExecution } from "@aws/durable-execution-sdk-js";
import { ContextExtractor, xRayContextExtractor } from "./context-extractors";
import { deterministicSpanId } from "./deterministic-id";

export interface DurableOtelPluginConfig {
  provider?: TracerProvider;
  contextExtractor?: ContextExtractor;
  samplingRate?: number;
  instrumentationName?: string;
}

export class DurableOtelPlugin implements DurableInstrumentationPlugin {
  private tracer: Tracer;
  private contextExtractor: ContextExtractor;
  private samplingRate: number;
  private sampled = false;
  private parentContext: () => Context = () => otelContext.active();
  private executionArn = "";
  private invocationSpan: Span | undefined;
  private operationSpans = new Map<string, Span>();
  private provider: TracerProvider | undefined;

  constructor(config: DurableOtelPluginConfig = {}) {
    const instrumentationName =
      config.instrumentationName ?? "aws-durable-execution-sdk-js";
    this.provider = config.provider;
    this.tracer = (config.provider ?? trace.getTracerProvider()).getTracer(
      instrumentationName,
    );
    this.contextExtractor = config.contextExtractor ?? xRayContextExtractor;
    this.samplingRate = config.samplingRate ?? 1.0;
  }

  onExecutionStart(info: InvocationInfo): void {
    this.sampled = shouldSampleExecution(info.executionArn, this.samplingRate);
  }

  onInvocationStart(info: InvocationInfo): void {
    if (!this.sampled) return;
    this.executionArn = info.executionArn;
    this.parentContext = () => this.contextExtractor(info);
    this.invocationSpan = this.tracer.startActiveSpan(
      "invocation",
      {
        attributes: {
          "durable.execution.arn": info.executionArn,
        },
      },
      this.parentContext(),
      (span) => span,
    );
    const invocationContext = trace.setSpan(
      this.parentContext(),
      this.invocationSpan,
    );
    this.parentContext = () => invocationContext;
  }

  private static readonly OPERATION_TYPE_MAP: Record<string, string> = {
    STEP: "step",
    WAIT: "wait",
    CHAINED_INVOKE: "invoke",
    CONTEXT: "child-context",
    CALLBACK: "wait-for-callback",
  };

  private static readonly SUBTYPE_MAP: Record<string, string> = {
    PARALLEL: "parallel",
    PARALLEL_BRANCH: "parallel",
    MAP: "map",
    MAP_ITERATION: "map",
    WAIT_FOR_CALLBACK: "wait-for-callback",
    WAIT_FOR_CONDITION: "wait-for-condition",
  };

  private mapOperationType(info: OperationInfo): string {
    if (info.SubType && DurableOtelPlugin.SUBTYPE_MAP[info.SubType]) {
      return DurableOtelPlugin.SUBTYPE_MAP[info.SubType];
    }
    return (
      DurableOtelPlugin.OPERATION_TYPE_MAP[info.Type] ?? info.Type.toLowerCase()
    );
  }

  onOperationStart(info: OperationInfo): void {
    if (!this.sampled) return;
    const spanId = deterministicSpanId(info.Id);
    const operationType = this.mapOperationType(info);
    const span = this.tracer.startActiveSpan(
      info.Name ?? operationType,
      {
        attributes: {
          "durable.execution.arn": this.executionArn,
          "durable.operation.id": info.Id,
          "durable.operation.type": operationType,
          ...(info.Name && { "durable.operation.name": info.Name }),
        },
        startTime: info.StartTimestamp,
      },
      this.parentContext(),
      (s) => s,
    );
    this.operationSpans.set(spanId, span);
  }

  onOperationEnd(info: OperationInfo & { error?: Error }): void {
    if (!this.sampled) return;
    const spanId = deterministicSpanId(info.Id);
    const span = this.operationSpans.get(spanId);
    if (!span) return;
    if (info.error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: info.error.message,
      });
      span.recordException(info.error);
    }
    span.end();
    this.operationSpans.delete(spanId);
  }

  onOperationAttemptStart(info: AttemptInfo): void {
    if (!this.sampled) return;
    const spanId = deterministicSpanId(info.Id);
    const operationType = this.mapOperationType(info);
    const attemptSpan = this.tracer.startActiveSpan(
      info.Name ?? operationType,
      {
        attributes: {
          "durable.execution.arn": this.executionArn,
          "durable.operation.id": info.Id,
          "durable.operation.type": operationType,
          ...(info.Name && { "durable.operation.name": info.Name }),
          "durable.attempt.number": info.Attempt,
        },
        startTime: info.StartTimestamp,
      },
      this.parentContext(),
      (s) => s,
    );
    this.operationSpans.set(`${spanId}-attempt-${info.Attempt}`, attemptSpan);
  }

  onOperationAttemptEnd(info: AttemptEndInfo): void {
    if (!this.sampled) return;
    const spanId = deterministicSpanId(info.Id);
    const key = `${spanId}-attempt-${info.Attempt}`;
    const span = this.operationSpans.get(key);
    if (!span) return;
    span.setAttribute("durable.attempt.outcome", info.outcome);
    if (info.error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: info.error.message,
      });
      span.recordException(info.error);
    }
    span.end();
    this.operationSpans.delete(key);
  }

  async onInvocationEnd(_info: InvocationInfo): Promise<void> {
    if (!this.sampled) return;
    this.invocationSpan?.end();
    this.invocationSpan = undefined;
    // Flush before Lambda freeze
    if (this.provider && "forceFlush" in this.provider) {
      await (this.provider as { forceFlush: () => Promise<void> }).forceFlush();
    }
  }

  async onExecutionEnd(_info: ExecutionEndInfo): Promise<void> {
    // No-op — invocationEnd handles flushing
  }

  enrichLogContext(): Record<string, string | number | boolean> | undefined {
    const span = trace.getActiveSpan();
    if (!span?.isRecording()) return undefined;
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  }
}
