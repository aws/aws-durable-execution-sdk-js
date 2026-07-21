// 5-9: Invoke replay skips (invoke result cached on replay)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(targetFunctionName, event);
    await context.wait({ seconds: 1 });
    return result;
  },
);
