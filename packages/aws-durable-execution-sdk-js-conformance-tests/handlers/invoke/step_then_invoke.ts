// 5-11: Step then invoke (sequential operations)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const stepResult = await context.step(async () => {
      return { value: "step_data" };
    });
    const result = await context.invoke(targetFunctionName, stepResult);
    return result;
  },
);
