// 3-6: Nested child contexts
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.runInChildContext(
      "outer",
      async (outerContext: DurableContext) => {
        await outerContext.step(async () => {
          return event as string;
        });

        const innerResult = await outerContext.runInChildContext(
          "inner",
          async (innerContext: DurableContext) => {
            const innerStep = await innerContext.step(async () => {
              return event as string;
            });
            return innerStep;
          },
        );

        return innerResult;
      },
    );
    return result;
  },
);
