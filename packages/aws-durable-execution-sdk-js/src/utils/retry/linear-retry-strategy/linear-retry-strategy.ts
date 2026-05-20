import { RetryDecision } from "../../../types";

/**
 * Creates a linear backoff retry strategy
 * @param maxAttempts - Maximum number of attempts (default: 6)
 * @param initialDelay - Initial delay in seconds (default: 1)
 * @param increment - Linear increment per attempt in seconds (default: 1)
 * @returns Retry strategy with linear backoff
 */
export const createLinearRetryStrategy = (
  maxAttempts: number = 6,
  initialDelay: number = 1,
  increment: number = 1,
) => {
  return (error: Error, attemptsMade: number): RetryDecision => {
    if (attemptsMade >= maxAttempts) {
      return { shouldRetry: false };
    }

    return {
      shouldRetry: true,
      delay: { seconds: initialDelay + increment * (attemptsMade - 1) },
    };
  };
};
