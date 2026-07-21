// 9-4: Map with an empty items list
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items: number[] = Array.isArray(event) ? event : [];
    const results = await context.map(
      "empty",
      items,
      async (_ctx: DurableContext, item: number) => item,
    );
    return results.getResults();
  },
);
