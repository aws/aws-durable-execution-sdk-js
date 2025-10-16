import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: (state: number, attempt: number) => {
          if (state >= 3) {
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delaySeconds: 1 };
        },
        initialState: 0,
      },
    );
    return result;
  },
);
