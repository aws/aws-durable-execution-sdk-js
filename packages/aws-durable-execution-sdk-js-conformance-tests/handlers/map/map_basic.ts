// 9-1: Map basic (one step per item, all succeed)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items: string[] = Array.isArray(event) ? event : ["World", "Kiro"];
    const results = await context.map(
      "map",
      items,
      async (ctx: DurableContext, item: string) =>
        ctx.step(async () => `Hello, ${item}!`),
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
