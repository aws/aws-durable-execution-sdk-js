// 6-8: Wait-for-condition check throws, caught by handler (recovers)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    try {
      await context.waitForCondition(
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
    } catch (e) {
      return "recovered";
    }
  },
);
