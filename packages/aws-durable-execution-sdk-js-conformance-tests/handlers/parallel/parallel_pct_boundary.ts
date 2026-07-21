// 8-22: Parallel tolerated-failure-percentage at the boundary (not exceeded, ALL_COMPLETED)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "pct-boundary",
      [
        async () => {
          throw new Error("f0");
        },
        async () => "ok1",
        async () => "ok2",
        async () => "ok3",
      ],
      {
        maxConcurrency: 1,
        completionConfig: { toleratedFailurePercentage: 25 },
      },
    );
    // totalCount = started branches (succeeded + failed).
    return {
      completionReason: results.completionReason,
      status: results.status,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
