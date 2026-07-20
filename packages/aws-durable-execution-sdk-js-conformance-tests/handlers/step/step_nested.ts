// 1-3: Sequential steps where second depends on first
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result1 = await context.step(async () => {
      return "first";
    });

    const result2 = await context.step(async () => {
      return `${result1}_second`;
    });

    return result2;
  },
);
