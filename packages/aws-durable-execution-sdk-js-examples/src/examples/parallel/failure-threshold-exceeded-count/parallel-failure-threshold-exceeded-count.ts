import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Parallel failure threshold exceeded count",
  description:
    "Parallel operation where failure count exceeds tolerance threshold",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.parallel(
      "failure-threshold-tasks",
      [
        async (ctx: DurableContext) => {
          return await ctx.step("task-1", async () => {
            throw new Error("Task 1 failed");
          });
        },
        async (ctx: DurableContext) => {
          return await ctx.step("task-2", async () => {
            throw new Error("Task 2 failed");
          });
        },
        async (ctx: DurableContext) => {
          return await ctx.step("task-3", async () => {
            throw new Error("Task 3 failed");
          });
        },
        async (ctx: DurableContext) => {
          return await ctx.step("task-4", async () => "Task 4 success");
        },
        async (ctx: DurableContext) => {
          return await ctx.step("task-5", async () => "Task 5 success");
        },
      ],
      {
        completionConfig: {
          toleratedFailureCount: 2, // Allow only 2 failures, but we'll have 3
        },
      },
    );

    await context.wait({ seconds: 1 });

    return {
      completionReason: result.completionReason,
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalCount: result.totalCount,
    };
  },
);
