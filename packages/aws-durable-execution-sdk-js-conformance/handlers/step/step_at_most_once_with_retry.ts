// 1-18: AtMostOnce interrupted (with retry, succeeds on second attempt)
import {
  DurableContext,
  withDurableExecution,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const result = await context.step(
      async (stepContext) => {
        // Print input to stdout each time the step body executes.
        console.log(event);

        // Native per-step attempt counter (1-based, increments on each retry).
        if (stepContext.attempt < 2) {
          // Allow time for logs to flush to CloudWatch before crashing.
          await new Promise((resolve) => setTimeout(resolve, 1000));
          // First attempt: simulate a Lambda sandbox crash.
          process.exit(1);
        }
        // Second attempt (retry): succeed.
        return "succeeded on second attempt";
      },
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: (error: Error, attempts: number) => {
          if (attempts >= 3) {
            return { shouldRetry: false };
          }
          return { shouldRetry: true, delay: { seconds: 1 } };
        },
      },
    );
    return result;
  },
);
