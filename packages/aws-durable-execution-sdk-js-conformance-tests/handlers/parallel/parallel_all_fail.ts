// 8-16: Parallel where all branches fail (within tolerance, ALL_COMPLETED)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "all-fail",
      [
        async () => {
          throw new Error("f0");
        },
        async () => {
          throw new Error("f1");
        },
        async () => {
          throw new Error("f2");
        },
      ],
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 3 } },
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
