// 7-12: Wait-for-callback heartbeat timeout (no heartbeat sent)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // No heartbeat or terminal callback sent — heartbeat interval times out.
    const result = await context.waitForCallback(
      event,
      async (callbackId) => {
        // Submitter completes.
      },
      {
        heartbeatTimeout: { seconds: 5 },
      },
    );
    return result;
  },
);
