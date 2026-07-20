// 4-7: Callback + Step + Wait for callback result (failure)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event);

    await context.step("notify-external", async () => "notified");

    return await callbackPromise; // rejects on failure → execution fails
  },
);
