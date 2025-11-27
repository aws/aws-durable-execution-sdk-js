import { RetryDecision, JitterStrategy, Duration } from "../../../types";
import { durationToSeconds } from "../../duration/duration";

/**
 * Configuration options for creating a retry strategy
 * 
 * @remarks
 * When neither `retryableErrors` nor `retryableErrorTypes` is specified, all errors are retried by default.
 * When either is specified, only errors matching the specified criteria are retried.
 * When both are specified, errors matching either criteria are retried (OR logic).
 * 
 * @example
 * ```typescript
 * // Retry all errors (default behavior)
 * createRetryStrategy({ maxAttempts: 5 })
 * 
 * // Retry only specific error types
 * createRetryStrategy({ retryableErrorTypes: [TimeoutError, NetworkError] })
 * 
 * // Retry only errors matching message patterns
 * createRetryStrategy({ retryableErrors: [/timeout/i, /connection/i] })
 * 
 * // Retry errors matching either type OR pattern
 * createRetryStrategy({ 
 *   retryableErrorTypes: [TimeoutError],
 *   retryableErrors: [/network/i]
 * })
 * ```
 */
interface RetryStrategyConfig {
  /** 
   * Maximum number of total attempts (including initial attempt). 
   * @defaultValue 3
   */
  maxAttempts?: number;
  
  /** 
   * Initial delay before first retry. 
   * @defaultValue \{ seconds: 5 \}
   */
  initialDelay?: Duration;
  
  /** 
   * Maximum delay between retries. 
   * @defaultValue \{ minutes: 5 \}
   */
  maxDelay?: Duration;
  
  /** 
   * Multiplier for exponential backoff on each retry. 
   * @defaultValue 2
   */
  backoffRate?: number;
  
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
   * 
   * @example
   * ```typescript
   * // Retry errors containing "timeout" or "connection"
   * retryableErrors: ["timeout", "connection"]
   * 
   * // Retry errors matching regex patterns (case-insensitive)
   * retryableErrors: [/timeout/i, /network.*failed/i]
   * ```
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
   * 
   * @example
   * ```typescript
   * // Define custom error types
   * class TimeoutError extends Error {}
   * class NetworkError extends Error {}
   * 
   * // Retry only these specific error types
   * retryableErrorTypes: [TimeoutError, NetworkError]
   * ```
   */
  retryableErrorTypes?: (new () => Error)[];
}

const DEFAULT_CONFIG: Required<RetryStrategyConfig> = {
  maxAttempts: 3,
  initialDelay: { seconds: 5 },
  maxDelay: { minutes: 5 },
  backoffRate: 2,
  jitter: JitterStrategy.FULL,
  retryableErrors: [/.*/], // By default, retry all errors
  retryableErrorTypes: [],
};

const applyJitter = (delay: number, strategy: JitterStrategy): number => {
  switch (strategy) {
    case JitterStrategy.NONE:
      return delay;
    case JitterStrategy.FULL:
      // Random between 0 and delay
      return Math.random() * delay;
    case JitterStrategy.HALF:
      // Random between delay/2 and delay
      return delay / 2 + Math.random() * (delay / 2);
    default:
      return delay;
  }
};

/**
 * Creates a retry strategy function with exponential backoff and configurable jitter
 * 
 * @param config - Configuration options for the retry strategy
 * @returns A function that determines whether to retry and calculates delay based on error and attempt count
 * 
 * @remarks
 * The returned function takes an error and attempt count, and returns a {@link RetryDecision} indicating
 * whether to retry and the delay before the next attempt.
 * 
 * **Delay Calculation:**
 * - Base delay = `initialDelay × backoffRate^(attemptsMade - 1)`
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
 * // Basic usage with defaults (retry all errors, 3 attempts, exponential backoff)
 * const defaultRetry = createRetryStrategy();
 * 
 * // Custom retry with more attempts and specific delays
 * const customRetry = createRetryStrategy({
 *   maxAttempts: 5,
 *   initialDelay: { seconds: 10 },
 *   maxDelay: { seconds: 60 },
 *   backoffRate: 2,
 *   jitter: JitterStrategy.HALF
 * });
 * 
 * // Retry only specific error types
 * class TimeoutError extends Error {}
 * const typeBasedRetry = createRetryStrategy({
 *   retryableErrorTypes: [TimeoutError]
 * });
 * 
 * // Retry only errors matching message patterns
 * const patternBasedRetry = createRetryStrategy({
 *   retryableErrors: [/timeout/i, /connection/i, "rate limit"]
 * });
 * 
 * // Combine error types and patterns
 * const combinedRetry = createRetryStrategy({
 *   retryableErrorTypes: [TimeoutError],
 *   retryableErrors: [/network/i]
 * });
 * 
 * // Use in step configuration
 * await context.step('api-call', async () => {
 *   return await callExternalAPI();
 * }, { retryStrategy: customRetry });
 * ```
 * 
 * @see {@link RetryStrategyConfig} for configuration options
 * @see {@link JitterStrategy} for jitter strategies
 * @see {@link RetryDecision} for return type
 */
export const createRetryStrategy = (config: RetryStrategyConfig = {}) => {
  // Only apply default retryableErrors if user didn't specify either filter
  const shouldUseDefaultErrors =
    config.retryableErrors === undefined &&
    config.retryableErrorTypes === undefined;

  const finalConfig: Required<RetryStrategyConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    retryableErrors: config.retryableErrors ?? (shouldUseDefaultErrors ? [/.*/] : []),
  };

  return (error: Error, attemptsMade: number): RetryDecision => {
    // Check if we've exceeded max attempts
    if (attemptsMade >= finalConfig.maxAttempts) {
      return { shouldRetry: false };
    }

    // Check if error is retryable based on error message
    const isRetryableErrorMessage = finalConfig.retryableErrors.some(
      (pattern) => {
        if (pattern instanceof RegExp) {
          return pattern.test(error.message);
        }
        return error.message.includes(pattern);
      },
    );

    // Check if error is retryable based on error type
    const isRetryableErrorType = finalConfig.retryableErrorTypes.some(
      (ErrorType) => error instanceof ErrorType,
    );

    if (!isRetryableErrorMessage && !isRetryableErrorType) {
      return { shouldRetry: false };
    }

    // Calculate delay with exponential backoff
    const initialDelaySeconds = durationToSeconds(finalConfig.initialDelay);
    const maxDelaySeconds = durationToSeconds(finalConfig.maxDelay);

    const baseDelay = Math.min(
      initialDelaySeconds * Math.pow(finalConfig.backoffRate, attemptsMade - 1),
      maxDelaySeconds,
    );

    // Apply jitter
    const delayWithJitter = applyJitter(baseDelay, finalConfig.jitter);

    // Ensure delay is an integer >= 1
    const finalDelay = Math.max(1, Math.round(delayWithJitter));

    return { shouldRetry: true, delay: { seconds: finalDelay } };
  };
};

export type { RetryStrategyConfig };
export { JitterStrategy };
