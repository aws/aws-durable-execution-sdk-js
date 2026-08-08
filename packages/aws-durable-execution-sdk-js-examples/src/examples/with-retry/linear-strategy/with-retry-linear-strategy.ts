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
    "grow linearly (1s, 2s, 3s, ...) rather than exponentially, up to maxDelay. " +
    "Retries can also be exhausted, in which case the last error propagates.",
};

interface RetryResult {
  message: string;
  attempts: number;
}

/**
 * Demonstrates {@link createLinearRetryStrategy}, the linear-backoff retry
 * strategy, driven through the anonymous form of {@link withRetry}.
 *
 * Unlike the default exponential preset, a linear strategy increases the delay
 * by a fixed `increment` on every attempt:
 *
 *   delay = min(initialDelay + increment * (attempt - 1), maxDelay)
 *
 * With the configuration below the delays are 1s, 2s, 3s, 4s. The third delay is
 * what distinguishes linear from exponential backoff: an exponential strategy
 * with the same 1s initial delay would wait 1s, 2s, 4s. `maxDelay` clamps them,
 * which the exhaustion test exercises by lowering it. `JitterStrategy.NONE` keeps the delays deterministic so
 * the behavior is easy to reason about in an example; production code often
 * prefers FULL jitter to avoid a thundering herd.
 *
 * We use the *anonymous* `withRetry(context, func, config)` overload (no name),
 * so the backoff waits between attempts are anonymous. `withRetry` re-runs the
 * whole function body from the top on each failure — this is "retry this block
 * of logic", not "retry a single operation".
 *
 * The "flaky upstream" here is plain in-process code, which keeps the example
 * about the strategy alone. A real upstream call belongs in a `context.step` so
 * that a successful attempt is checkpointed and not re-issued on replay.
 *
 * Note that the attempt count is *returned from inside* the retried function
 * rather than assigned to a variable in the enclosing scope. Closure mutations
 * do not survive a replay (AGENTS.md, "Closure Mutations Are Lost on Replay"):
 * the retry runs in a child context, so on resume the value is restored from its
 * checkpoint without the body re-running, and an outer variable would read back
 * as its initial value.
 */
export const handler = withDurableExecution(
  async (
    event: { succeedOnAttempt?: number; maxDelaySeconds?: number },
    context: DurableContext,
  ): Promise<RetryResult> => {
    // Succeed on the 4th attempt by default: attempts 1, 2 and 3 fail, so the
    // linear strategy is exercised three times (1s, 2s, then 3s backoff). Three
    // delays rather than two is deliberate — the first two are the same under
    // exponential backoff, so only the 3s delay proves the strategy is linear.
    //
    // Pass a value above `maxAttempts` to exhaust the retries instead, in which
    // case the last error propagates out of `withRetry`.
    const succeedOnAttempt = event.succeedOnAttempt ?? 4;

    // Generous by default so the delays grow unclamped and stay recognisably
    // linear. Lower it to watch `maxDelay` clamp them.
    const maxDelaySeconds = event.maxDelaySeconds ?? 10;

    return await withRetry<RetryResult>(
      context,
      async (_ctx, attempt) => {
        // Simulate a flaky upstream that only becomes healthy after warming up.
        if (attempt < succeedOnAttempt) {
          throw new Error(
            `Upstream temporarily unavailable (attempt ${attempt})`,
          );
        }
        return {
          message: `request confirmed on attempt ${attempt}`,
          attempts: attempt,
        };
      },
      {
        // Linear backoff over at most 5 attempts, so at most 4 delays:
        // 1s, 2s, 3s, 4s — each clamped to `maxDelay`.
        retryStrategy: createLinearRetryStrategy({
          maxAttempts: 5,
          initialDelay: { seconds: 1 },
          increment: { seconds: 1 },
          maxDelay: { seconds: maxDelaySeconds },
          jitter: JitterStrategy.NONE,
        }),
      },
    );
  },
);
