// 4-5: Create callback with heartbeat then success
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      heartbeatTimeout: { seconds: 10 },
    });
    return await callbackPromise;
  },
);
