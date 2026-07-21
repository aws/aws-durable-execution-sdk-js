// 5-10: Invoke replay re-throws (failed invoke error re-thrown from cache)
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
      // Error caught, continue
    }
    await context.wait({ seconds: 1 });
    return "completed";
  },
);
