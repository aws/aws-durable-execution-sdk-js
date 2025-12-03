import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Map toleratedFailureCount",
  description: "Map operation with toleratedFailureCount completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5];

    log(`Processing ${items.length} items with toleratedFailureCount: 2`);

    const results = await context.map(
      "failure-count-items",
      items,
      async (ctx, item, index) => {
        return await ctx.step(
          `process-${index}`,
          async () => {
            // Items 2 and 4 will fail
            if (item === 2 || item === 4) {
              throw new Error(`Processing failed for item ${item}`);
            }
            return `Item ${item} processed`;
          },
          { retryStrategy: retryPresets.noRetry },
        );
      },
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
