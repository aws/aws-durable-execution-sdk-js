import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel minSuccessful",
  description: "Parallel execution with minSuccessful completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parallel execution with minSuccessful: 2");

    const results = await context.parallel(
      "min-successful-branches",
      [
        async (ctx) => {
          return await ctx.step("branch-1", async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return "Branch 1 result";
          });
        },
        async (ctx) => {
          return await ctx.step("branch-2", async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return "Branch 2 result";
          });
        },
        async (ctx) => {
          return await ctx.step("branch-3", async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return "Branch 3 result";
          });
        },
        async (ctx) => {
          return await ctx.step("branch-4", async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            return "Branch 4 result";
          });
        },
      ],
      {
        completionConfig: {
          minSuccessful: 2,
        },
      },
    );

    await context.wait({ seconds: 1 });

    log(`Completed with ${results.successCount} successes`);
    log(`Completion reason: ${results.completionReason}`);

    return {
      successCount: results.successCount,
      totalCount: results.totalCount,
      completionReason: results.completionReason,
      results: results.getResults(),
    };
  },
);
