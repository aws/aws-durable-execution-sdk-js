// 7-8: Wait-for-callback inside a child context
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "wrapper",
      async (childCtx) => {
        return await childCtx.waitForCallback(event, async (callbackId) => {
          // Submitter completes inside child context.
        });
      },
    );
    return result;
  },
);
