// 8-10: Parallel tolerated-failure-count exceeded (stops early)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "tolerated-exceeded",
      [
        async () => {
          throw new Error("branch failed");
        },
        async () => {
          throw new Error("branch failed");
        },
        async () => "never",
      ],
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 1 } },
    );
    // totalCount = started branches (succeeded + failed); early-stopped
    // branches are not counted, matching Java's succeeded()+failed().
    return {
      completionReason: results.completionReason,
      successCount: results.successCount,
      failureCount: results.failureCount,
      totalCount: results.totalCount,
    };
  },
);
