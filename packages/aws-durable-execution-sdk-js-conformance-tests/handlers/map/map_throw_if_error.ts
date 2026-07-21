// 9-6: Map throw-if-error propagates an item failure to the execution
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.map(
      "throwing",
      ["fail", "never"],
      async (_ctx: DurableContext, item: string) => {
        if (item === "fail") {
          throw new Error("item failed");
        }
        return item;
      },
      { maxConcurrency: 1, completionConfig: { toleratedFailureCount: 0 } },
    );
    results.throwIfError();
    return results.getResults();
  },
);
