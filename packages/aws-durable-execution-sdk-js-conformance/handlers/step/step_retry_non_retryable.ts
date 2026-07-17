// 1-16: Retry specific exception (non-retryable fails)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        throw new TransientError("Temporary failure");
      },
      {
        retryStrategy: (error: Error, attempts: number) => {
          // Only retry ValidationError, not TransientError
          if (error.name === "ValidationError" && attempts < 3) {
            return { shouldRetry: true, delay: { seconds: 1 } };
          }
          return { shouldRetry: false };
        },
      },
    );
    return result;
  },
);
