// 4-3: Create callback general timeout (no external callback sent)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      timeout: { seconds: 5 },
    });
    return await callbackPromise;
  },
);
