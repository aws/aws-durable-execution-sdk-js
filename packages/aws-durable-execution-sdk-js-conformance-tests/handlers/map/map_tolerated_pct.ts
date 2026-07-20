// 9-10: Map tolerated-failure-percentage exceeded (stops early)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "tolerated-pct",
      ["f0", "f1", "never", "never"],
      async (_ctx: DurableContext, item: string) => {
        if (item !== "never") {
          throw new Error("item failed");
        }
        return item;
      },
      {
        maxConcurrency: 1,
        completionConfig: { toleratedFailurePercentage: 25 },
      },
    );
    return {
      completionReason: results.completionReason,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
