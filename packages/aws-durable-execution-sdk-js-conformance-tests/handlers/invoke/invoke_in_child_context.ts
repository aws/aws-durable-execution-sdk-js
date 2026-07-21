// 5-13: Invoke inside child context
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.runInChildContext(async (childCtx) => {
      return await childCtx.invoke(targetFunctionName, event);
    });
    return result;
  },
);
