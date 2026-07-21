// 9-8: Map tolerated-failure-count within tolerance (all items complete)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "tolerated",
      ["s0", "fail", "s2"],
      async (_ctx: DurableContext, item: string) => {
        if (item === "fail") {
          throw new Error("item failed");
        }
        return item;
      },
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 1 } },
    );
    return {
      completionReason: results.completionReason,
      status: results.status,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
