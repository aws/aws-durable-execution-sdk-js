// 1-20: Error caught and handled (try/catch)
import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    try {
      await context.step(
        async () => {
          throw new Error("Something went wrong");
        },
        { retryStrategy: retryPresets.noRetry },
      );
    } catch (error) {
      // Error caught, continue with fallback
    }

    const result = await context.step(async () => {
      return "fallback_result";
    });

    return result;
  },
);
