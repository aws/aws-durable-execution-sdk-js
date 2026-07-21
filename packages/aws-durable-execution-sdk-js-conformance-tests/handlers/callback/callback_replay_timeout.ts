// 4-14: Replay - Callback timeout caught → Wait → return
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event, {
      timeout: { seconds: 3 },
    });

    let outcome: string;
    try {
      outcome = await callbackPromise;
    } catch (e) {
      outcome = `caught_timeout:${(e as Error).message}`;
    }

    await context.wait("after-cb", { seconds: 2 });

    return outcome;
  },
);
