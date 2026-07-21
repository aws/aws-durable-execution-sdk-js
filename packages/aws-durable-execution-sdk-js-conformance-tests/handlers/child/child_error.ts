// 3-4: Child context error (step fails, execution fails)
import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "failing-child",
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(
          async () => {
            throw new Error("Child step failed");
          },
          { retryStrategy: retryPresets.noRetry },
        );
        return stepResult;
      },
    );
    return result;
  },
);
