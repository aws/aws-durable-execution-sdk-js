// 8-14: Parallel replay skips succeeded branches across a wait suspension
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "replay",
      [
        async (ctx: DurableContext) => ctx.step(async () => "b0"),
        async (ctx: DurableContext) => {
          await ctx.wait({ seconds: 2 });
          return "b1";
        },
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
