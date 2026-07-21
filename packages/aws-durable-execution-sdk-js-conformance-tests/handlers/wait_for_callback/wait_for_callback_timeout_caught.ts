// 7-14: Wait-for-callback timeout caught (recovers)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    try {
      return await context.waitForCallback(
        event,
        async (callbackId) => {
          // Submitter completes; no external callback arrives.
        },
        {
          timeout: { seconds: 3 },
        },
      );
    } catch (e) {
      return "timed-out-handled";
    }
  },
);
