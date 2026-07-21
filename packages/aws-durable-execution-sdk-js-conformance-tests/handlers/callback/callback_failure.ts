// 4-6: Callback failure (external system reports failure)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event);
    // Do not catch — let the rejection propagate so the execution fails.
    return await callbackPromise;
  },
);
