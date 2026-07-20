// 8-12: Parallel with FLAT nesting (virtual branch contexts)
import {
  DurableContext,
  NestingType,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "flat",
      [
        async (ctx: DurableContext) => ctx.step(async () => "fa"),
        async (ctx: DurableContext) => ctx.step(async () => "fb"),
      ],
      { maxConcurrency: 1, nesting: NestingType.FLAT },
    );
    return results.getResults();
  },
);
