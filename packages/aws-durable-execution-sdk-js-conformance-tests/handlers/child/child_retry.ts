// 3-7: Child context with step retry (fails then succeeds)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "retry-child",
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(
          async (stepContext) => {
            // SDK-native per-step attempt counter (1-based, +1 per retry).
            if (stepContext.attempt < 2) {
              throw new Error(`Attempt ${stepContext.attempt} failed`);
            }
            return event as string;
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
        return stepResult;
      },
    );
    return result;
  },
);
