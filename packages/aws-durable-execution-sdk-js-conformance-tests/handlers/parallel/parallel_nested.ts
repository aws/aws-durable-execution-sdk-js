// 8-21: Nested parallel (a parallel operation inside a parallel branch)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string[]>(
      "outer",
      [
        async (ctx: DurableContext) => {
          const inner = await ctx.parallel<string>(
            "inner",
            [
              async (c2: DurableContext) => c2.step(async () => "i1"),
              async (c2: DurableContext) => c2.step(async () => "i2"),
            ],
            { maxConcurrency: 1 },
          );
          return inner.getResults();
        },
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
