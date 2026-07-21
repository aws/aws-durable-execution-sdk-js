// 4-11: Callback + Wait + Wait for callback result (timeout)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      timeout: { seconds: 3 },
    });
    await context.wait("delay", { seconds: 6 });
    return await callbackPromise; // callback timeout < wait → throws after wait completes
  },
);
