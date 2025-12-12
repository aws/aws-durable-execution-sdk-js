import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";
import { log } from "../../../utils/logger";

export const config: ExampleConfig = {
  name: "Map minSuccessful",
  description: "Map operation with minSuccessful completion config",
};

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const items = [1, 2, 3, 4, 5];

    log(`Processing ${items.length} items with minSuccessful: 2`);

    const results = await context.map(
      "min-successful-items",
      items,
      async (ctx, item, index) => {
        // Using ctx.step here will prevent us to check minSuccessful if we are trying
        // to use timeout that is close to checkpopint call latency
        // The reason is ctx.step is doing checkpoint synchronously and multiple
        // steps in multiple iterations/branches could finish before map/parallel completion is met

        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, 100 * item));
        return `Item ${item} processed`;
      },
      {
        completionConfig: {
          minSuccessful: 2,
        },
        itemNamer: (item: number, index: number) => `process-${index}`,
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
