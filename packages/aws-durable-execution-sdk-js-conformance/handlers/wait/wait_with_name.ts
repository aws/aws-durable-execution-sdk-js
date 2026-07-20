// 2-2: Wait with name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait("custom_wait_name", { seconds: 2 });
    return "Wait with name completed";
  },
);
