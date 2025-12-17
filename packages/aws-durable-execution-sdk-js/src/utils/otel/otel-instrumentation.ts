import { trace, Span, SpanStatusCode, Tracer } from "@opentelemetry/api";

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
