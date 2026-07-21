// 6-10: Wait-for-condition null result
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (_state: null) => {
        return null;
      },
      {
        waitStrategy: (_state: null, _attempt: number) => {
          return { shouldContinue: false };
        },
        initialState: null as any,
      },
    );
    return result;
  },
);
