// Target function that echoes back whatever it receives (with a short wait to ensure caller suspends)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.wait({ seconds: 1 });
    return event;
  },
);
