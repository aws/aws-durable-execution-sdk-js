import { RetryDecision } from "../../../types";

interface RetryStrategyConfig {
  maxAttempts?: number; // Maximum number of retry attempts
  initialDelaySeconds?: number; // Initial delay before first retry
  maxDelaySeconds?: number; // Maximum delay between retries
  backoffRate?: number; // Multiplier for each subsequent retry
  jitterSeconds?: number; // Random time range to add/subtract from delay
  retryableErrors?: (string | RegExp)[]; // List of errors that are retryable
  retryableErrorTypes?: (new () => Error)[]; // List of error types that are retryable
}

const DEFAULT_CONFIG: Required<RetryStrategyConfig> = {
  maxAttempts: 3,
  initialDelaySeconds: 5,
  maxDelaySeconds: 300, // 5 minutes
  backoffRate: 2,
  jitterSeconds: 1,
  retryableErrors: [/.*/], // By default, retry all errors
  retryableErrorTypes: [],
};

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
    const delay = Math.min(
      finalConfig.initialDelaySeconds *
        Math.pow(finalConfig.backoffRate, attemptsMade - 1),
      finalConfig.maxDelaySeconds,
    );

    // Add jitter
    const jitter = (Math.random() * 2 - 1) * finalConfig.jitterSeconds;
    const finalDelay = Math.max(1, delay + jitter);

    return { shouldRetry: true, delaySeconds: Math.round(finalDelay) };
  };
};

export type { RetryStrategyConfig };
