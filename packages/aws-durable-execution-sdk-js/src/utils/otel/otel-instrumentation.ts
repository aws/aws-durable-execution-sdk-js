import {
  trace,
  Span,
  SpanStatusCode,
  Tracer,
  trace as traceApi,
} from "@opentelemetry/api";
import { Operation } from "@aws-sdk/client-lambda";
import { hashId } from "../step-id-utils/step-id-utils";

/**
 * Tracer name for the durable execution SDK
 */
const TRACER_NAME = "@aws/durable-execution-sdk-js";

/**
 * Get the tracer instance for the durable execution SDK
 * @returns The tracer instance
 */
export const getTracer = (): Tracer => {
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
  const alreadyProcessedSpanIds = new Set<string>(); // Track spans we've already processed to prevent duplicates
  let iterations = 0;
  const maxIterations = 100; // Safety limit to prevent infinite loops

  while (iterations < maxIterations) {
    const activeSpan = traceApi.getActiveSpan();

    if (!activeSpan) {
      // No more active spans
      break;
    }

    const activeSpanContext = activeSpan.spanContext();
    const spanId = activeSpanContext.spanId;
    const spanName = (activeSpan as any).name || "unknown";

    // CRITICAL: Check if we've already processed this span ID in this call
    // This prevents the "You can only call end() on a span once" error
    // when getActiveSpan() keeps returning the same span reference
    if (alreadyProcessedSpanIds.has(spanId)) {
      break; // We've looped back to a span we already processed, so stop
    }

    // Mark this span as processed
    alreadyProcessedSpanIds.add(spanId);

    // Check if we should exclude this span (e.g., the wait span itself)
    if (
      excludeSpanName &&
      (spanName === excludeSpanName || spanName.includes(excludeSpanName))
    ) {
      break; // Stop here, don't end this span or any parent spans
    }

    // Check if the span is still recording (not already ended)
    // This can happen if the span was already ended by another code path
    if (!activeSpan.isRecording()) {
      // Even though this span is not recording, it's still in the active context.
      // Continue to try to process the next iteration
      iterations++;
      continue;
    }

    // End this span
    activeSpan.end();
    endedSpanIds.push(spanId);

    iterations++;
  }

  return endedSpanIds;
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
    // Set both hashed (for correlation with logs/backend) and raw (for debugging)
    span.setAttribute("durable.operation.id", hashId(options.operationId));
    span.setAttribute("durable.operation.id.raw", options.operationId);
  }
  if (options.operationName) {
    span.setAttribute("durable.operation.name", options.operationName);
  }
  if (options.executionArn) {
    span.setAttribute("durable.execution.arn", options.executionArn);
  }
  if (options.parentId) {
    // Set both hashed (for correlation with logs/backend) and raw (for debugging)
    span.setAttribute("durable.operation.parent_id", hashId(options.parentId));
    span.setAttribute("durable.operation.parent_id.raw", options.parentId);
  }
  if (options.attempt !== undefined) {
    span.setAttribute("durable.operation.attempt", options.attempt);
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

  // CRITICAL FIX: Capture the active span before any potential async operations or context switches.
  const activeSpan = traceApi.getActiveSpan();

  // If there's an active span, ensure its context is used when creating the step span
  // startActiveSpan automatically uses the current active context to determine the parent.
  if (activeSpan) {
    return tracer.startActiveSpan(spanName, async (span: Span) => {
      try {
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

  // Fallback: if no active span, use the current context (shouldn't happen in normal flow)
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
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
      // Record the error in the span (only if still recording)
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error) {
          span.recordException(error);
        }
      }

      throw error;
    } finally {
      // Only end if still recording (not already ended by endAllActiveParentSpans)
      if (span.isRecording()) {
        span.end();
      }
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
      // Record the error in the span (only if still recording)
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error) {
          span.recordException(error);
        }
      }

      throw error;
    } finally {
      // Only end if still recording (not already ended by endAllActiveParentSpans)
      if (span.isRecording()) {
        span.end();
      }
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
      // Record the error in the span (only if still recording)
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error) {
          span.recordException(error);
        }
      }

      throw error;
    } finally {
      // Only end if still recording (not already ended by endAllActiveParentSpans)
      if (span.isRecording()) {
        span.end();
      }
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

  // startActiveSpan automatically uses the current active context to determine the parent span.
  // The key insight: startActiveSpan uses AsyncLocalStorage internally to track the active
  // span context. If the parent span (durable-execution) is active when this is called,
  // the child context span will automatically be linked to it. If not, it will be a root span.
  const activeSpan = traceApi.getActiveSpan();

  if (activeSpan) {
    return tracer.startActiveSpan(spanName, async (span: Span) => {
      let spanEnded = false;
      try {
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

        // End the span IMMEDIATELY after the function completes, BEFORE returning.
        // This ensures span.end() is called before any checkpointing or serialization that might
        // cause the Lambda runtime to freeze.
        //
        // Check if span is still recording before ending. If a wait/invoke operation
        // was called inside fn(), the endAllActiveParentSpans() function may have already ended
        // this span before the freeze.
        if (span.isRecording()) {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        }
        spanEnded = true;

        return result;
      } catch (error) {
        // End the span IMMEDIATELY in the error case too, BEFORE throwing.
        if (span.isRecording()) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          if (error instanceof Error) {
            span.recordException(error);
          }

          span.end();
        }
        spanEnded = true;

        throw error;
      } finally {
        // Safety net: if span wasn't ended in try/catch (shouldn't happen, but just in case)
        if (!spanEnded && span.isRecording()) {
          span.end();
        }
      }
    });
  }

  // Fallback: if no active span, use the current context (shouldn't happen in normal flow)
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
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
      // Record the error in the span (only if still recording)
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error) {
          span.recordException(error);
        }
      }

      throw error;
    } finally {
      // Only end if still recording (not already ended by endAllActiveParentSpans)
      if (span.isRecording()) {
        span.end();
      }
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
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

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

    span.end();
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
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
      if (span.isRecording()) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
      }
      throw error;
    } finally {
      if (span.isRecording()) {
        span.end();
      }
    }
  });
}
