// 1-15: Retry specific exception (transient error retried, succeeds on second attempt)
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
      async (stepContext) => {
        // Native per-step attempt counter (1-based, increments on each retry).
        if (stepContext.attempt < 2) {
          throw new TransientError("Temporary failure");
        }
        return "recovered from transient";
      },
      {
        retryStrategy: (error: Error, attempts: number) => {
          if (error.name === "TransientError" && attempts < 3) {
            return { shouldRetry: true, delay: { seconds: 1 } };
          }
          return { shouldRetry: false };
        },
      },
    );

    return result;
  },
);
