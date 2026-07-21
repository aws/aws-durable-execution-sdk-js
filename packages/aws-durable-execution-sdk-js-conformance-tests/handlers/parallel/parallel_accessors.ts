// 8-20: Parallel BatchResult accessors (succeeded/failed/getErrors/hasFailure)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "accessors",
      [
        async () => "ok0",
        async () => {
          throw new Error("f1");
        },
        async () => "ok2",
      ],
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 1 } },
    );
    // Exercise the accessor methods rather than the count properties.
    return {
      hasFailure: results.hasFailure,
      successCount: results.succeeded().length,
      failureCount: results.failed().length,
      errorCount: results.getErrors().length,
    };
  },
);
