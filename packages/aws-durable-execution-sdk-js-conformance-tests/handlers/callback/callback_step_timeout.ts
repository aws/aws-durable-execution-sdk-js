// 4-8: Callback + Step + Wait for callback result (timeout)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      timeout: { seconds: 5 },
    });

    await context.step("notify-external", async () => "notified");

    return await callbackPromise; // rejects on timeout → execution fails
  },
);
