// 3-17: Child context with print only (verify no re-execution on replay)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "print-child",
      async (childContext: DurableContext) => {
        console.log(event);
        return event as string;
      },
    );

    await context.wait({ seconds: 1 });

    return result;
  },
);
