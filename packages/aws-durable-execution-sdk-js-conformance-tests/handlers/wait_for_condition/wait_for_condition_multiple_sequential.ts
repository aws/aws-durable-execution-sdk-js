// 6-13: Multiple sequential wait_for_condition operations
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

function makeWaitStrategy(threshold: number) {
  return (state: number, _attempt: number) => {
    if (state >= threshold) {
      return { shouldContinue: false } as const;
    }
    return { shouldContinue: true, delay: { seconds: 1 } } as const;
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const firstResult = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: makeWaitStrategy(2),
        initialState: 0,
      },
    );
    const secondResult = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: makeWaitStrategy(4),
        initialState: firstResult,
      },
    );
    return secondResult;
  },
);
