// 3-8: Child context with step retry exhaustion (child fails)
import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "exhaust-child",
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(
          async () => {
            throw new Error("Always fails");
          },
          {
            retryStrategy: createRetryStrategy({
              maxAttempts: 2,
              initialDelay: { seconds: 1 },
              backoffRate: 1,
              jitter: JitterStrategy.NONE,
            }),
          },
        );
        return stepResult;
      },
    );
    return result;
  },
);
