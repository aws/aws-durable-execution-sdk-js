// 6-2: Wait-for-condition immediate stop (condition already met on first check)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const initialValue = typeof event === "number" ? event : Number(event);
    const result = await context.waitForCondition(
      async (state: number) => {
        return state;
      },
      {
        waitStrategy: (state: number, _attempt: number) => {
          if (state >= 5) {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: initialValue,
      },
    );
    return result;
  },
);
