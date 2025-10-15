import { RetryDecision, JitterStrategy } from "../../../types";

/**
 * Configuration options for creating a retry strategy
 */
interface RetryStrategyConfig {
  /** Maximum number of total attempts (including initial attempt). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in seconds before first retry. Default: 5 */
  initialDelaySeconds?: number;
  /** Maximum delay in seconds between retries. Default: 300 (5 minutes) */
  maxDelaySeconds?: number;
  /** Multiplier for exponential backoff on each retry. Default: 2 */
  backoffRate?: number;
  /** Jitter strategy to apply to retry delays. Default: JitterStrategy.FULL */
  jitter?: JitterStrategy;
  /** List of error message patterns (strings or RegExp) that are retryable. Default: all errors */
  retryableErrors?: (string | RegExp)[];
  /** List of error class types that are retryable. Default: none */
  retryableErrorTypes?: (new () => Error)[];
}

const DEFAULT_CONFIG: Required<RetryStrategyConfig> = {
  maxAttempts: 3,
  initialDelaySeconds: 5,
  maxDelaySeconds: 300, // 5 minutes
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
 * @param config - Configuration options for the retry strategy
 * @returns A function that determines whether to retry and calculates delay based on error and attempt count
 * @example
 * ```typescript
 * // Create a custom retry strategy
 * const customRetry = createRetryStrategy({
 *   maxAttempts: 5,
 *   initialDelaySeconds: 10,
 *   backoffRate: 2,
 *   jitter: JitterStrategy.HALF,
 *   retryableErrors: [/timeout/i, /connection/i]
 * });
 *
 * // Use in step configuration
 * await context.step('api-call', async () => {
 *   return await callExternalAPI();
 * }, { retryStrategy: customRetry });
 * ```
 */
export const createRetryStrategy = (config: RetryStrategyConfig = {}) => {
  const finalConfig: Required<RetryStrategyConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
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
    const baseDelay = Math.min(
      finalConfig.initialDelaySeconds *
        Math.pow(finalConfig.backoffRate, attemptsMade - 1),
      finalConfig.maxDelaySeconds,
    );

    // Apply jitter
    const delayWithJitter = applyJitter(baseDelay, finalConfig.jitter);

    // Ensure delay is an integer >= 1
    const finalDelay = Math.max(1, Math.round(delayWithJitter));

    return { shouldRetry: true, delaySeconds: finalDelay };
  };
};

export type { RetryStrategyConfig };
export { JitterStrategy };
