// 9-13: Map with a custom item namer
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items: number[] = Array.isArray(event) ? event : [1, 2];
    const results = await context.map(
      "named-items",
      items,
      async (_ctx: DurableContext, item: number) => item * 10,
      {
        maxConcurrency: 1,
        itemNamer: (item: number, index: number) => `item-${item}`,
      },
    );
    return results.getResults();
  },
);
