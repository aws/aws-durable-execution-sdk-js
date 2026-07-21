// 9-18: Suspension after a map that completed with a failure (replay skips the completed map)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "fail-then-wait",
      ["ok", "fail"],
      async (_ctx: DurableContext, item: string) => {
        if (item === "fail") {
          throw new Error("item failed");
        }
        return item;
      },
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 1 } },
    );
    // Suspend after the map (which recorded a failure); on replay the completed map is skipped.
    await context.wait({ seconds: 1 });
    return {
      completionReason: results.completionReason,
      status: results.status,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
