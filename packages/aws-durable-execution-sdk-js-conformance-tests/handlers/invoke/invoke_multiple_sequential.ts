// 5-14: Multiple sequential invokes
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunction1 = process.env.TARGET_FUNCTION_NAME_1!;
    const targetFunction2 = process.env.TARGET_FUNCTION_NAME_2!;
    const result1 = await context.invoke(targetFunction1, event);
    const result2 = await context.invoke(targetFunction2, result1);
    return result2;
  },
);
