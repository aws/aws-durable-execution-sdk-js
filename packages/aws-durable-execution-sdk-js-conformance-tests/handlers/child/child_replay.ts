// 3-9: Child context replay (returns cached result)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const childResult = await context.runInChildContext(
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          return event as string;
        });
        return stepResult;
      },
    );

    // Wait after child context to force a second invocation
    await context.wait({ seconds: 1 });

    return childResult;
  },
);
