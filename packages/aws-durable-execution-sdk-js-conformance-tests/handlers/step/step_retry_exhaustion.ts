// 1-12: Retry exhaustion (max attempts)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        throw new Error("Always fails");
      },
      {
        retryStrategy: createRetryStrategy({
          maxAttempts: 4,
          initialDelay: { seconds: 1 },
          backoffRate: 1,
          jitter: JitterStrategy.NONE,
        }),
      },
    );
    return result;
  },
);
