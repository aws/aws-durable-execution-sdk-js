// 1-17: Step with AtMostOncePerRetry semantics (interrupted, no retry)
import {
  DurableContext,
  withDurableExecution,
  StepSemantics,
  retryPresets,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      "at_most_once_flaky_step",
      async (stepContext) => {
        // Log input through the step context logger before crashing so the
        // record carries the execution ARN and is correlated to this execution.
        stepContext.logger.info(event);
        // Allow time for logs to flush to CloudWatch before crashing
        await new Promise((resolve) => setTimeout(resolve, 1000));
        process.exit(1);
        return "unreachable";
      },
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: retryPresets.noRetry,
      },
    );
    return result;
  },
);
