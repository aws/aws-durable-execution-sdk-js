// 7-5: Wait-for-callback timeout (no external completion)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // No external system ever completes the callback — it times out.
    const result = await context.waitForCallback(
      event,
      async (callbackId) => {
        // Submitter completes successfully.
      },
      {
        timeout: { seconds: 3 },
      },
    );
    return result;
  },
);
