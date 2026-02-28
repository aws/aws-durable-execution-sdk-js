import {
  withDurableExecution,
  NestingType,
} from "@aws/durable-execution-sdk-js";

export const config = {
  name: "Parallel Virtual Context",
  description:
    "Demonstrates parallel execution with flat nesting for cost optimization",
};

export const handler = withDurableExecution(async (event, context) => {
  // Parallel execution with flat nesting (cost optimized)
  const result = await context.parallel(
    "parallel-tasks-virtual",
    [
      {
        name: "fetch-data",
        func: async (ctx) => {
          return await ctx.step("fetch", async () => {
            return { data: "fetched" };
          });
        },
      },
      {
        name: "process-data",
        func: async (ctx) => {
          return await ctx.step("process", async () => {
            return { processed: true };
          });
        },
      },
      {
        name: "validate-data",
        func: async (ctx) => {
          return await ctx.step("validate", async () => {
            return { valid: true };
          });
        },
      },
    ],
    { nesting: NestingType.FLAT }, // Use flat nesting to skip checkpointing
  );

  return {
    results: result.getResults(),
    totalCount: result.totalCount,
    successCount: result.successCount,
  };
});
