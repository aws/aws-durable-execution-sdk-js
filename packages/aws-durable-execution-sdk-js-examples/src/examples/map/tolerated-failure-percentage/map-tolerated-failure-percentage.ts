import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Map toleratedFailurePercentage",
  description:
    "Map operation with toleratedFailurePercentage completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    log(`Processing ${items.length} items with toleratedFailurePercentage: 30`);

    const results = await context.map(
      "failure-percentage-items",
      items,
      async (ctx, item, index) => {
        return await ctx.step(
          `process-${index}`,
          async () => {
            // Items 3, 6, 9 will fail (30% failure rate)
            if (item % 3 === 0) {
              throw new Error(`Processing failed for item ${item}`);
            }
            return `Item ${item} processed`;
          },
          { retryStrategy: retryPresets.noRetry },
        );
      },
      {
        completionConfig: {
          toleratedFailurePercentage: 30,
        },
      },
    );

    await context.wait({ seconds: 1 });

    log(
      `Completed with ${results.failureCount} failures (${((results.failureCount / results.totalCount) * 100).toFixed(1)}%)`,
    );
    log(`Completion reason: ${results.completionReason}`);

    return {
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
      failurePercentage: Math.round(
        (results.failureCount / results.totalCount) * 100,
      ),
      completionReason: results.completionReason,
    };
  },
);
