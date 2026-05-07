import {
  trace,
  context as otelContext,
  ROOT_CONTEXT,
  Span,
  SpanStatusCode,
  Context,
  TracerProvider,
  Tracer,
  TraceFlags,
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
import { shouldSampleExecution, hashId } from "@aws/durable-execution-sdk-js";
import { ContextExtractor, xRayContextExtractor } from "./context-extractors";
import { DeterministicIdGenerator } from "./deterministic-id-generator";

const HASHED_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Ensures an operation ID is in hashed form.
 * If already hashed (16-char hex), returns as-is. Otherwise hashes it.
 */
function ensureHashedId(id: string): string {
  return HASHED_ID_PATTERN.test(id) ? id : hashId(id);
}

export interface DurableOtelPluginConfig {
  provider?: TracerProvider;
  idGenerator?: DeterministicIdGenerator;
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
    this.idGenerator = config.idGenerator ?? new DeterministicIdGenerator();
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
   * Stores a span under both the raw key and its hashed form (if different),
   * so lookups work regardless of which ID format is used.
   */
  private setSpan(key: string, span: Span): void {
    this.operationSpans.set(key, span);
    const hashed = ensureHashedId(key);
    if (hashed !== key) this.operationSpans.set(hashed, span);
  }

  /**
   * Stores a context under both the raw key and its hashed form (if different).
   */
  private setContext(key: string, ctx: Context): void {
    this.operationContexts.set(key, ctx);
    const hashed = ensureHashedId(key);
    if (hashed !== key) this.operationContexts.set(hashed, ctx);
  }

  /**
   * Deletes a span under both the raw key and its hashed form.
   */
  private deleteSpan(key: string): void {
    this.operationSpans.delete(key);
    const hashed = ensureHashedId(key);
    if (hashed !== key) this.operationSpans.delete(hashed);
  }

  /**
   * Deletes a context under both the raw key and its hashed form.
   */
  private deleteContext(key: string): void {
    this.operationContexts.delete(key);
    const hashed = ensureHashedId(key);
    if (hashed !== key) this.operationContexts.delete(hashed);
  }

  /**
   * Resolves the OpenTelemetry Context for a given operation ID.
   * Returns the stored context if the operation is already tracked, the
   * invocation context if the ID matches the invocation span, or creates
   * a placeholder non-recording span so that downstream spans are properly
   * nested in the trace.
   */
  resolveContext(operationId: string): Context {
    const hashedId = ensureHashedId(operationId);

    // Check if we already have a context for this operation
    const existingCtx = this.operationContexts.get(hashedId);
    if (existingCtx) {
      return existingCtx;
    }

    // Check if the operation ID matches the invocation span
    if (
      hashedId === this.INVOCATION_SPAN_ID ||
      hashedId === this.invocationSpan?.spanContext().spanId
    ) {
      return this.invocationContext;
    }

    // Create a placeholder non-recording span so the hierarchy is preserved
    const traceId =
      this.invocationSpan?.spanContext().traceId ??
      this.idGenerator.generateTraceId();
    const placeholderSpan = trace.wrapSpanContext({
      traceId,
      spanId: hashedId,
      traceFlags: TraceFlags.SAMPLED,
    });
    const placeholderCtx = trace.setSpan(
      this.invocationContext,
      placeholderSpan,
    );
    this.setSpan(operationId, placeholderSpan);
    this.setContext(operationId, placeholderCtx);
    return placeholderCtx;
  }

  /**
   * Resolves the parent operation ID for a given operation.
   * Used by onOperationEnd/onOperationAttemptEnd to restore the active span.
   * First tries to infer from the ID structure (e.g., "1-3" → "1").
   * Falls back to explicit parentId, then to the invocation span ID.
   */
  private resolveParentId(id: string, parentId?: string): string {
    const lastDash = id.lastIndexOf("-");
    if (lastDash > 0) {
      const inferredParentId = id.substring(0, lastDash);
      return ensureHashedId(inferredParentId);
    }
    if (parentId) {
      return ensureHashedId(parentId);
    }
    return this.invocationSpan?.spanContext().spanId ?? this.INVOCATION_SPAN_ID;
  }

  /**
   * Resolves the parent context for a given operation, returning an existing
   * span's context or creating a placeholder context if it's missing.
   *
   * Uses resolveParentId to determine the logical parent, then looks up the
   * corresponding Context. If the parent ID points to a known operation that
   * has a stored context, that context is returned directly. Otherwise, a
   * placeholder non-recording span is created with the correct span ID and
   * registered so that child spans are properly nested in the trace.
   */
  private resolveParentContext(id: string, parentId?: string): Context {
    const resolvedParentId = this.resolveParentId(id, parentId);

    // Check if we already have a context for this parent
    const existingCtx = this.operationContexts.get(resolvedParentId);
    if (existingCtx) {
      return existingCtx;
    }

    // Fall back to the invocation context if the parent is the invocation span
    if (
      resolvedParentId === this.INVOCATION_SPAN_ID ||
      resolvedParentId === this.invocationSpan?.spanContext().spanId
    ) {
      return this.invocationContext;
    }

    // Parent span is missing — create a placeholder non-recording span so the
    // hierarchy is preserved without going through the tracer's startSpan.
    const traceId =
      this.invocationSpan?.spanContext().traceId ??
      this.idGenerator.generateTraceId();
    const placeholderSpan = trace.wrapSpanContext({
      traceId,
      spanId: ensureHashedId(resolvedParentId),
      traceFlags: TraceFlags.SAMPLED,
    });
    const placeholderCtx = trace.setSpan(
      this.invocationContext,
      placeholderSpan,
    );
    this.setSpan(resolvedParentId, placeholderSpan);
    this.setContext(resolvedParentId, placeholderCtx);
    return placeholderCtx;
  }

  onExecutionStart(info: InvocationInfo): void {
    this.sampled = shouldSampleExecution(info.executionArn, this.samplingRate);
  }

  onInvocation<T>(info: InvocationInfo, fn: () => T): T {
    if (!this.sampled) return fn();
    return otelContext.with(this.invocationContext, fn);
  }

  onInvocationStart(info: InvocationInfo): void {
    if (!this.sampled) return;
    this.executionArn = info.executionArn;
    const extractedContext = this.contextExtractor(info);
    this.idGenerator.setExecutionTraceId(info.executionArn, new Date());
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
    const parentCtx = this.resolveParentContext(info.Id, info.ParentId);
    this.idGenerator.setNextSpanOperationId(info.Id);
    const span = this.tracer.startSpan(
      info.Name ?? operationType,
      {
        attributes: {
          "durable.execution.arn": this.executionArn,
          "durable.operation.id": ensureHashedId(info.Id),
          "durable.operation.type": operationType,
          ...(info.Name && { "durable.operation.name": info.Name }),
        },
        startTime: info.StartTimestamp,
      },
      parentCtx,
    );
    this.setSpan(info.Id, span);
    this.setContext(info.Id, trace.setSpan(parentCtx, span));
    this.activeSpan = span;
  }

  onOperation<T>(info: OperationInfo, fn: () => T): T {
    if (!this.sampled) return fn();
    const spanContext = this.resolveContext(info.Id);
    return otelContext.with(spanContext, fn);
  }

  onOperationEnd(info: OperationInfo & { error?: Error }): void {
    if (!this.sampled) return;
    const span = this.operationSpans.get(ensureHashedId(info.Id));
    if (!span) return;
    if (info.error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: info.error.message,
      });
      span.recordException(info.error);
    }
    span.end(info.EndTimestamp);
    this.deleteSpan(info.Id);
    this.deleteContext(info.Id);
    const parentId = this.resolveParentId(info.Id, info.ParentId);
    this.activeSpan = this.operationSpans.get(parentId) ?? this.invocationSpan;
    if (this.activeSpan) {
      trace.setSpan(
        this.operationContexts.get(parentId) ?? this.invocationContext,
        this.activeSpan,
      );
    }
  }

  onOperationAttemptStart(info: AttemptInfo): void {
    if (!this.sampled) return;
    const key = `${info.Id}-${info.Attempt}`;
    const operationType = this.mapOperationType(info);
    // Attempt spans nest under their operation span
    const parentCtx = this.resolveParentContext(key, info.ParentId);
    this.idGenerator.setNextSpanOperationId(key);
    const attemptSpan = this.tracer.startSpan(
      info.Name ?? operationType,
      {
        attributes: {
          "durable.execution.arn": this.executionArn,
          "durable.operation.id": ensureHashedId(info.Id),
          "durable.operation.type": operationType,
          ...(info.Name && { "durable.operation.name": info.Name }),
          "durable.attempt.number": info.Attempt,
        },
        startTime: info.StartTimestamp,
      },
      parentCtx,
    );
    this.setSpan(key, attemptSpan);
    this.setContext(key, trace.setSpan(parentCtx, attemptSpan));
    this.activeSpan = attemptSpan;
  }

  onOperationAttempt<T>(info: AttemptInfo, fn: () => T): T {
    if (!this.sampled) return fn();
    const key = `${info.Id}-${info.Attempt}`;
    const spanContext = this.resolveContext(key);
    return otelContext.with(spanContext, fn);
  }

  onOperationAttemptEnd(info: AttemptEndInfo): void {
    if (!this.sampled) return;
    const key = `${info.Id}-${info.Attempt}`;
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
    span.end(info.EndTimestamp);
    this.deleteSpan(key);
    const parentId = this.resolveParentId(key, info.Id);
    this.activeSpan = this.operationSpans.get(parentId) ?? this.invocationSpan;
    if (this.activeSpan) {
      trace.setSpan(
        this.operationContexts.get(parentId) ?? this.invocationContext,
        this.activeSpan,
      );
    }
  }

  async onInvocationEnd(_info: InvocationInfo): Promise<void> {
    if (!this.sampled) return;
    this.invocationSpan?.end();
    this.invocationSpan = undefined;
    this.activeSpan = undefined;
    // Clear per-invocation state to prevent leaks across warm Lambda reuses
    this.operationSpans.clear();
    this.operationContexts.clear();
    // Flush before Lambda freeze
    if (this.provider && "forceFlush" in this.provider) {
      await (this.provider as { forceFlush: () => Promise<void> }).forceFlush();
    }
  }

  async onExecutionEnd(_info: ExecutionEndInfo): Promise<void> {
    // No-op — invocationEnd handles flushing
  }

  enrichLogContext(): Record<string, string | number | boolean> | undefined {
    const span = trace.getActiveSpan() ?? this.activeSpan;
    if (!span) return undefined;
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  }
}
