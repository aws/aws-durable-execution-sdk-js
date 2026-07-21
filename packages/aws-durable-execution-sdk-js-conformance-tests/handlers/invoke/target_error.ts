// Target function that waits briefly then throws an error (ensures caller suspends first)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 1 });
    throw new Error("Target function failed");
  },
);
