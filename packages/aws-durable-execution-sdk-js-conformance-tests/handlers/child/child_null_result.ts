// 3-16: Child context returning null
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "null-child",
      async (childContext: DurableContext) => {
        return null;
      },
    );
    return result;
  },
);
