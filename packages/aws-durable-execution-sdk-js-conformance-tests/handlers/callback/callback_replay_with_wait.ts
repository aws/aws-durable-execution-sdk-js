// 4-12: Callback success → Wait → verify replay
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event);
    const cbResult = await callbackPromise;
    await context.wait("after-cb", { seconds: 2 });
    return cbResult;
  },
);
