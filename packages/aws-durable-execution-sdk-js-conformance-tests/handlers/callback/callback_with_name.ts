// 4-2: Create callback with explicit name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>("approval");
    return await callbackPromise;
  },
);
