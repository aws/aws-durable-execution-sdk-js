// 3-13: Child context with wait inside - verify replay
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.runInChildContext(
      "wait-child",
      async (childContext: DurableContext) => {
        await childContext.wait({ seconds: 1 });
        return event as string;
      },
    );

    const result = await context.step(async () => {
      return event as string;
    });

    return result;
  },
);
