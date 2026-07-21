// 3-15: Child context error without step (error thrown directly in child body)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "direct-error",
      async (childContext: DurableContext) => {
        throw new Error("direct error");
      },
    );
    return result;
  },
);
