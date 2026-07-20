// 1-10: Replay re-throws failed step
import {
  DurableContext,
  withDurableExecution,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    let errorMessage: string = "";

    try {
      await context.step(
        async (stepContext) => {
          stepContext.logger.info("step executed");
          throw new Error("Something went wrong");
        },
        { retryStrategy: retryPresets.noRetry },
      );
    } catch (error: any) {
      errorMessage = error.cause?.message ?? error.message;
    }

    await context.wait({ seconds: 1 });
    return `caught: ${errorMessage}`;
  },
);
