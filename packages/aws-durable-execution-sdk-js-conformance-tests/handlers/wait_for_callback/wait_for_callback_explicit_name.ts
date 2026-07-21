// 7-2: Wait-for-callback with explicit static name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const result = await context.waitForCallback(
      "approval",
      async (callbackId) => {
        // Submitter completes without side effects.
      },
    );
    return result;
  },
);
