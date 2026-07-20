// 4-4: Create callback heartbeat timeout (no heartbeat sent)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      heartbeatTimeout: { seconds: 5 },
    });
    return await callbackPromise;
  },
);
