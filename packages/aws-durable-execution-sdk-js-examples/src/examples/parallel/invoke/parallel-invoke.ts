import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel Invoke",
  description:
    "Demonstrates parallel branches that each invoke a child durable function " +
    "with staggered completion times, verifying correct suspension between " +
    "branch completions",
};

export const handler = withDurableExecution(
  async (event: { functionNames: string[] }, context: DurableContext) => {
    const results = await context.parallel(
      "parallel-invokes",
      event.functionNames.map((fnName, index) => ({
        name: `branch-${index}`,
        func: async (ctx: DurableContext) => {
          return await ctx.invoke(`invoke-${index}`, fnName, {
            data: `input-${index}`,
          });
        },
      })),
    );

    return {
      successCount: results.successCount,
    };
  },
);
