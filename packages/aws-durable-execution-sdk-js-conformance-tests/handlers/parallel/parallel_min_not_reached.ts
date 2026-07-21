// 8-17: Parallel min-successful not reached (all branches run)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "min-not-reached",
      [
        async () => "ok0",
        async () => {
          throw new Error("f1");
        },
        async () => "ok2",
      ],
      { maxConcurrency: 1, completionConfig: { minSuccessful: 3 } },
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
