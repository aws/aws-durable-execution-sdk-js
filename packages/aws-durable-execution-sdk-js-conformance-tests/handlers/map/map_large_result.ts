// 9-16: Map with a large aggregate result (exceeds the checkpoint size threshold)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Each iteration returns ~70KB; 4 items -> ~280KB aggregate, exceeding the 256KB threshold.
    const big = "x".repeat(70000);
    const results = await context.map(
      "large",
      [0, 1, 2, 3],
      async (_ctx: DurableContext, _item: number) => big,
      { maxConcurrency: 1 },
    );
    return {
      successCount: results.successCount,
      totalCount: results.totalCount,
    };
  },
);
