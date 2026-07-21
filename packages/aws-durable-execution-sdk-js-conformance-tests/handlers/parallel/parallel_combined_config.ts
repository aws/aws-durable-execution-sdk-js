// 8-18: Parallel with combined completion config (min-successful + tolerated-failure-count)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "combined",
      [
        async () => {
          throw new Error("f0");
        },
        async () => {
          throw new Error("f1");
        },
        async () => "ok2",
        async () => "ok3",
      ],
      {
        maxConcurrency: 1,
        completionConfig: { minSuccessful: 3, toleratedFailureCount: 1 },
      },
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
