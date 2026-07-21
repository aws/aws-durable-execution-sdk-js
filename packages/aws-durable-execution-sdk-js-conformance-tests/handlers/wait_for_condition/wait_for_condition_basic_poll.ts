// 6-1: Wait-for-condition basic (polls until threshold met)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const threshold = typeof event === "number" ? event : Number(event);
    const result = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: (state: number, _attempt: number) => {
          if (state >= threshold) {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: 0,
      },
    );
    return result;
  },
);
