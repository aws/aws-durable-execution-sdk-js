import { WaitForConditionDecision, JitterStrategy } from "../../types";

interface WaitStrategyConfig<T> {
  maxAttempts?: number; // Maximum number of attempts
  initialDelaySeconds?: number; // Initial delay before first retry
  maxDelaySeconds?: number; // Maximum delay between retries
  backoffRate?: number; // Multiplier for each subsequent retry
  jitter?: JitterStrategy; // Jitter strategy to apply to retry delays
  shouldContinuePolling: (result: T) => boolean; // Function to determine if polling should continue
  timeoutSeconds?: number; // Maximum total time to wait (not implemented in this version)
}

const DEFAULT_CONFIG = {
  maxAttempts: 60,
  initialDelaySeconds: 5,
  maxDelaySeconds: 300, // 5 minutes
  backoffRate: 1.5,
  jitter: JitterStrategy.FULL,
  timeoutSeconds: undefined, // No timeout by default
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
  }
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
    const baseDelay = Math.min(
      finalConfig.initialDelaySeconds *
        Math.pow(finalConfig.backoffRate, attemptsMade - 1),
      finalConfig.maxDelaySeconds,
    );

    // Apply jitter
    const delayWithJitter = applyJitter(baseDelay, finalConfig.jitter);

    // Ensure delay is an integer >= 1
    const finalDelay = Math.max(1, Math.round(delayWithJitter));

    return { shouldContinue: true, delaySeconds: finalDelay };
  };
};

export type { WaitStrategyConfig };
