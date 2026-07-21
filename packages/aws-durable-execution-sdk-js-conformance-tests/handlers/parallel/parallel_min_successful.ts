// 8-8: Parallel min-successful early completion
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "min-successful",
      [async () => "s0", async () => "s1", async () => "s2", async () => "s3"],
      { maxConcurrency: 1, completionConfig: { minSuccessful: 2 } },
    );
    // totalCount = started branches (succeeded + failed); early-stopped
    // branches are not counted, matching Java's succeeded()+failed().
    return {
      completionReason: results.completionReason,
      successCount: results.successCount,
      totalCount: results.totalCount,
    };
  },
);
