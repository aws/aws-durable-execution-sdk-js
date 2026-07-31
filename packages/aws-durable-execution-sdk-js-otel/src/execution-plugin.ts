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
  Link,
} from "@opentelemetry/api";
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
 * Self-contained OpenTelemetry instrumentation plugin for durable executions.
 *
 * Unlike InvocationOtelPlugin (which relies on the ADOT Lambda layer for auto-instrumentation),
 * ExecutionOtelPlugin creates and manages its own TracerProvider, registers
 * instrumentations and propagators, and exports spans via OTLP to a local collector.
 *
 * Implements the DurableInstrumentationPlugin interface with a Workflow_Span as the
 * synthetic trace root, deferred operation span export, and invocation spans as
 * correlation siblings (not parents) of operation spans.
 */
export class ExecutionOtelPlugin implements DurableInstrumentationPlugin {
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

  // Default provider mode
  private readonly useDefaultTracerProvider: boolean;

  // Workflow span name (configurable)
  private readonly workflowSpanName: string;

  constructor(config?: OtelPluginConfig) {
    const instrumentationName =
      config?.instrumentationName ?? DEFAULT_INSTRUMENTATION_NAME;

    this.idGenerator = new DeterministicIdGenerator();
    this.contextExtractor = config?.contextExtractor ?? xRayContextExtractor;
    this.useDefaultTracerProvider = config?.useDefaultTracerProvider ?? false;
    this.workflowSpanName = config?.workflowSpanName ?? "Workflow";

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
  }

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    // 1. Store the execution ARN
    this.executionArn = info.executionArn;

    // 2. Extract trace context via context extractor (same as InvocationOtelPlugin)
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

    // 6. Create the Workflow_Span with deterministic ID (always as root — no parent)
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

    // 7. Create Invocation_Span
    if (!this.useDefaultTracerProvider) {
      // Non-default mode: child of Workflow_Span with Lambda semantic attributes
      const parentContext = trace.setSpan(context.active(), this.workflowSpan);

      const invocationAttributes: Record<string, string | number | boolean> = {
        "durable.execution.arn": info.executionArn,
        "durable.invocation.first": info.isFirstInvocation,
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
          kind: SpanKind.INTERNAL,
          attributes: invocationAttributes,
        },
        parentContext,
      );
    } else {
      // Default provider mode: create invocation span as child of the ambient
      // Lambda invocation span (from the ADOT layer or other auto-instrumentation)
      const parentContext = context.active();

      this.invocationSpan = this.tracer.startSpan(
        "Invocation",
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            "durable.execution.arn": info.executionArn,
            "durable.invocation.first": info.isFirstInvocation,
          },
        },
        parentContext,
      );
    }
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
    this.spanMap.clear();
    this.workflowSpan = undefined;
    this.invocationSpan = undefined;
    this.executionArn = "";
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

    if (!operationSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), operationSpan), fn);
  }

  async onOperationEnd(info: OperationEndInfo): Promise<void> {
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

    const attemptSpan = this.tracer.startSpan(
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
    const attemptSpan = this.spanMap.get(
      this.getAttemptKey(info.id, info.attempt),
    );
    if (!attemptSpan) {
      return fn();
    }
    return context.with(trace.setSpan(context.active(), attemptSpan), fn);
  }

  async onOperationAttemptEnd(info: AttemptEndInfo): Promise<void> {
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
