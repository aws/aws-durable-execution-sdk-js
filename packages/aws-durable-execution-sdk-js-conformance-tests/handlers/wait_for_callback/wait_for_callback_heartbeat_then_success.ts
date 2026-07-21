// 7-13: Wait-for-callback with heartbeat then success
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCallback(
      event,
      async (callbackId) => {
        // Submitter completes; external system will heartbeat then succeed.
      },
      {
        heartbeatTimeout: { seconds: 10 },
      },
    );
    return result;
  },
);
