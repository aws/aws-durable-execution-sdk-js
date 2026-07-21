// 6-4: Wait-for-condition with custom initial state (state threaded across polls)
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
        initialState: 5,
      },
    );
    return result;
  },
);
