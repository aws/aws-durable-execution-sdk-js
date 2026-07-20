// 1-19: Step with error (fails permanently)
import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async () => {
        throw new Error("Something went wrong");
      },
      { retryStrategy: retryPresets.noRetry },
    );
    return result;
  },
);
