// 5-12: Invoke then step (invoke result used by subsequent step)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const invokeResult = await context.invoke(targetFunctionName, event);
    const result = await context.step(async () => {
      return `processed: ${invokeResult}`;
    });
    return result;
  },
);
