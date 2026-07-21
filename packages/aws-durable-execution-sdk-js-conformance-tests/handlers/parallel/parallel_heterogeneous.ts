// 8-4: Parallel with heterogeneous branch return types
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel(
      "hetero",
      [async () => "hello", async () => 42, async () => ({ k: "v" })],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
