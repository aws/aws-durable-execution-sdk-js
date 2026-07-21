// 6-5: Wait-for-condition with fixed-delay wait strategy
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
          return { shouldContinue: true, delay: { seconds: 2 } };
        },
        initialState: 0,
      },
    );
    return result;
  },
);
