// 6-12: Wait-for-condition followed by a step (result passed onward)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const threshold = typeof event === "number" ? event : Number(event);
    const pollResult = await context.waitForCondition(
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
    const stepResult = await context.step(async () => {
      return pollResult * 10;
    });
    return stepResult;
  },
);
