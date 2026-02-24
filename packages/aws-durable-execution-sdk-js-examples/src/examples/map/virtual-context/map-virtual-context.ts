import {
  withDurableExecution,
  NestingType,
} from "@aws/durable-execution-sdk-js";

export const config = {
  name: "Map Virtual Context",
  description:
    "Demonstrates map operation with flat nesting for cost optimization",
};

export const handler = withDurableExecution(async (event, context) => {
  const items = [1, 2, 3, 4, 5];

  // Map with flat nesting (cost optimized)
  const result = await context.map(
    "process-items-virtual",
    items,
    async (ctx, item) => {
      return await ctx.step(`process-${item}`, async () => {
        return item * 2;
      });
    },
    { nesting: NestingType.FLAT }, // Use flat nesting to skip checkpointing
  );

  return {
    processedItems: result.getResults(),
    totalCount: result.totalCount,
    successCount: result.successCount,
  };
});
