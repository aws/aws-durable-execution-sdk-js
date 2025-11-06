import { createRetryStrategy, JitterStrategy } from "../retry-config";

/**
 * Pre-configured retry strategies for common use cases
 * @example
 * ```typescript
 * // Use default retry preset (3 attempts with exponential backoff)
 * await context.step('my-step', async () => {
 *   return await someOperation();
 * }, { retryStrategy: retryPresets.default });
 *
 * // Use no-retry preset (fail immediately on error)
 * await context.step('critical-step', async () => {
 *   return await criticalOperation();
 * }, { retryStrategy: retryPresets.noRetry });
 * ```
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
   * No retry strategy - fails immediately on first error
   * - 1 total attempt (no retries)
   */
  noRetry: createRetryStrategy({
    maxAttempts: 1,
  }),
};
