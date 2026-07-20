// 3-3: Child context with multiple sequential steps
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "multi-step",
      async (childContext: DurableContext) => {
        const first = await childContext.step(async () => {
          return event as string;
        });

        const second = await childContext.step(async () => {
          return first;
        });

        return second;
      },
    );
    return result;
  },
);
