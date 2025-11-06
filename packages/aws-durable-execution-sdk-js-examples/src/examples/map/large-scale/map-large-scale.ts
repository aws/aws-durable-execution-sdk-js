import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Large Scale Map",
  description: "Test map with 50 iterations, each returning 100KB data",
};

/**
 * Generate a string of approximately the specified size in KB
 */
function generateLargeString(sizeInKB: number): string {
  const targetSize = sizeInKB * 1024; // Convert KB to bytes
  const baseString = "B".repeat(1000); // 1KB string
  const repetitions = Math.floor(targetSize / 1000);
  const remainder = targetSize % 1000;

  return baseString.repeat(repetitions) + "B".repeat(remainder);
}

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Create array of 50 items (more manageable for testing)
    const items = Array.from({ length: 50 }, (_, i) => i + 1);

    const results = await context.map(
      "large-scale-map",
      items,
      async (context: DurableContext, item: number, index: number) => {
        return await context.step(`process-item-${item}`, async () => {
          // Generate 100KB of data for each item
          const data = generateLargeString(100);
          return {
            itemId: item,
            index: index,
            dataSize: data.length,
            data: data,
            processed: true,
          };
        });
      },
      {
        maxConcurrency: 10, // Process 10 items concurrently
      },
    );

    await context.wait("wait1", { seconds: 1 });

    // Process results immediately after map operation
    // Note: After wait operations, the BatchResult may be summarized and lose getResults() method
    let finalResults: any[] = [];
    let totalDataSize = 0;
    let allItemsProcessed = false;

    // Full BatchResult available - extract data now
    finalResults = results.getResults();
    totalDataSize = finalResults.reduce(
      (sum, result) => sum + result.dataSize,
      0,
    );
    allItemsProcessed = finalResults.every((result) => result.processed);

    const totalSizeInMB = Math.round(totalDataSize / (1024 * 1024));

    const summary = {
      itemsProcessed: results.successCount,
      totalDataSizeMB: totalSizeInMB,
      totalDataSizeBytes: totalDataSize,
      maxConcurrency: 10,
      averageItemSize: Math.round(totalDataSize / results.successCount),
      allItemsProcessed: allItemsProcessed,
    };

    await context.wait("wait2", { seconds: 1 });

    return {
      success: true,
      message:
        "Successfully processed 50 items with substantial data using map",
      summary: summary,
    };
  },
);
