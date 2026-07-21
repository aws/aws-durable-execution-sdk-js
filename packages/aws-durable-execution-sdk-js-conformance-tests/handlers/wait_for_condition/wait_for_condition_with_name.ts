// 6-3: Wait-for-condition with explicit name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const threshold = typeof event === "number" ? event : Number(event);
    const result = await context.waitForCondition(
      "poll-status",
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
