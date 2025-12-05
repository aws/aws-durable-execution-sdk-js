import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Map failure threshold exceeded percentage",
  description:
    "Map operation where failure percentage exceeds tolerance threshold",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5];

    const result = await context.map(
      "failure-threshold-items",
      items,
      async (ctx: DurableContext, item: number, index: number) => {
        return await ctx.step(
          `process-${index}`,
          async () => {
            if (item <= 3) {
              throw new Error(`Item ${item} failed`);
            }
            return item * 2;
          },
          { retryStrategy: createRetryStrategy({ maxAttempts: 2 }) },
        );
      },
      {
        completionConfig: {
          toleratedFailurePercentage: 50, // Allow 50% failures, but we'll have 60% (3/5)
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
