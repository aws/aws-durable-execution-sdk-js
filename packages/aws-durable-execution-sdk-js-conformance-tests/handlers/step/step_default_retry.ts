// 1-13: Default retry strategy (fails twice, succeeds on third attempt)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Step with no explicit retry config — uses the SDK default retry strategy.
    const result = await context.step(async (stepContext) => {
      // Native per-step attempt counter (1-based, increments on each retry).
      if (stepContext.attempt < 3) {
        throw new Error(`Attempt ${stepContext.attempt} failed`);
      }
      return "recovered";
    });

    return result;
  },
);
