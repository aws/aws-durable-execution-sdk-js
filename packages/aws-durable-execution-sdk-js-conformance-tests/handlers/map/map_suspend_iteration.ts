// 9-15: Map suspends inside an iteration and replay skips the completed iteration
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "suspend",
      ["r0", "r1"],
      async (ctx: DurableContext, item: string, index: number) => {
        // Iteration 1 issues a durable wait before its step, suspending mid-map.
        if (index === 1) {
          await ctx.wait({ seconds: 1 });
        }
        return ctx.step(async () => item);
      },
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
