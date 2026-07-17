// 1-2: Step with name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step("custom_step_name", async () => {
      return `Hello, ${event}!`;
    });
    return result;
  },
);
