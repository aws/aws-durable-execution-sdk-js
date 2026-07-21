// 5-1: Invoke basic (target function succeeds)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName: string = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(undefined, targetFunctionName, event);
    return result;
  },
);
