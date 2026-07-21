// 5-8: Invoke with tenantId (tenant-isolated invocation)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const targetFunctionName: string = process.env.TARGET_FUNCTION_NAME!;
    const { tenantId, payload } = event;
    const result = await context.invoke(
      undefined,
      targetFunctionName,
      payload,
      {
        tenantId,
      },
    );
    return result;
  },
);
