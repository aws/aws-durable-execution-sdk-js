// 8-11: Parallel real concurrency (max-concurrency > 1) preserves index-ordered results
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "concurrent",
      [async () => "r0", async () => "r1", async () => "r2"],
      { maxConcurrency: 2 },
    );
    return results.getResults();
  },
);
