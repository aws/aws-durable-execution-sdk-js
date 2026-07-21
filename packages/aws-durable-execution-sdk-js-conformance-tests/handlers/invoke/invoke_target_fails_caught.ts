// 5-6: Invoke target fails, caught (try/catch, execution succeeds)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    try {
      await context.invoke(targetFunctionName, event);
    } catch (error) {
      // Error caught, continue with fallback
    }
    return "fallback_result";
  },
);
