// 4-10: Callback + Wait + Wait for callback result (failure)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event);
    await context.wait("delay", { seconds: 5 });
    return await callbackPromise; // rejects on failure → execution fails
  },
);
