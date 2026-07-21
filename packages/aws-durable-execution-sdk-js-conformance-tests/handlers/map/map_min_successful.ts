// 9-7: Map min-successful early completion
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "min-successful",
      ["s0", "s1", "s2", "s3"],
      async (_ctx: DurableContext, item: string) => item,
      { maxConcurrency: 1, completionConfig: { minSuccessful: 2 } },
    );
    return {
      completionReason: results.completionReason,
      successCount: results.successCount,
      totalCount: results.totalCount,
    };
  },
);
