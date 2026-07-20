// 5-8: Invoke timeout, caught (timeout caught, execution continues)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    try {
      await context.invoke(targetFunctionName, event, { timeout: 5 });
    } catch (error) {
      // Timeout caught, continue with fallback
    }
    return "fallback_result";
  },
);
