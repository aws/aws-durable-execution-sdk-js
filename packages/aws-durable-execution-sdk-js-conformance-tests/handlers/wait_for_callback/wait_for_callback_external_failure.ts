// 7-4: Wait-for-callback external failure (uncaught)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Do not catch — let the external failure propagate so execution fails.
    const result = await context.waitForCallback(event, async (callbackId) => {
      // Submitter completes successfully.
    });
    return result;
  },
);
