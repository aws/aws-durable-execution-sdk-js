import {
  DurableContext,
  StepSemantics,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Step At Most Once Per Retry",
  description:
    "Companion to step/interrupted-no-retry: reproduces a step interrupted by " +
    "a Lambda timeout under AT_MOST_ONCE_PER_RETRY, but with a retryStrategy " +
    "that RETRIES the interruption (shouldRetry: true) instead of failing. On " +
    "resume the SDK reschedules the step and it succeeds on the next attempt. " +
    "Cloud-only because a real Lambda timeout is required to leave the step in " +
    "STARTED state.",
  durableConfig: {
    ExecutionTimeout: 60,
    RetentionPeriodInDays: 7,
  },
  // Short per-invocation Lambda timeout so the long first attempt is reliably
  // killed mid-step. The overall durable ExecutionTimeout (60s) still leaves
  // room for the resume invocation(s) to retry and complete.
  lambdaTimeoutSeconds: 5,
};

/**
 * Handler that runs an AT_MOST_ONCE_PER_RETRY step which is interrupted on its
 * first attempt (it sleeps longer than the Lambda `Timeout`) and then succeeds
 * on the retry attempt.
 *
 * Flow exercised (step-handler interrupted-step path):
 * 1. First invocation: the step checkpoints START and sleeps past the Lambda
 *    Timeout, so the process is killed leaving the step in STARTED state.
 * 2. Resume invocation: the SDK detects the STARTED step under
 *    AT_MOST_ONCE_PER_RETRY, synthesizes a StepInterruptedError, and asks the
 *    retryStrategy what to do. Unlike step/interrupted-no-retry (which returns
 *    shouldRetry: false and surfaces the interruption as a StepError), this
 *    strategy returns shouldRetry: true. The SDK checkpoints a RETRY with
 *    NextAttemptDelaySeconds and re-schedules the step.
 * 3. The step re-executes on the next attempt; because attempt > 1 it returns
 *    immediately instead of sleeping, so the step — and the execution —
 *    succeed.
 */
export const handler = withDurableExecution(
  async (
    event: { firstAttemptDurationMs?: number },
    context: DurableContext,
  ) => {
    // Default to 30s — must exceed the per-function Lambda Timeout (5s).
    const firstAttemptDurationMs = event?.firstAttemptDurationMs ?? 30_000;

    const result = await context.step(
      "resumable-step",
      async ({ attempt }) => {
        // Only the first attempt sleeps long enough to be interrupted. Every
        // subsequent (retry) attempt returns quickly and succeeds.
        if (attempt === 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, firstAttemptDurationMs),
          );
        }
        return `completed on attempt ${attempt}`;
      },
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        // RETRY the interrupted step (the complement of interrupted-no-retry).
        // Capped so a persistent interruption can't loop forever.
        retryStrategy: (_error, attempt) => ({
          shouldRetry: attempt < 4,
          delay: { seconds: 1 },
        }),
      },
    );

    return { status: "succeeded", result };
  },
);
