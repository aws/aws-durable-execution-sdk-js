// 7-3: Wait-for-callback with anonymous submitter (no name)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const result = await context.waitForCallback(async (callbackId) => {
      // Anonymous submitter — no name provided.
    });
    return result;
  },
);
