// 4-13: Replay - Callback failure caught → Wait → return
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [callbackPromise] = await context.createCallback<string>(event);

    let outcome: string;
    try {
      outcome = await callbackPromise;
    } catch (e) {
      outcome = `caught_failure:${(e as Error).message}`;
    }

    await context.wait("after-cb", { seconds: 2 });

    return outcome;
  },
);
