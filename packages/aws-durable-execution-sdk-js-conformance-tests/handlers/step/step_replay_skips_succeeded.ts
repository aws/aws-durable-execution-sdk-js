// 1-9: Replay skips succeeded step
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(async (stepContext) => {
      stepContext.logger.info("step executed");
      return "cached_value";
    });
    await context.wait({ seconds: 1 });
    return result;
  },
);
