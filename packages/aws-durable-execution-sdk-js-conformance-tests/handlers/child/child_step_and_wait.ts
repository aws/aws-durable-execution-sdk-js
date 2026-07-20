// 3-10: Child context with step and wait inside
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "mixed-ops",
      async (childContext: DurableContext) => {
        await childContext.step(async () => {
          return event as string;
        });

        await childContext.wait({ seconds: 1 });

        return event as string;
      },
    );
    return result;
  },
);
