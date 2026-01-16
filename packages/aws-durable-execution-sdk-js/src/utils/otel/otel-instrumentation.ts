import { trace, Span, SpanStatusCode, Tracer } from "@opentelemetry/api";
import { Operation } from "@aws-sdk/client-lambda";

/**
 * Tracer name for the durable execution SDK
 */
const TRACER_NAME = "@aws/durable-execution-sdk-js";

/**
 * Get the tracer instance for the durable execution SDK
 * @returns The tracer instance
 */
export const getTracer = (): Tracer => trace.getTracer(TRACER_NAME);

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

    const result = await fn();

    // End span with current time
    const endTime = Date.now();
    span.setStatus({ code: SpanStatusCode.OK });
    span.end(endTime);

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
