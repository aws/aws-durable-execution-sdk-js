// 8-5: Parallel with an empty branches list
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>("empty", []);
    return results.getResults();
  },
);
