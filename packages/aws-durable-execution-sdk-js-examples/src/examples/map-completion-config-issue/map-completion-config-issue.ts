import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../types";

export const config: ExampleConfig = {
  name: "Map Completion Config Issue",
  description:
    "Reproduces issue where map with minSuccessful loses failure count",
};

export const handler = withDurableExecution(
  async (event: unknown, context: DurableContext) => {
    // Test data: Items 2 and 4 will fail (40% failure rate)
    const items = [
      { id: 1, shouldFail: false },
      { id: 2, shouldFail: true }, // Will fail
      { id: 3, shouldFail: false },
      { id: 4, shouldFail: true }, // Will fail
      { id: 5, shouldFail: false },
    ];

    // Fixed completion config that causes the issue
    const completionConfig = {
      minSuccessful: 2,
      toleratedFailurePercentage: 50,
    };

    console.log("Starting map with config:", JSON.stringify(completionConfig));
    console.log(
      "Items pattern:",
      items.map((i) => (i.shouldFail ? "FAIL" : "SUCCESS")).join(", "),
    );

    const results = await context.map(
      "completion-config-items",
      items,
      async (ctx: DurableContext, item: (typeof items)[0], index: number) => {
        console.log(
          `Processing item ${item.id} (index ${index}), shouldFail: ${item.shouldFail}`,
        );

        return await ctx.step(
          `process-item-${index}`,
          async () => {
            if (item.shouldFail) {
              throw new Error(`Processing failed for item ${item.id}`);
            }
            return {
              itemId: item.id,
              processed: true,
              result: `Item ${item.id} processed successfully`,
            };
          },
          {
            retryStrategy: (error, attemptCount) => {
              if (attemptCount < 2) {
                return {
                  shouldRetry: true,
                  delaySeconds: 1,
                };
              }
              return {
                shouldRetry: false,
              };
            },
          },
        );
      },
      {
        maxConcurrency: 3,
        completionConfig,
      },
    );

    console.log("Map completed with results:");
    console.log(`Total items processed: ${results.totalCount}`);
    console.log(`Successful items: ${results.successCount}`);
    console.log(`Failed items: ${results.failureCount}`);
    console.log(`Has failures: ${results.hasFailure}`);
    console.log(`Batch status: ${results.status}`);
    console.log(`Completion reason: ${results.completionReason}`);

    return {
      totalItems: results.totalCount,
      successfulCount: results.successCount,
      failedCount: results.failureCount,
      hasFailures: results.hasFailure,
      batchStatus: results.status,
      completionReason: results.completionReason,
      successfulItems: results.succeeded().map((item) => ({
        index: item.index,
        itemId: items[item.index].id,
      })),
      failedItems: results.failed().map((item) => ({
        index: item.index,
        itemId: items[item.index].id,
        error: item.error.message,
      })),
    };
  },
);
