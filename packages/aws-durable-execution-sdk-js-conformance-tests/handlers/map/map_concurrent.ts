// 9-11: Map real concurrency (max-concurrency > 1) preserves index-ordered results
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "concurrent",
      ["r0", "r1", "r2"],
      async (_ctx: DurableContext, item: string) => item,
      { maxConcurrency: 2 },
    );
    return results.getResults();
  },
);
