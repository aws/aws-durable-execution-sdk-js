import {
  DurableContext,
  withDurableExecution,
  withRetry,
  createLinearRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "With Retry - Linear Strategy",
  description:
    "Retries a flaky block of durable logic with a LINEAR backoff strategy " +
    "(createLinearRetryStrategy) using the anonymous withRetry helper. Delays " +
    "grow linearly (1s, 2s, 3s, ...) rather than exponentially.",
};

/**
 * Demonstrates {@link createLinearRetryStrategy}, the linear-backoff retry
 * strategy, driven through the anonymous form of {@link withRetry}.
 *
 * Unlike the default exponential preset, a linear strategy increases the delay
 * by a fixed `increment` on every attempt:
 *
 *   delay = min(initialDelay + increment * (attempt - 1), maxDelay)
 *
 * Here the first retry waits 1s, the second 2s, the third 3s, and so on, capped
 * at 10s. That third delay is what distinguishes linear from exponential
 * backoff: an exponential strategy with the same 1s initial delay would wait
 * 1s, 2s, 4s. `JitterStrategy.NONE` keeps the delays deterministic so the
 * behavior is easy to reason about in an example; production code often prefers
 * FULL jitter to avoid a thundering herd.
 *
 * We use the *anonymous* `withRetry(context, func, config)` overload (no name),
 * so the backoff waits between attempts are anonymous. `withRetry` re-runs the
 * whole function body from the top on each failure — this is "retry this block
 * of logic", not "retry a single operation".
 */
export const handler = withDurableExecution(
  async (
    event: { succeedOnAttempt?: number },
    context: DurableContext,
  ): Promise<{ message: string; attempts: number }> => {
    // Succeed on the 4th attempt by default: attempts 1, 2 and 3 fail, so the
    // linear strategy is exercised three times (1s, 2s, then 3s backoff). Three
    // delays rather than two is deliberate — the first two are the same under
    // exponential backoff, so only the 3s delay proves the strategy is linear.
    const succeedOnAttempt = event?.succeedOnAttempt ?? 4;
    let attempts = 0;

    const message = await withRetry<string>(
      context,
      async (_ctx, attempt) => {
        attempts = attempt;
        // Simulate a flaky upstream that only becomes healthy after warming up.
        if (attempt < succeedOnAttempt) {
          throw new Error(
            `Upstream temporarily unavailable (attempt ${attempt})`,
          );
        }
        return `request confirmed on attempt ${attempt}`;
      },
      {
        // Linear backoff: 1s, 2s, 3s, 4s (capped at maxDelay), up to 5 attempts.
        retryStrategy: createLinearRetryStrategy({
          maxAttempts: 5,
          initialDelay: { seconds: 1 },
          increment: { seconds: 1 },
          maxDelay: { seconds: 10 },
          jitter: JitterStrategy.NONE,
        }),
      },
    );

    return { message, attempts };
  },
);
