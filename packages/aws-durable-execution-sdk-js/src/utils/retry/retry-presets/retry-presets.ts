import { createRetryStrategy, JitterStrategy } from "../retry-config";
import { createLinearRetryStrategy } from "../linear-retry-strategy/linear-retry-strategy";

/**
 * Pre-configured retry strategies for common use cases
 * @example
 * ```typescript
 * // Use default retry preset (6 attempts with exponential backoff)
 * await context.step('my-step', async () => {
 *   return await someOperation();
 * }, { retryStrategy: retryPresets.default });
 *
 * // Use linear retry preset (1s, 2s, 3s, 4s, 5s delays)
 * await context.step('linear-step', async () => {
 *   return await someOperation();
 * }, { retryStrategy: retryPresets.linear });
 *
 * // Use no-retry preset (fail immediately on error)
 * await context.step('critical-step', async () => {
 *   return await criticalOperation();
 * }, { retryStrategy: retryPresets.noRetry });
 * ```
 *
 * @public
 */
export const retryPresets = {
  /**
   * Default retry strategy with exponential backoff
   * - 6 total attempts (1 initial + 5 retries)
   * - Initial delay: 5 seconds
   * - Max delay: 60 seconds
   * - Backoff rate: 2x
   * - Jitter: FULL (randomizes delay between 0 and calculated delay)
   * - Total max wait time less than 150 seconds (2:30)
   */
  default: createRetryStrategy({
    maxAttempts: 6,
    initialDelay: { seconds: 5 },
    maxDelay: { seconds: 60 },
    backoffRate: 2,
    jitter: JitterStrategy.FULL,
  }),

  /**
   * Linear retry strategy with fixed increment
   * - 6 total attempts (1 initial + 5 retries)
   * - Delays: 1s, 2s, 3s, 4s, 5s
   * - Total max wait time: 15 seconds
   */
  linear: createLinearRetryStrategy(6, 1, 1),

  /**
   * No retry strategy - fails immediately on first error
   * - 1 total attempt (no retries)
   */
  noRetry: createRetryStrategy({
    maxAttempts: 1,
  }),
};
