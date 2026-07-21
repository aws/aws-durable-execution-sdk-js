// 3-5: Child context error caught (try/catch, execution succeeds)
import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    try {
      await context.runInChildContext(async (childContext: DurableContext) => {
        await childContext.step(
          async () => {
            throw new Error("Child step failed");
          },
          { retryStrategy: retryPresets.noRetry },
        );
      });
    } catch (error) {
      // Error caught, continue with recovery
    }

    const result = await context.step(async () => {
      return event as string;
    });

    return result;
  },
);
