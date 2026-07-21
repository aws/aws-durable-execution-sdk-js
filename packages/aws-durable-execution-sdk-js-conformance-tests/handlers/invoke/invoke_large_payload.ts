// 5-7: Invoke large payload (payload near size limit)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const largePayload = { data: "x".repeat(200000) };
    const result = await context.invoke(targetFunctionName, largePayload);
    return result;
  },
);
