// 9-2: Map items-only form (no operation name), each item returns directly
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items: number[] = Array.isArray(event) ? event : [1, 2];
    const results = await context.map(
      items,
      async (_ctx: DurableContext, item: number) => item * 2,
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
