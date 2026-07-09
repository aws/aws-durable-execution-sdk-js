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
import {
  DeterministicIdGenerator,
  deriveTraceIdFromArn,
  deriveWorkflowSpanId,
  deriveSpanIdFromOperationId,
} from "./deterministic-id-generator";
import { xRayContextExtractor } from "./context-extractors";
import type { ContextExtractor } from "./context-extractors";
import type { StandaloneOtelPluginConfig } from "./standalone-plugin-config";
import { createTracerProvider } from "./standalone-plugin-provider";
import { registerStandaloneInstrumentations } from "./standalone-plugin-instrumentations";

const DEFAULT_INSTRUMENTATION_NAME = "aws-durable-execution-sdk-js";

/**
 * Self-contained OpenTelemetry instrumentation plugin for durable executions.
 *
 * Unlike OtelPlugin (which relies on the ADOT Lambda layer for auto-instrumentation),
 * StandaloneOtelPlugin creates and manages its own TracerProvider, registers
 * instrumentations and propagators, and exports spans via OTLP to a local collector.
 *
 * Implements the DurableInstrumentationPlugin interface with a Workflow_Span as the
 * synthetic trace root, deferred operation span export, and invocation spans as
 * correlation siblings (not parents) of operation spans.
 */
export class StandaloneOtelPlugin implements DurableInstrumentationPlugin {
  // Shared utilities (reused from existing package)
  private readonly idGenerator: DeterministicIdGenerator;
  private readonly contextExtractor: ContextExtractor;

  // TracerProvider (internally managed or user-provided)
  private readonly tracerProvider: TracerProvider;
  private readonly tracer: Tracer;
  private readonly ownsProvider: boolean;

  // Per-invocation state
  private workflowSpan: Span | undefined;
  private invocationSpan: Span | undefined;
  private spanMap: Map<string, Span>;
  private executionArn: string;
  private attemptSpan: Span | undefined;
  private contextExecutionCount: Map<string, number>;

  // Cold start tracking
  private isColdStart: boolean = true;

  constructor(config?: StandaloneOtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;

    // Create or accept TracerProvider via the provider factory
    const { tracerProvider, ownsProvider } = createTracerProvider(config);
    this.tracerProvider = tracerProvider;
    this.ownsProvider = ownsProvider;

    // Register HTTP and AWS SDK instrumentations (skipped when custom provider is supplied)
    registerStandaloneInstrumentations(this.tracerProvider, config);

    this.tracer = this.tracerProvider.getTracer(instrumentationName);

    // Monkey-patch the tracer's ID generator so spans use deterministic IDs.
    (this.tracer as any)._idGenerator = this.idGenerator;

    // Initialize per-invocation state
    this.spanMap = new Map();
    this.executionArn = "";
    this.contextExecutionCount = new Map();
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    // 1. Store the execution ARN
    this.executionArn = info.executionArn;

    // 2. Extract trace context via context extractor (same as OtelPlugin)
    const extractedContext = this.contextExtractor(info);

    // 3. Set the trace ID on the ID generator
    if (extractedContext?.traceId) {
      this.idGenerator.setTraceId(extractedContext.traceId);
    } else {
      // Fallback: derive trace ID from ARN
      const derivedId = deriveTraceIdFromArn(info.executionArn);
      this.idGenerator.setTraceId(derivedId);
    }

    // 4. Derive the workflow span ID from execution ARN
    const workflowSpanId = deriveWorkflowSpanId(info.executionArn);

    // 5. Set it as the next span ID so the tracer uses it for the Workflow_Span
    this.idGenerator.setNextSpanId(workflowSpanId);

    // 6. Create the Workflow_Span with deterministic ID
    this.workflowSpan = this.tracer.startSpan("Workflow", {
      attributes: {
        "durable.execution.arn": info.executionArn,
      },
      startTime: info.executionStartTimestamp ?? new Date(),
    });

    // 7. Create the Invocation_Span as child of Workflow_Span with Lambda semantic attributes
    const parentContext = trace.setSpan(context.active(), this.workflowSpan);

    const invocationAttributes: Record<string, string | number | boolean> = {
      "faas.invocation_id": info.requestId,
      "faas.coldstart": this.isColdStart,
      "cloud.provider": "aws",
      "cloud.platform": "aws_lambda",
      "durable.execution.arn": info.executionArn,
    };

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

    this.invocationSpan = this.tracer.startSpan(
      "Invocation",
      {
        attributes: invocationAttributes,
      },
      parentContext,
    );

    // Mark cold start as false after the first invocation
    this.isColdStart = false;
  }

