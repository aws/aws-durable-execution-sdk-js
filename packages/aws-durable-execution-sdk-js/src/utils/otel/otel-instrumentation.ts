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
      span.setAttribute("durable.operation.type", "step");

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
      span.setAttribute("durable.operation.type", "parallel-branch");

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
): Promise<T> {
  const tracer = getTracer();
  const spanName = parallelName || "parallel";
  return tracer.startActiveSpan(spanName, async (span: Span) => {
    try {
      // Add parallel operation metadata as span attributes
      if (parallelName) {
        span.setAttribute("durable.parallel.name", parallelName);
      }
      span.setAttribute("durable.operation.type", "parallel");

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
      span.setAttribute("durable.operation.type", "run-in-child-context");

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
    span.setAttribute("durable.operation.type", "wait");
    span.setAttribute("durable.wait.duration.seconds", waitDurationSeconds);

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
