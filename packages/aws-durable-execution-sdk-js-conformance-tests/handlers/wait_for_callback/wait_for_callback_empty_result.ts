// 7-15: Wait-for-callback success with empty (null) payload
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCallback(event, async (callbackId) => {
      // Submitter completes; external system sends success with no payload.
    });
    return result;
  },
);
