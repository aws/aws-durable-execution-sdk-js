// 9-17: Suspension after a successful map (replay skips the completed map)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "then-wait",
      ["a", "b"],
      async (_ctx: DurableContext, item: string) => item.toUpperCase(),
      { maxConcurrency: 1 },
    );
    // Suspend after the map; on replay the completed map is skipped.
    await context.wait({ seconds: 1 });
    return results.getResults();
  },
);
