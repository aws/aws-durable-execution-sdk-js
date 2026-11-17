import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Pause Every",
  description:
    "A step with pauseEvery pauses the execution after every second failed attempt. " +
    "An operator resumes it with ResumeDurableExecution, and the next attempt runs.",
  // localOnly: the test resumes the execution with LocalDurableTestRunner.resumeExecution().
  // CloudDurableTestRunner does not implement it. The generated function role also has no
  // lambda:PauseDurableExecution permission.
  localOnly: true,
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    return await context.step(
      "call-payment-service",
      async ({ attempt }) => {
        // Stands in for a downstream service that recovers before the third attempt.
        if (attempt < 3) {
          throw new Error(`Payment service unavailable (attempt ${attempt})`);
        }
        return "payment accepted";
      },
      {
        // Pause after attempts 2, 4, 6 and so on, so an operator can check the
        // downstream service before the step retries again. The execution role needs
        // lambda:PauseDurableExecution on this function's durable executions.
        pauseEvery: 2,
        retryStrategy: (_error, attemptCount) => ({
          shouldRetry: attemptCount < 6,
          delay: { seconds: 1 },
        }),
      },
    );
  },
);