  wrapInvocation(
    _info: InvocationInfo,
    fn: () => Promise<DurableExecutionInvocationOutput>,
  ): Promise<DurableExecutionInvocationOutput> {
    if (!this.workflowSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), this.workflowSpan), fn);
  }

  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    // 1. Always end and export Invocation_Span
    if (this.invocationSpan) {
      this.invocationSpan.end();
    }

    // 2. Handle Workflow_Span based on terminal status
    if (info.status === "SUCCEEDED" || info.status === "FAILED") {
      // Terminal: set status attribute, end (causes export)
      if (this.workflowSpan) {
        this.workflowSpan.setAttribute("durable.execution.status", info.status);
        this.workflowSpan.end();
      }
    }
    // Non-terminal (PENDING/RETRYING): do NOT end workflowSpan — just drop the reference.
    // Spans that are never .end()'d are never exported by the OTel SDK.

    // 3. Discard open Operation_Spans without ending (they won't be exported)

    // 4. Flush TracerProvider when we own it
    if (this.ownsProvider && "forceFlush" in this.tracerProvider) {
      try {
        await (
          this.tracerProvider as { forceFlush: () => Promise<void> }
        ).forceFlush();
      } catch {
        // Gracefully ignore flush errors
      }
    }

    // 5. Clear per-invocation state
    this.spanMap.clear();
    this.workflowSpan = undefined;
    this.invocationSpan = undefined;
    this.executionArn = "";
    this.attemptSpan = undefined;
    this.contextExecutionCount.clear();
  }

  async onOperationStart(info: OperationInfo): Promise<void> {
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

    // Build span link to Invocation_Span
    const links = this.invocationSpan
      ? [{ context: this.invocationSpan.spanContext() }]
      : [];

    // Always use deterministic span ID regardless of replay status
    this.idGenerator.setNextSpanId(deterministicSpanId);
    const span = this.tracer.startSpan(
      spanName,
      { attributes, startTime: info.startTimestamp, links },
      parentContext,
    );

    if (span) {
      this.spanMap.set(info.id, span);
    }
  }

  wrapChildContextFn(info: OperationInfo, fn: () => unknown): unknown {
    const operationSpan = this.spanMap.get(info.id);

    if (info.type !== "CONTEXT") {
      // Non-CONTEXT: just set the operation span as active context (same as OtelPlugin)
      if (!operationSpan) {
        return fn();
      }
      return context.with(trace.setSpan(context.active(), operationSpan), fn);
    }

    // CONTEXT type: create Context_Execution_Span
    // Increment execution counter for this context
    const currentCount = (this.contextExecutionCount.get(info.id) ?? 0) + 1;
    this.contextExecutionCount.set(info.id, currentCount);

    const baseName = info.name ?? info.type;
    const spanName = `${baseName} execution ${currentCount}`;

    // Parent is the CONTEXT Operation_Span
    const parentContext = operationSpan
      ? trace.setSpan(context.active(), operationSpan)
      : context.active();

    const attributes: Record<string, string> = {
      "durable.execution.arn": this.executionArn,
      "durable.operation.id": info.id,
      "durable.operation.type": info.type,
    };
    if (info.name) attributes["durable.operation.name"] = info.name;

    const executionSpan = this.tracer.startSpan(
      spanName,
      { attributes },
      parentContext,
    );

    // Set Context_Execution_Span as active context during fn execution
    try {
      const result = context.with(
        trace.setSpan(context.active(), executionSpan),
        fn,
      );
      executionSpan.end();
      return result;
    } catch (error) {
      // Record error on the Context_Execution_Span
      if (error instanceof Error) {
        executionSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        executionSpan.recordException(error);
      }
      executionSpan.end();
      throw error;
    }
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
    const deterministicSpanId = deriveSpanIdFromOperationId(
      info.id,
      this.executionArn,
    );

    if (this.spanMap.has(info.id)) {
      // Operation was started in this invocation
      const span = this.spanMap.get(info.id)!;

      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
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

      // Link to Invocation_Span
      const links = this.invocationSpan
        ? [{ context: this.invocationSpan.spanContext() }]
        : [];

      this.idGenerator.setNextSpanId(deterministicSpanId);
      const span = this.tracer.startSpan(
        spanName,
        { attributes, startTime: info.startTimestamp, links },
        parentContext,
      );

      if (info.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.recordException(info.error);
      }

      span.end(info.endTimestamp);
    }
  }

  async onOperationAttemptStart(info: AttemptInfo): Promise<void> {
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
      "durable.operation.attempt": info.attempt,
    };
    if (info.name) {
      attributes["durable.operation.name"] = info.name;
    }
    if (info.subType) {
      attributes["durable.operation.subtype"] = info.subType;
    }

    // Link to Invocation_Span
    const links = this.invocationSpan
      ? [{ context: this.invocationSpan.spanContext() }]
      : [];

    const attemptSpan = this.tracer.startSpan(
      spanName,
      {
        attributes,
        startTime: info.startTimestamp,
        links,
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
    // No-op — same as OtelPlugin
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
