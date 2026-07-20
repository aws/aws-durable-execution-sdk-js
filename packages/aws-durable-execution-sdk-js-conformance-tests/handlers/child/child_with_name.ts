// 3-2: Child context with name
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const name = event.name as string;
    const value = event.value as string;
    const result = await context.runInChildContext(
      name,
      async (childContext: DurableContext) => {
        const stepResult = await childContext.step(async () => {
          return value;
        });
        return stepResult;
      },
    );
    return result;
  },
);
