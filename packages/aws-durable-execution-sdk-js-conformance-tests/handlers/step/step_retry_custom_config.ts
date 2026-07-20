// 1-14: Retry with custom config (fails twice, succeeds on third attempt)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async (stepContext) => {
        // Native per-step attempt counter (1-based, increments on each retry).
        if (stepContext.attempt < 3) {
          throw new Error(`Attempt ${stepContext.attempt} failed`);
        }
        return "finally succeeded";
      },
      {
        retryStrategy: createRetryStrategy({
          maxAttempts: 5,
          initialDelay: { seconds: 2 },
          backoffRate: 3,
          jitter: JitterStrategy.NONE,
        }),
      },
    );

    return result;
  },
);
