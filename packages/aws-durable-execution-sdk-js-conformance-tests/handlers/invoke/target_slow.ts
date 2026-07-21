// Target function that takes longer than timeout (uses wait with long duration)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 600 });
    return "should_not_reach";
  },
);
