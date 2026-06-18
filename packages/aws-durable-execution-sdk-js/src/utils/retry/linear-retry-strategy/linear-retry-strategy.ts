import { RetryDecision, JitterStrategy, Duration } from "../../../types";
import { durationToSeconds } from "../../duration/duration";
import {
  finalizeDelaySeconds,
  isErrorRetryable,
  resolveRetryableErrors,
} from "../retry-common/retry-common";

/**
 * Configuration options for creating a linear backoff retry strategy.
 *
 * @remarks
 * When neither `retryableErrors` nor `retryableErrorTypes` is specified, all errors are retried by default.
 * When either is specified, only errors matching the specified criteria are retried.
 * When both are specified, errors matching either criteria are retried (OR logic).
 *
 * @example
 * ```typescript
 * // Retry all errors (default behavior), 1s, 2s, 3s, 4s, 5s delays
 * createLinearRetryStrategy()
 *
 * // Custom delays starting at 2s, growing by 3s each attempt, capped at 30s
 * createLinearRetryStrategy({
 *   maxAttempts: 5,
 *   initialDelay: { seconds: 2 },
 *   increment: { seconds: 3 },
 *   maxDelay: { seconds: 30 },
 * })
 *
 * // Retry only specific error types
 * createLinearRetryStrategy({ retryableErrorTypes: [TimeoutError, NetworkError] })
 * ```
 *
 * @public
 */
interface LinearRetryStrategyConfig {
  /**
   * Maximum number of total attempts (including initial attempt).
   * @defaultValue 6
   */
  maxAttempts?: number;

  /**
   * Initial delay before the first retry.
   * @defaultValue \{ seconds: 1 \}
   */
  initialDelay?: Duration;

  /**
   * Linear increment added to the delay for each subsequent retry.
   * @defaultValue \{ seconds: 1 \}
   */
  increment?: Duration;

  /**
   * Maximum delay between retries. The linearly growing delay is capped at this value.
   * @defaultValue \{ minutes: 5 \}
   */
  maxDelay?: Duration;

  /**
   * Jitter strategy to apply to retry delays.
   * @defaultValue JitterStrategy.FULL
   * @see {@link JitterStrategy}
   */
  jitter?: JitterStrategy;

  /**
   * List of error message patterns (strings or RegExp) that are retryable.
   *
   * @remarks
   * - If undefined and `retryableErrorTypes` is also undefined: all errors are retried (default)
   * - If specified: only errors with messages matching these patterns are retried
   * - Strings are matched using `includes()`, RegExp patterns use `test()`
   * - Combined with `retryableErrorTypes` using OR logic
   *
   * @defaultValue All errors when both filters are undefined, otherwise empty array
   */
  retryableErrors?: (string | RegExp)[];

  /**
   * List of error class types that are retryable.
   *
   * @remarks
   * - If undefined and `retryableErrors` is also undefined: all errors are retried (default)
   * - If specified: only errors that are instances of these types are retried
   * - Combined with `retryableErrors` using OR logic
   *
   * @defaultValue Empty array
   */
  retryableErrorTypes?: (new () => Error)[];
}

const DEFAULT_CONFIG: Required<LinearRetryStrategyConfig> = {
  maxAttempts: 6,
  initialDelay: { seconds: 1 },
  increment: { seconds: 1 },
  maxDelay: { minutes: 5 },
  jitter: JitterStrategy.FULL,
  retryableErrors: [/.*/], // By default, retry all errors
  retryableErrorTypes: [],
};

/**
 * Creates a retry strategy function with linear backoff and configurable jitter.
 *
 * @param config - Configuration options for the retry strategy
 * @returns A function that determines whether to retry and calculates delay based on error and attempt count
 *
 * @remarks
 * The returned function takes an error and attempt count, and returns a {@link RetryDecision} indicating
 * whether to retry and the delay before the next attempt.
 *
 * **Delay Calculation:**
 * - Base delay = `initialDelay + increment × (attemptsMade - 1)`
 * - Capped at `maxDelay`
 * - Jitter applied based on `jitter` strategy
 * - Final delay rounded to nearest second, minimum 1 second
 *
 * **Error Filtering:**
 * - If neither `retryableErrors` nor `retryableErrorTypes` is specified: all errors are retried
 * - If either is specified: only matching errors are retried
 * - If both are specified: errors matching either criteria are retried (OR logic)
 *
 * @example
 * ```typescript
 * // Defaults: retry all errors, 6 attempts, 1s, 2s, 3s, 4s, 5s delays (before jitter)
 * const linearRetry = createLinearRetryStrategy();
 *
 * // Use in step configuration
 * await context.step('api-call', async () => {
 *   return await callExternalAPI();
 * }, { retryStrategy: createLinearRetryStrategy({ jitter: JitterStrategy.NONE }) });
 * ```
 *
 * @see {@link LinearRetryStrategyConfig} for configuration options
 * @see {@link JitterStrategy} for jitter strategies
 * @see {@link RetryDecision} for return type
 *
 * @public
 */
export const createLinearRetryStrategy = (
  config: LinearRetryStrategyConfig = {},
) => {
  const { retryableErrors, retryableErrorTypes } = resolveRetryableErrors(
    config.retryableErrors,
    config.retryableErrorTypes,
  );

  const finalConfig: Required<LinearRetryStrategyConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    retryableErrors,
    retryableErrorTypes,
  };

  return (error: Error, attemptsMade: number): RetryDecision => {
    // Check if we've exceeded max attempts
    if (attemptsMade >= finalConfig.maxAttempts) {
      return { shouldRetry: false };
    }

    // Check if error is retryable based on message patterns and/or types
    if (
      !isErrorRetryable(
        error,
        finalConfig.retryableErrors,
        finalConfig.retryableErrorTypes,
      )
    ) {
      return { shouldRetry: false };
    }

    // Calculate delay with linear backoff
    const initialDelaySeconds = durationToSeconds(finalConfig.initialDelay);
    const incrementSeconds = durationToSeconds(finalConfig.increment);
    const maxDelaySeconds = durationToSeconds(finalConfig.maxDelay);

    const baseDelay = Math.min(
      initialDelaySeconds + incrementSeconds * (attemptsMade - 1),
      maxDelaySeconds,
    );

    // Apply jitter and normalize to an integer >= 1 second
    const finalDelay = finalizeDelaySeconds(baseDelay, finalConfig.jitter);

    return { shouldRetry: true, delay: { seconds: finalDelay } };
  };
};

export type { LinearRetryStrategyConfig };
