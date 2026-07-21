// 9-5: Map fail-fast via tolerated-failure-count=0 stops after first failure
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "failfast",
      ["ok", "fail", "never"],
      async (_ctx: DurableContext, item: string) => {
        if (item === "fail") {
          throw new Error("item failed");
        }
        return item;
      },
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 0 } },
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
