import {
  trace,
  ROOT_CONTEXT,
  Span,
  SpanStatusCode,
  Context,
  TracerProvider,
  Tracer,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
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
import { DeterministicIdGenerator } from "./deterministic-id-generator";

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
  private executionArn = "";
  private invocationContext: Context = ROOT_CONTEXT;
  private invocationSpan: Span | undefined;
  private activeSpan: Span | undefined;
  // Maps operation ID → span
  private operationSpans = new Map<string, Span>();
  // Maps operation ID → context (with that operation's span set on it)
  private operationContexts = new Map<string, Context>();
  private provider: TracerProvider | undefined;
  private idGenerator: DeterministicIdGenerator;
  private INVOCATION_SPAN_ID = "0";

  constructor(config: DurableOtelPluginConfig = {}) {
    const instrumentationName =
      config.instrumentationName ?? "aws-durable-execution-sdk-js";
    this.idGenerator = new DeterministicIdGenerator();
    if (config.provider) {
      this.provider = config.provider;
      this.tracer = config.provider.getTracer(instrumentationName);
    } else {
      const provider = new NodeTracerProvider({
        idGenerator: this.idGenerator,
      });
      this.provider = provider;
      this.tracer = provider.getTracer(instrumentationName);
    }

    this.contextExtractor = config.contextExtractor ?? xRayContextExtractor;
    this.samplingRate = config.samplingRate ?? 1.0;
  }

  /**
   * Resolves the parent operation ID for a given operation.
   * First tries to infer from the ID structure (e.g., "1-3" → "1").
   * Falls back to explicit parentId, then undefined.
   */
  private resolveParentId(id: string, parentId?: string): string {
    const lastDash = id.lastIndexOf("-");
    if (lastDash > 0) {
      const inferredParentId = id.substring(0, lastDash);
      if (
        inferredParentId !== id &&
        this.operationContexts.has(inferredParentId)
      ) {
        return inferredParentId;
      }
    }
    if (parentId && this.operationContexts.has(parentId)) {
      return parentId;
    }
    return this.INVOCATION_SPAN_ID;
  }

  /**
   * Resolves the parent context for a given operation.
   * First tries to infer the parent from the operation ID structure (e.g., "1-3" → parent "1").
   * Falls back to explicit ParentId lookup, then to invocation context.
   */
  private getParentContext(id: string, parentId?: string): Context {
    const resolved = this.resolveParentId(id, parentId);
    if (resolved) {
      return this.operationContexts.get(resolved) ?? this.invocationContext;
    }
    return this.invocationContext;
  }

  onExecutionStart(info: InvocationInfo): void {
    this.sampled = shouldSampleExecution(info.executionArn, this.samplingRate);
  }

  onInvocationStart(info: InvocationInfo): void {
    if (!this.sampled) return;
    this.executionArn = info.executionArn;
    const extractedContext = this.contextExtractor(info);
    this.idGenerator.setNextSpanOperationId(this.INVOCATION_SPAN_ID);
    this.invocationSpan = this.tracer.startSpan(
      "invocation",
      {
        attributes: {
          "durable.execution.arn": info.executionArn,
        },
      },
      extractedContext,
    );
    this.invocationContext = trace.setSpan(
      extractedContext,
      this.invocationSpan,
    );
    this.activeSpan = this.invocationSpan;
    this.operationSpans.set(this.INVOCATION_SPAN_ID, this.invocationSpan);
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
    PARALLEL_BRANCH: "parallel-branch",
    MAP: "map",
    MAP_ITERATION: "map-iteration",
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
    const operationType = this.mapOperationType(info);
    const parentCtx = this.getParentContext(info.Id, info.ParentId);
    this.idGenerator.setNextSpanOperationId(info.Id);
    const span = this.tracer.startSpan(
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
      parentCtx,
    );
    this.operationSpans.set(info.Id, span);
    this.operationContexts.set(info.Id, trace.setSpan(parentCtx, span));
    this.activeSpan = span;
  }

  onOperationEnd(info: OperationInfo & { error?: Error }): void {
    if (!this.sampled) return;
    const span = this.operationSpans.get(info.Id);
    if (!span) return;
    if (info.error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: info.error.message,
      });
      span.recordException(info.error);
    }
    span.end();
    this.operationSpans.delete(info.Id);
    this.operationContexts.delete(info.Id);
    const parentId = this.resolveParentId(info.Id, info.ParentId);
    this.activeSpan = this.operationSpans.get(parentId);
  }

  onOperationAttemptStart(info: AttemptInfo): void {
    if (!this.sampled) return;
    const key = `${info.Id}-attempt-${info.Attempt}`;
    const operationType = this.mapOperationType(info);
    const parentCtx = this.getParentContext(info.Id, info.ParentId);
    this.idGenerator.setNextSpanOperationId(key);
    const attemptSpan = this.tracer.startSpan(
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
      parentCtx,
    );
    this.operationSpans.set(key, attemptSpan);
    this.activeSpan = attemptSpan;
  }

  onOperationAttemptEnd(info: AttemptEndInfo): void {
    if (!this.sampled) return;
    const key = `${info.Id}-attempt-${info.Attempt}`;
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
    const parentId = this.resolveParentId(info.Id, info.ParentId);
    this.activeSpan = this.operationSpans.get(parentId);
  }

  async onInvocationEnd(_info: InvocationInfo): Promise<void> {
    if (!this.sampled) return;
    this.invocationSpan?.end();
    this.invocationSpan = undefined;
    this.activeSpan = undefined;
    // Flush before Lambda freeze
    if (this.provider && "forceFlush" in this.provider) {
      await (this.provider as { forceFlush: () => Promise<void> }).forceFlush();
    }
  }

  async onExecutionEnd(_info: ExecutionEndInfo): Promise<void> {
    // No-op — invocationEnd handles flushing
  }

  enrichLogContext(): Record<string, string | number | boolean> | undefined {
    const span = this.activeSpan;
    if (!span?.isRecording()) return undefined;
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  }
}
