// 2-5: Wait with long duration (1 hour)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ hours: 1 });
    return "Wait with hours completed";
  },
);
