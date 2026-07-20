// 1-11: Step with retry (fails on first attempt, succeeds on second)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async (stepContext) => {
        // Use the SDK-native per-step attempt counter (1 on first execution,
        // incremented by 1 on each retry) instead of external state.
        if (stepContext.attempt < 2) {
          throw new Error(`Attempt ${stepContext.attempt} failed`);
        }
        return "Operation succeeded";
      },
      {
        retryStrategy: (_error: Error, attempts: number) => {
          if (attempts >= 3) {
            return { shouldRetry: false };
          }
          return { shouldRetry: true, delay: { seconds: 1 } };
        },
      },
    );

    return result;
  },
);
