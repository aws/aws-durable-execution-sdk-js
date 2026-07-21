// 5-7: Invoke timeout (target takes too long)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(targetFunctionName, event, {
      timeout: 5,
    });
    return result;
  },
);
