// 9-3: Map function receives item and index
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items: number[] = Array.isArray(event) ? event : [10, 20, 30];
    const results = await context.map(
      "indexed",
      items,
      async (_ctx: DurableContext, item: number, index: number) => item + index,
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
