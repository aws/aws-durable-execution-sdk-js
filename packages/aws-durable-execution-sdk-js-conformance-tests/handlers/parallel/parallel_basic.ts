// 8-1: Parallel basic (two branches, each a single step, all succeed)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "parallel",
      [
        async (ctx: DurableContext) => ctx.step(async () => "task-1"),
        async (ctx: DurableContext) => ctx.step(async () => "task-2"),
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
);
