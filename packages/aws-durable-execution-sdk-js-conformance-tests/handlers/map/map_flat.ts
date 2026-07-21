// 9-12: Map with FLAT nesting (virtual iteration contexts)
import {
  DurableContext,
  NestingType,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "flat",
      ["fa", "fb"],
      async (ctx: DurableContext, item: string) => ctx.step(async () => item),
      { maxConcurrency: 1, nesting: NestingType.FLAT },
    );
    return results.getResults();
  },
);
