import { WaitForConditionDecision } from "../../types";

interface WaitStrategyConfig<T> {
  maxAttempts?: number; // Maximum number of attempts
  initialDelaySeconds?: number; // Initial delay before first retry
  maxDelaySeconds?: number; // Maximum delay between retries
  backoffRate?: number; // Multiplier for each subsequent retry
  jitterSeconds?: number; // Random time range to add/subtract from delay
  shouldContinuePolling: (result: T) => boolean; // Function to determine if polling should continue
  timeoutSeconds?: number; // Maximum total time to wait (not implemented in this version)
}

const DEFAULT_CONFIG = {
  maxAttempts: 60,
  initialDelaySeconds: 5,
  maxDelaySeconds: 300, // 5 minutes
  backoffRate: 1.5,
  jitterSeconds: 1,
  timeoutSeconds: undefined, // No timeout by default
};

export const createWaitStrategy = <T>(config: WaitStrategyConfig<T>) => {
  const finalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  return (result: T, attemptsMade: number): WaitForConditionDecision => {
    // Check if condition is met
    if (!finalConfig.shouldContinuePolling(result)) {
      return { shouldContinue: false };
    }

    // Check if we've exceeded max attempts
    if (attemptsMade >= finalConfig.maxAttempts) {
      throw new Error(
        `waitForCondition exceeded maximum attempts (${finalConfig.maxAttempts})`,
      );
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

    return { shouldContinue: true, delaySeconds: Math.round(finalDelay) };
  };
};

export type { WaitStrategyConfig };
