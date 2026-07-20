// 3-1: Child context basic (single step inside)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          return event as string;
        });
        return stepResult;
      },
    );
    return result;
  },
);
