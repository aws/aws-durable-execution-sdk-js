import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Parallel toleratedFailureCount",
  description:
    "Parallel execution with toleratedFailureCount completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    log("Starting parallel execution with toleratedFailureCount: 2");

    const results = await context.parallel(
      "failure-count-branches",
      [
        async (ctx) => {
          return await ctx.step("branch-1", async () => {
            return "Branch 1 success";
          });
        },
        async (ctx) => {
          return await ctx.step(
            "branch-2",
            async () => {
              throw new Error("Branch 2 failed");
            },
            { retryStrategy: retryPresets.noRetry },
          );
        },
        async (ctx) => {
          return await ctx.step("branch-3", async () => {
            return "Branch 3 success";
          });
        },
        async (ctx) => {
          return await ctx.step(
            "branch-4",
            async () => {
              throw new Error("Branch 4 failed");
            },
            { retryStrategy: retryPresets.noRetry },
          );
        },
        async (ctx) => {
          return await ctx.step("branch-5", async () => {
            return "Branch 5 success";
          });
        },
      ],
      {
        completionConfig: {
          toleratedFailureCount: 2,
        },
      },
    );

    await context.wait({ seconds: 1 });

    log(`Completed with ${results.failureCount} failures`);
    log(`Completion reason: ${results.completionReason}`);

    return {
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
      completionReason: results.completionReason,
      hasFailure: results.hasFailure,
    };
  },
);
