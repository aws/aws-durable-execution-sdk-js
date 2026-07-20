// 8-2: Parallel branches-only form (no operation name)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      [async () => "alpha", async () => "beta"],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
