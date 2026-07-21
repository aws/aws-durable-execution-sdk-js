// 7-1: Wait-for-callback basic (success via external callback)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCallback(event, async (callbackId) => {
      // Submitter receives callbackId; does nothing durable.
    });
    return result;
  },
);
