// 5-2: Invoke with name (explicit name parameter from input)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName = process.env.TARGET_FUNCTION_NAME!;
    const result = await context.invoke(
      event.name,
      targetFunctionName,
      event.payload,
    );
    return result;
  },
);
