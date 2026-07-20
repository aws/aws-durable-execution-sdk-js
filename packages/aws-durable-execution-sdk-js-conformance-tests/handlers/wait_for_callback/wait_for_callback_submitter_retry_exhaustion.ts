// 7-7: Wait-for-callback submitter retry exhaustion
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Submitter always throws. Retry budget: 2 attempts (1 retry), 1s delay.
    const result = await context.waitForCallback(
      event,
      async (callbackId) => {
        throw new Error("submitter always fails");
      },
      {
        retryStrategy: (_error: Error, attemptCount: number) => ({
          shouldRetry: attemptCount < 2,
          delay: { seconds: 1 },
        }),
      },
    );
    return result;
  },
);
