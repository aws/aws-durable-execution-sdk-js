// 7-9: Multiple sequential wait-for-callback operations
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const firstResult = await context.waitForCallback(
      "first",
      async (callbackId) => {
        // First submitter completes.
      },
    );

    const secondResult = await context.waitForCallback(
      "second",
      async (callbackId) => {
        // Second submitter completes.
      },
    );

    return secondResult;
  },
);
