// 6-7: Wait-for-condition check function throws (uncaught failure)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: number) => {
        throw new Error("check function error");
      },
      {
        waitStrategy: (_state: number, _attempt: number) => {
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
        initialState: 0,
      },
    );
    return result;
  },
);
