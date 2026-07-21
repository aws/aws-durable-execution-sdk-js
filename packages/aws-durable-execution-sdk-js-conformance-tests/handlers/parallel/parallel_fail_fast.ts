// 8-6: Parallel fail-fast (tolerated-failure-count=0) stops after first failure
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "failfast",
      [
        async () => "ok",
        async () => {
          throw new Error("branch failed");
        },
        async () => "never",
      ],
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 0 } },
    );
    // totalCount = started branches (succeeded + failed); early-stopped
    // branches are not counted, matching Java's succeeded()+failed().
    return {
      completionReason: results.completionReason,
      status: results.status,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
