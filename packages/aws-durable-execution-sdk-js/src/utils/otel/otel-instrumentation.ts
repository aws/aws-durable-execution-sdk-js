import {
  trace,
  Span,
  SpanStatusCode,
  Tracer,
  context,
  trace as traceApi,
} from "@opentelemetry/api";
import { Operation } from "@aws-sdk/client-lambda";
import type {
  SpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";

/**
 * Tracer name for the durable execution SDK
 */
const TRACER_NAME = "@aws/durable-execution-sdk-js";

/**
 * Get the tracer instance for the durable execution SDK
 * @returns The tracer instance
 */
export const getTracer = (): Tracer => {
  // Try to register the logging span processor when tracer is first accessed
  // This ensures the provider is initialized
  if (!spanProcessorRegistered) {
    registerLoggingSpanProcessor();
  }
  return trace.getTracer(TRACER_NAME);
};

/**
 * Recursively ends all active parent spans before a freeze operation.
 * This ensures all nested spans (e.g., child context -> parallel -> wait)
 * are ended and exported before the runtime freezes.
 *
 * OpenTelemetry uses AsyncLocalStorage to track the active span. When a span
 * is ended, the previous active span is restored in the context. By repeatedly
 * ending the active span, we walk up the parent chain and end all nested spans.
 *
 * @param excludeSpanName - Optional span name pattern to exclude from ending (e.g., "wait step")
 * @returns Array of span IDs that were ended
 */
export function endAllActiveParentSpans(excludeSpanName?: string): string[] {
  const endedSpanIds: string[] = [];
  let iterations = 0;
  const maxIterations = 100; // Safety limit to prevent infinite loops

  while (iterations < maxIterations) {
    const activeSpan = traceApi.getActiveSpan();

    if (!activeSpan) {
      // No more active spans
      break;
    }

    const activeSpanContext = activeSpan.spanContext();
    const spanName = (activeSpan as any).name || "unknown";

    // Check if we should exclude this span (e.g., the wait span itself)
    if (
      excludeSpanName &&
      (spanName === excludeSpanName || spanName.includes(excludeSpanName))
    ) {
      console.log(
        `[OTel] endAllActiveParentSpans: Excluding span "${spanName}" (spanId=${activeSpanContext.spanId}) from ending`,
      );
      break; // Stop here, don't end this span or any parent spans
    }

    // End this span
    console.log(
      `[OTel] endAllActiveParentSpans: Ending active span "${spanName}" (spanId=${activeSpanContext.spanId})`,
    );
    activeSpan.end();
    endedSpanIds.push(activeSpanContext.spanId);
    console.log(
      `[OTel] endAllActiveParentSpans: Successfully ended span "${spanName}" (spanId=${activeSpanContext.spanId})`,
    );

    iterations++;
  }

  if (iterations >= maxIterations) {
    console.warn(
      `[OTel] endAllActiveParentSpans: Reached max iterations (${maxIterations}), stopping to prevent infinite loop`,
    );
  }

  console.log(
    `[OTel] endAllActiveParentSpans: Ended ${endedSpanIds.length} parent span(s) before freeze`,
  );

  return endedSpanIds;
}

/**
 * Custom span processor that logs all spans before they are exported
 * This helps diagnose which spans are being processed by the OpenTelemetry SDK
 */
class LoggingSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: any): void {
    // Optional: log when span starts
  }

  onEnd(span: ReadableSpan): void {
    try {
      const spanContext = span.spanContext();
      const spanName = span.name || "unknown";
      const spanId = spanContext.spanId;
      const traceId = spanContext.traceId;
      const traceFlags = spanContext.traceFlags;
      // ReadableSpan may have different property names, try multiple approaches
      const spanAny = span as any;
      const isRecording =
        spanAny.isRecording?.() ?? spanAny._isRecording ?? true;
      const parentSpanId =
        spanAny.parentSpanId ??
        spanAny._parentSpanId ??
        spanAny.parent?.spanContext?.spanId ??
        "unknown";

      // Check if this is a NoOpSpan (non-recording span)
      const isNoOp =
        spanAny._span?.kind === undefined || spanAny.spanKind === undefined;
      const spanType = spanAny.constructor?.name || "unknown";

      console.log(
        `[OTel SpanProcessor:onEnd] Processing span for export: name="${spanName}", spanId=${spanId}, traceId=${traceId}, parentSpanId=${parentSpanId}, isRecording=${isRecording}, traceFlags=${traceFlags}, spanType=${spanType}, isNoOp=${isNoOp}`,
      );
    } catch (error) {
      console.error("[OTel SpanProcessor:onEnd] Error logging span:", error);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Try to register a custom span processor to log all spans before export
 * This will only work if we can access the tracer provider
 *
 * Set to false to disable span processor logging (useful when logs get too verbose)
 */
const ENABLE_SPAN_PROCESSOR_LOGGING = false;

let spanProcessorRegistered = false;
export function registerLoggingSpanProcessor(): void {
  if (!ENABLE_SPAN_PROCESSOR_LOGGING) {
    return;
  }

  if (spanProcessorRegistered) {
    return;
  }

  try {
    // Try to access the tracer provider from the API
    // The provider might be available through the trace API or require SDK access
    const tracerProvider = (trace as any).getTracerProvider?.();

    if (
      tracerProvider &&
      typeof tracerProvider.addSpanProcessor === "function"
    ) {
      const processor = new LoggingSpanProcessor();
      tracerProvider.addSpanProcessor(processor);
      spanProcessorRegistered = true;
      console.log("[OTel] Successfully registered logging span processor");
    } else {
      // Try alternative approach: access through the tracer
      const tracer = getTracer();
      const tracerAny = tracer as any;
      const provider = tracerAny._tracerProvider || tracerAny.provider;

      if (provider && typeof provider.addSpanProcessor === "function") {
        const processor = new LoggingSpanProcessor();
        provider.addSpanProcessor(processor);
        spanProcessorRegistered = true;
        console.log(
          "[OTel] Successfully registered logging span processor via tracer",
        );
      } else {
        console.warn(
          "[OTel] Could not access tracer provider to register span processor. Tracer provider may not be accessible.",
        );
      }
    }
  } catch (error) {
    console.warn("[OTel] Failed to register logging span processor:", error);
  }
}

// Attempt to register the processor immediately when this module is loaded
// This will only work if the tracer provider is already initialized
if (typeof process !== "undefined") {
  // Try to register immediately, but also allow manual registration later
  try {
    registerLoggingSpanProcessor();
  } catch (e) {
    // Ignore - will try again when tracer is used
  }
}

type SpanAttributeValue = string | number | boolean;

export interface OperationSpanOptions {
  operationType?: string;
  operationSubType?: string;
  operationId?: string;
  operationName?: string;
  executionArn?: string;
  parentId?: string;
  attempt?: number;
  executionMode?: string;
  attributes?: Record<string, SpanAttributeValue>;
}

const setOperationAttributes = (
  span: Span,
  options: OperationSpanOptions,
): void => {
  if (options.operationType) {
    span.setAttribute("durable.operation.type", options.operationType);
  }
  if (options.operationSubType) {
    span.setAttribute("durable.operation.sub_type", options.operationSubType);
  }
  if (options.operationId) {
    span.setAttribute("durable.operation.id", options.operationId);
  }
  if (options.operationName) {
    span.setAttribute("durable.operation.name", options.operationName);
  }
  if (options.executionArn) {
    span.setAttribute("durable.execution.arn", options.executionArn);
  }
  if (options.parentId) {
    span.setAttribute("durable.operation.parent_id", options.parentId);
  }
  if (options.attempt !== undefined) {
    span.setAttribute("durable.operation.attempt", options.attempt);
  }
  if (options.executionMode) {
    span.setAttribute("durable.execution.mode", options.executionMode);
  }
  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      span.setAttribute(key, value);
    }
  }
};

