import {
  DurableContext,
  StepError,
  StepSemantics,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step Interrupted No Retry",
  description:
    "Reproduces step interruption (Lambda timeout) with AT_MOST_ONCE_PER_RETRY semantics + shouldRetry: false. Cloud-only because real Lambda timeout is required to leave a step in STARTED state.",
  durableConfig: {
    ExecutionTimeout: 60,
    RetentionPeriodInDays: 7,
  },
  // Short per-invocation Lambda timeout so the long-running step is reliably
  // killed mid-execution. The overall durable ExecutionTimeout (60s) is still
  // long enough for the replay invocation to record the failure and return.
  lambdaTimeoutSeconds: 5,
};

/**
 * Handler that runs a step which sleeps longer than the Lambda function's `Timeout`
 * (configured to a small value in template.yml via EXAMPLE_CONFIGS). The first
 * invocation is killed mid-step, leaving the step in STARTED state. On the next
 * invocation the SDK detects this and (since shouldRetry is false) reports the
 * interruption to the handler as a StepError whose cause is StepInterruptedError.
 */
export const handler = withDurableExecution(
  async (event: { stepDurationMs?: number }, context: DurableContext) => {
    // Default to 30s — must exceed the per-function Lambda Timeout in template.yml.
    const stepDurationMs = event?.stepDurationMs ?? 30_000;

    try {
      const result = await context.step(
        "long-running-step",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, stepDurationMs));
          return "step-completed";
        },
        {
          semantics: StepSemantics.AtMostOncePerRetry,
          retryStrategy: () => ({ shouldRetry: false }),
        },
      );

      return { status: "succeeded", result };
    } catch (err) {
      const stepError = err as StepError;
      return {
        status: "failed",
        errorType: stepError?.errorType,
        errorName: stepError?.name,
        message: stepError?.message,
        causeName: stepError?.cause?.name,
      };
    }
  },
);
