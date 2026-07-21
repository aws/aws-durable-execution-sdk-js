// 6-6: Wait-for-condition max attempts exceeded (failure)
import {
  DurableContext,
  withDurableExecution,
  createWaitStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.waitForCondition(
      async (state: number) => {
        return state + 1;
      },
      {
        waitStrategy: createWaitStrategy<number>({
          maxAttempts: 3,
          shouldContinuePolling: () => true,
          initialDelay: { seconds: 1 },
          backoffRate: 1,
          jitter: JitterStrategy.NONE,
        }),
        initialState: 0,
      },
    );
    return result;
  },
);