/**
 * Wraps a step execution with an OpenTelemetry span
 *
 * @param stepId - The unique identifier for the step
 * @param stepName - The optional name of the step
 * @param fn - The function to execute within the span
 * @returns The result of the function execution
 */
export async function withStepSpan<T>(
  stepId: string,
  stepName: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = stepName || stepId;

  // CRITICAL FIX: Capture both the active span AND the active context at the same time,
  // before any potential async operations or context switches. This ensures we use the
  // exact context that has the active span, not a potentially different context later.
  const activeContext = context.active();
  const activeSpan = traceApi.getActiveSpan();
  const activeSpanContext = activeSpan?.spanContext();

  // DIAGNOSTIC: Check if there's an active parent span when creating the step span
  if (!activeSpan) {
    console.warn(
      `[OTel] withStepSpan: No active parent span when creating step span "${spanName}" (stepId: ${stepId}). This may cause "Missing span" issues.`,
    );
  } else if (activeSpanContext) {
    // Log the parent span ID for debugging
    console.log(
      `[OTel] withStepSpan: Creating step span "${spanName}" (stepId: ${stepId}) with parent span ID: ${activeSpanContext.spanId}`,
    );
  }

  // If there's an active span, ensure its context is used when creating the step span
  // The activeContext already has the activeSpan set, so we don't need to set it again.
  // We just need to ensure startActiveSpan uses the current active context.
  // startActiveSpan automatically uses the current active context to determine the parent.
  if (activeSpan) {
    // DIAGNOSTIC: Verify the context is correct right before startActiveSpan
    const verifyActiveSpan = traceApi.getActiveSpan();
    const verifyActiveSpanContext = verifyActiveSpan?.spanContext();
    if (verifyActiveSpanContext && activeSpanContext) {
      if (verifyActiveSpanContext.spanId !== activeSpanContext.spanId) {
        console.warn(
          `[OTel] withStepSpan: Context mismatch! Expected parent ${activeSpanContext.spanId}, but active span is ${verifyActiveSpanContext.spanId}`,
        );
      } else {
        console.log(
          `[OTel] withStepSpan: Context verified - active span ${verifyActiveSpanContext.spanId} matches expected parent before startActiveSpan`,
        );
      }
    }
    // Use the current active context directly - startActiveSpan will automatically use it
    return tracer
      .startActiveSpan(spanName, async (span: Span) => {
        try {
          // DIAGNOSTIC: Log the actual span context to see what parent was used
          // Note: Inside the callback, getActiveSpan() returns the newly created span, not the parent
          // To get the parent, we need to check before startActiveSpan is called
          const spanContext = span.spanContext();
          const isRecording = span.isRecording();
          const traceFlags = spanContext.traceFlags;
          // Try to get parent span ID from various possible locations in the span object
          const spanAny = span as any;
          const parentSpanId =
            spanAny.parentSpanId ||
            spanAny._spanContext?.parentSpanId ||
            spanAny.parent?.spanContext?.spanId ||
            "unknown";
          // Also try to get the active parent span at this point
          const currentActiveSpan = traceApi.getActiveSpan();
          const currentActiveSpanId =
            currentActiveSpan?.spanContext().spanId || "none";
          console.log(
            `[OTel] withStepSpan: Step span "${spanName}" (stepId: ${stepId}) created with span ID: ${spanContext.spanId}, trace ID: ${spanContext.traceId}, isRecording: ${isRecording}, traceFlags: ${traceFlags}, parentSpanId: ${parentSpanId}, currentActiveSpanId: ${currentActiveSpanId}`,
          );

          // Add step metadata as span attributes
          span.setAttribute("durable.step.id", stepId);
          if (stepName) {
            span.setAttribute("durable.step.name", stepName);
          }
          setOperationAttributes(span, {
            operationType: "step",
            operationSubType: "Step",
            operationId: stepId,
            operationName: stepName,
            ...options,
          });

          const result = await fn();

          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          // Record the error in the span
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          if (error instanceof Error) {
            span.recordException(error);
          }

          throw error;
        } finally {
          const spanContextBeforeEnd = span.spanContext();
          const isRecordingBeforeEnd = span.isRecording();
          const traceFlagsBeforeEnd = spanContextBeforeEnd.traceFlags;
          span.end();
          console.log(
            `[OTel] withStepSpan: Step span "${spanName}" (stepId: ${stepId}) ended with span ID: ${spanContextBeforeEnd.spanId}, isRecording: ${isRecordingBeforeEnd}, traceFlags: ${traceFlagsBeforeEnd}`,
          );
        }
      })
      .then((result) => {
        console.log(
          `[OTel] withStepSpan: Step span "${spanName}" (stepId: ${stepId}) promise resolved, span should be exported`,
        );
        return result;
      })
      .catch((error) => {
        console.error(
          `[OTel] withStepSpan: Step span "${spanName}" (stepId: ${stepId}) promise rejected:`,
          error,
        );
        throw error;
      });
  }

  // Fallback: if no active span, use the current context (shouldn't happen in normal flow)
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      // DIAGNOSTIC: Log the actual span context to see what parent was used
      const spanContext = span.spanContext();
      console.log(
        `[OTel] withStepSpan: Step span "${spanName}" (stepId: ${stepId}) created with span ID: ${spanContext.spanId}, trace ID: ${spanContext.traceId} (no active parent)`,
      );

      // Add step metadata as span attributes
      span.setAttribute("durable.step.id", stepId);
      if (stepName) {
        span.setAttribute("durable.step.name", stepName);
      }
      setOperationAttributes(span, {
        operationType: "step",
        operationSubType: "Step",
        operationId: stepId,
        operationName: stepName,
        ...options,
      });

      const result = await fn();

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Record the error in the span
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        span.recordException(error);
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps a parallel branch execution with an OpenTelemetry span
 *
 * @param branchId - The unique identifier for the branch
 * @param branchName - The optional name of the branch
 * @param fn - The function to execute within the span
 * @returns The result of the function execution
 */
export async function withParallelBranchSpan<T>(
  branchId: string,
  branchName: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = branchName || branchId;
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      // Add parallel branch metadata as span attributes
      span.setAttribute("durable.parallel.branch.id", branchId);
      if (branchName) {
        span.setAttribute("durable.parallel.branch.name", branchName);
      }
      setOperationAttributes(span, {
        operationType: "parallel-branch",
        operationSubType: "ParallelBranch",
        operationId: branchId,
        operationName: branchName,
        ...options,
      });

      const result = await fn();

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Record the error in the span
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        span.recordException(error);
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps a parallel operation execution with an OpenTelemetry span
 *
 * @param parallelName - The optional name of the parallel operation
 * @param fn - The function to execute within the span (wraps the entire parallel execution)
 * @returns The result of the function execution
 */
export async function withParallelSpan<T>(
  parallelName: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = parallelName || "parallel";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      // Add parallel operation metadata as span attributes
      if (parallelName) {
        span.setAttribute("durable.parallel.name", parallelName);
      }
      setOperationAttributes(span, {
        operationType: "parallel",
        operationSubType: "Parallel",
        operationId: parallelName || "parallel",
        operationName: parallelName,
        ...options,
      });

      const result = await fn();

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Record the error in the span
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        span.recordException(error);
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps a run-in-child-context execution with an OpenTelemetry span
 *
 * @param entityId - The unique identifier for the child context
 * @param name - The optional name of the child context
 * @param fn - The function to execute within the span
 * @returns The result of the function execution
 */
export async function withRunInChildContextSpan<T>(
  entityId: string,
  name: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = name || entityId;

  // CRITICAL: startActiveSpan automatically uses the current active context to determine
  // the parent span. When execution resumes after a checkpoint in a new Lambda invocation,
  // the OpenTelemetry context should be re-established by the durable-execution span wrapper.
  // However, we need to ensure this span is created synchronously when fn() executes,
  // not asynchronously, to ensure proper parent-child relationships.
  //
  // The key insight: startActiveSpan uses AsyncLocalStorage internally to track the active
  // span context. If the parent span (durable-execution) is active when this is called,
  // the child context span will automatically be linked to it. If not, it will be a root span.
  //
  // CRITICAL FIX: Capture both the active span AND the active context at the same time,
  // before any potential async operations or context switches. This ensures we use the
  // exact context that has the active span, not a potentially different context later.
  const activeContext = context.active();
  const activeSpan = traceApi.getActiveSpan();
  const activeSpanContext = activeSpan?.spanContext();

  // Log diagnostic information to help debug "Missing span" issues
  // This will help us understand if the parent span is active when the child context span is created
  if (!activeSpan) {
    console.warn(
      `[OTel] withRunInChildContextSpan: No active parent span when creating child context span "${spanName}" (entityId: ${entityId}). This may cause "Missing span" issues.`,
    );
  } else if (activeSpanContext) {
    // Log the parent span ID for debugging
    console.log(
      `[OTel] withRunInChildContextSpan: Creating child context span "${spanName}" (entityId: ${entityId}) with parent span ID: ${activeSpanContext.spanId}`,
    );
  }

  // If there's an active span, ensure its context is used when creating the child context span
  // The activeContext already has the activeSpan set, so we don't need to set it again.
  // We just need to ensure startActiveSpan uses the current active context.
  // startActiveSpan automatically uses the current active context to determine the parent.
  if (activeSpan) {
    // DIAGNOSTIC: Verify the context is correct right before startActiveSpan
    const verifyActiveSpan = traceApi.getActiveSpan();
    const verifyActiveSpanContext = verifyActiveSpan?.spanContext();
    if (verifyActiveSpanContext && activeSpanContext) {
      if (verifyActiveSpanContext.spanId !== activeSpanContext.spanId) {
        console.warn(
          `[OTel] withRunInChildContextSpan: Context mismatch! Expected parent ${activeSpanContext.spanId}, but active span is ${verifyActiveSpanContext.spanId}`,
        );
      } else {
        console.log(
          `[OTel] withRunInChildContextSpan: Context verified - active span ${verifyActiveSpanContext.spanId} matches expected parent before startActiveSpan`,
        );
      }
    }
    // Use the current active context directly - startActiveSpan will automatically use it
    console.log(
      `[OTel] withRunInChildContextSpan: About to call startActiveSpan for "${spanName}" (entityId: ${entityId})`,
    );
    const spanPromise = tracer.startActiveSpan(spanName, async (span: Span) => {
      console.log(
        `[OTel] withRunInChildContextSpan: INSIDE startActiveSpan callback for "${spanName}" (entityId: ${entityId}) - span callback executed!`,
      );
      let spanEnded = false;
      try {
        // DIAGNOSTIC: Log the actual child context span ID to verify parent-child relationships
        const spanContext = span.spanContext();
        const isRecording = span.isRecording();
        const traceFlags = spanContext.traceFlags;
        // Try to get parent span ID from various possible locations in the span object
        const spanAny = span as any;
        const parentSpanId =
          spanAny.parentSpanId ||
          spanAny._spanContext?.parentSpanId ||
          spanAny.parent?.spanContext?.spanId ||
          "unknown";
        // Also try to get the active parent span at this point
        const currentActiveSpan = traceApi.getActiveSpan();
        const currentActiveSpanId =
          currentActiveSpan?.spanContext().spanId || "none";
        // Check if this is a NoOpSpan (non-recording span)
        const spanType = spanAny.constructor?.name || "unknown";
        const isNoOpSpan =
          spanType.includes("NoOp") || spanType.includes("NonRecording");

        console.log(
          `[OTel] withRunInChildContextSpan: Child context span "${spanName}" (entityId: ${entityId}) created with span ID: ${spanContext.spanId}, trace ID: ${spanContext.traceId}, isRecording: ${isRecording}, traceFlags: ${traceFlags}, parentSpanId: ${parentSpanId}, currentActiveSpanId: ${currentActiveSpanId}, spanType=${spanType}, isNoOpSpan=${isNoOpSpan}`,
        );

        if (isNoOpSpan || !isRecording) {
          console.warn(
            `[OTel] withRunInChildContextSpan: WARNING - Span "${spanName}" (entityId: ${entityId}) is a NoOpSpan or not recording! This span will NOT be exported.`,
          );
        }

        // Add child context metadata as span attributes
        span.setAttribute("durable.child-context.id", entityId);
        if (name) {
          span.setAttribute("durable.child-context.name", name);
        }
        setOperationAttributes(span, {
          operationType: "run-in-child-context",
          operationSubType: "RunInChildContext",
          operationId: entityId,
          operationName: name,
          ...options,
        });

        const result = await fn();

        // CRITICAL: End the span IMMEDIATELY after the function completes, BEFORE returning.
        // This ensures span.end() is called before any checkpointing or serialization that might
        // cause the Lambda runtime to freeze. The checkpoint happens AFTER this function returns,
        // so we need to end the span synchronously here to ensure it's exported before freezing.
        span.setStatus({ code: SpanStatusCode.OK });
        const spanContextBeforeEnd = span.spanContext();
        const isRecordingBeforeEnd = span.isRecording();
        const traceFlagsBeforeEnd = spanContextBeforeEnd.traceFlags;
        console.log(
          `[OTel] withRunInChildContextSpan: Ending span BEFORE return for "${spanName}" (entityId: ${entityId}) with span ID: ${spanContextBeforeEnd.spanId}, isRecording: ${isRecordingBeforeEnd}, traceFlags: ${traceFlagsBeforeEnd}`,
        );
        span.end();
        console.log(
          `[OTel] withRunInChildContextSpan: span.end() completed for "${spanName}" (entityId: ${entityId}) with span ID: ${spanContextBeforeEnd.spanId}`,
        );
        spanEnded = true;

        return result;
      } catch (error) {
        // Record the error in the span
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error) {
          span.recordException(error);
        }

        // CRITICAL: End the span IMMEDIATELY in the error case too, BEFORE throwing.
        // This ensures span.end() is called even on errors, before any checkpointing that might freeze.
        const spanContextBeforeEnd = span.spanContext();
        const isRecordingBeforeEnd = span.isRecording();
        const traceFlagsBeforeEnd = spanContextBeforeEnd.traceFlags;
        console.log(
          `[OTel] withRunInChildContextSpan: Ending span on error BEFORE throw for "${spanName}" (entityId: ${entityId}) with span ID: ${spanContextBeforeEnd.spanId}, isRecording: ${isRecordingBeforeEnd}, traceFlags: ${traceFlagsBeforeEnd}`,
        );
        span.end();
        console.log(
          `[OTel] withRunInChildContextSpan: span.end() completed on error for "${spanName}" (entityId: ${entityId}) with span ID: ${spanContextBeforeEnd.spanId}`,
        );
        spanEnded = true;

        throw error;
      } finally {
        // Safety net: if span wasn't ended in try/catch (shouldn't happen, but just in case)
        if (!spanEnded) {
          console.warn(
            `[OTel] withRunInChildContextSpan: WARNING - Span "${spanName}" (entityId: ${entityId}) was not ended in try/catch, ending in finally block as fallback`,
          );
          const spanContextBeforeEnd = span.spanContext();
          span.end();
          console.log(
            `[OTel] withRunInChildContextSpan: span.end() called in finally fallback for "${spanName}" (entityId: ${entityId}) with span ID: ${spanContextBeforeEnd.spanId}`,
          );
        }
      }
    });
    console.log(
      `[OTel] withRunInChildContextSpan: startActiveSpan returned promise for "${spanName}" (entityId: ${entityId})`,
    );
    return spanPromise
      .then((result) => {
        console.log(
          `[OTel] withRunInChildContextSpan: Child context span "${spanName}" (entityId: ${entityId}) promise resolved, span should be exported`,
        );
        return result;
      })
      .catch((error) => {
        console.error(
          `[OTel] withRunInChildContextSpan: Child context span "${spanName}" (entityId: ${entityId}) promise rejected:`,
          error,
        );
        throw error;
      });
  }

  // Fallback: if no active span, use the current context (shouldn't happen in normal flow)
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      // DIAGNOSTIC: Log the actual child context span ID to verify parent-child relationships
      const spanContext = span.spanContext();
      console.log(
        `[OTel] withRunInChildContextSpan: Child context span "${spanName}" (entityId: ${entityId}) created with span ID: ${spanContext.spanId}, trace ID: ${spanContext.traceId} (no active parent)`,
      );

      // Add child context metadata as span attributes
      span.setAttribute("durable.child-context.id", entityId);
      if (name) {
        span.setAttribute("durable.child-context.name", name);
      }
      setOperationAttributes(span, {
        operationType: "run-in-child-context",
        operationSubType: "RunInChildContext",
        operationId: entityId,
        operationName: name,
        ...options,
      });

      const result = await fn();

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Record the error in the span
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        span.recordException(error);
      }

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps a wait operation execution with an OpenTelemetry span
 * Handles the two-phase execution model where the wait spans across Lambda invocations.
 * Uses StartTimestamp from stepData to create a span that represents the full wait duration.
 *
 * @param stepId - The unique identifier for the wait operation
 * @param waitName - The optional name of the wait operation
 * @param stepData - The step data containing timing information (StartTimestamp, WaitDetails)
 * @param waitDurationSeconds - The duration of the wait in seconds
 * @param fn - The function to execute within the span (typically Phase 2 of wait execution)
 * @returns The result of the function execution
 */
export async function withWaitSpan<T>(
  stepId: string,
  waitName: string | undefined,
  stepData: Operation | undefined,
  waitDurationSeconds: number,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = "wait step";

  // Determine the start time for the span
  let startTime: number | Date | undefined;

  if (stepData?.StartTimestamp) {
    // Use StartTimestamp from stepData if available (most accurate)
    startTime = stepData.StartTimestamp;
  } else if (stepData?.WaitDetails?.ScheduledEndTimestamp) {
    // Fall back to calculating start time from ScheduledEndTimestamp
    const endTime = stepData.WaitDetails.ScheduledEndTimestamp;
    const endTimeMs =
      endTime instanceof Date ? endTime.getTime() : new Date(endTime).getTime();
    startTime = new Date(endTimeMs - waitDurationSeconds * 1000);
  } else {
    // If no timing information is available, use current time
    // This shouldn't happen in normal operation, but provides a fallback
    startTime = Date.now();
  }

  // Convert startTime to milliseconds if it's a Date
  const startTimeMs =
    startTime instanceof Date
      ? startTime.getTime()
      : typeof startTime === "number"
        ? startTime
        : Date.now();

  // Create span with custom start time
  const span = tracer.startSpan(spanName, {
    startTime: startTimeMs,
  });

  try {
    // Add wait metadata as span attributes
    span.setAttribute("durable.wait.id", stepId);
    if (waitName) {
      span.setAttribute("durable.wait.name", waitName);
    }
    setOperationAttributes(span, {
      operationType: "wait",
      operationSubType: "Wait",
      operationId: stepId,
      operationName: waitName,
      ...options,
      attributes: {
        "durable.wait.duration.seconds": waitDurationSeconds,
        ...(options.attributes || {}),
      },
    });

    // CRITICAL: For wait operations, fn() may call waitForStatusChange which freezes the runtime.
    // We need to end the span BEFORE fn() completes if it's going to freeze, not after.
    // However, wait operations are special - they span multiple invocations. The wait starts
    // in one invocation, freezes, and completes in a later invocation.
    //
    // The solution: End the span immediately after fn() completes (which happens after
    // waitForStatusChange returns in the next invocation), but ensure we're not in a freeze state.
    // Actually, waitForStatusChange returns when the wait completes, so fn() completing means
    // the wait is done. We can safely end the span here.
    const result = await fn();

    // End span with current time - this happens after waitForStatusChange returns
    // (which means the wait completed in this or a previous invocation)
    const endTime = Date.now();
    span.setStatus({ code: SpanStatusCode.OK });
    console.log(
      `[OTel] withWaitSpan: Ending wait span for stepId=${stepId} before returning result`,
    );
    span.end(endTime);
    console.log(`[OTel] withWaitSpan: Wait span ended for stepId=${stepId}`);

    return result;
  } catch (error) {
    // Record the error in the span
    const endTime = Date.now();
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      span.recordException(error);
    }

    span.end(endTime);
    throw error;
  }
}

export async function withMapSpan<T>(
  mapName: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = mapName || "map";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "map",
        operationSubType: "Map",
        operationId: mapName || "map",
        operationName: mapName,
        ...options,
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withMapIterationSpan<T>(
  itemId: string,
  itemName: string | undefined,
  itemIndex: number,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = itemName || itemId;
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "map-iteration",
        operationSubType: "MapIteration",
        operationId: itemId,
        operationName: itemName,
        ...options,
        attributes: {
          "durable.map.item.index": itemIndex,
          "durable.map.item.id": itemId,
          ...(itemName ? { "durable.map.item.name": itemName } : {}),
          ...(options.attributes || {}),
        },
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withInvokeSpan<T>(
  stepId: string,
  name: string | undefined,
  functionId: string,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = name || "invoke";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "invoke",
        operationSubType: "ChainedInvoke",
        operationId: stepId,
        operationName: name,
        ...options,
        attributes: {
          "durable.invoke.function_id": functionId,
          ...(options.attributes || {}),
        },
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withCallbackSpan<T>(
  stepId: string,
  name: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = name || "callback";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "callback",
        operationSubType: "Callback",
        operationId: stepId,
        operationName: name,
        ...options,
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withWaitForCallbackSpan<T>(
  stepId: string,
  name: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = name || "wait-for-callback";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "wait-for-callback",
        operationSubType: "WaitForCallback",
        operationId: stepId,
        operationName: name,
        ...options,
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withWaitForConditionSpan<T>(
  stepId: string,
  name: string | undefined,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  const spanName = name || "wait-for-condition";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "wait-for-condition",
        operationSubType: "WaitForCondition",
        operationId: stepId,
        operationName: name,
        ...options,
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withExecutionSpan<T>(
  executionName: string,
  fn: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(executionName, async (span: Span) => {
    try {
      setOperationAttributes(span, {
        operationType: "execution",
        operationSubType: "Execution",
        operationId: executionName,
        operationName: executionName,
        ...options,
      });

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
