// 7-6: Wait-for-callback external failure caught (recovers)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    try {
      return await context.waitForCallback(event, async (callbackId) => {
        // Submitter completes successfully.
      });
    } catch (e) {
      return "recovered";
    }
  },
);
