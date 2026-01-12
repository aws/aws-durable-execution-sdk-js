import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel minSuccessful with Passing Threshold",
  description:
    "Parallel execution with minSuccessful completion config and passing threshold",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parallel execution with minSuccessful: 2");

    // First brach finishes first
    // Branch 2 to 4 finish in the same time
    // Branc 5 will finish later
    const results = await context.parallel(
      "min-successful-branches",
      [
        {
          name: "branch-1",
          func: async (ctx) => {
            return await ctx.step("branch-1", async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return "Branch 1 result";
            });
          },
        },
        {
          name: "branch-2",
          func: async (ctx) => {
            return await ctx.step("branch-2", async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return "Branch 2 result";
            });
          },
        },
        {
          name: "branch-3",
          func: async (ctx) => {
            return await ctx.step("branch-3", async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return "Branch 3 result";
            });
          },
        },
        {
          name: "branch-4",
          func: async (ctx) => {
            return await ctx.step("branch-4", async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return "Branch 4 result";
            });
          },
        },
        {
          name: "branch-5",
          func: async (ctx) => {
            return await ctx.step("branch-4", async () => {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              return "Branch 4 result";
            });
          },
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
