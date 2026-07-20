// 5-3: Invoke returning complex object (nested JSON)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(targetFunctionName, event);
    return result;
  },
);
