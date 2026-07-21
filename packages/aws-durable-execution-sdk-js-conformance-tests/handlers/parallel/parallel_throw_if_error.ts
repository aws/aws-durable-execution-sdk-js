// 8-7: Parallel throw-if-error propagates a branch failure to the execution (fail-fast config)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "throwing",
      [
        async () => {
          throw new Error("branch failed");
        },
        async () => "never",
      ],
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 0 } },
    );
    results.throwIfError();
    return results.getResults();
  },
);
