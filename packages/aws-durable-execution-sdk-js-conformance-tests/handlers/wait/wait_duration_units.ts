// 2-4: Wait with different duration units
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ minutes: 1 });
    return "Wait with minutes completed";
  },
);
