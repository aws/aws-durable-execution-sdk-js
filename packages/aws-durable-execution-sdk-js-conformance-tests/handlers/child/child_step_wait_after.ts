// 3-18: Child context with step and wait inside, step and wait after
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    await context.runInChildContext(
      "step-wait-child",
      async (childContext: DurableContext) => {
        await childContext.step(async () => {
          return event as string;
        });

        await childContext.wait({ seconds: 2 });

        return event as string;
      },
    );

    const result = await context.step(async () => {
      return event as string;
    });

    await context.wait({ seconds: 2 });

    return result;
  },
);
