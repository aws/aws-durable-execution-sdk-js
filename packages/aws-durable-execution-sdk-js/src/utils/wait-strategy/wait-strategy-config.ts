import {
  type WaitForConditionDecision,
  JitterStrategy,
  type Duration,
} from "../../types";
import { durationToSeconds } from "../duration/duration";

/**
 * Options for {@link createWaitStrategy}.
 *
 * @public
 */
interface WaitStrategyConfig<T> {
  /**
   * Maximum number of checks. When the last check still says to continue, the
   * strategy throws.
   *
   * @defaultValue 60
   */
  maxAttempts?: number;
  /**
   * Delay before the second check.
   *
   * @defaultValue `{ seconds: 5 }`
   */
  initialDelay?: Duration;
  /**
   * Upper limit for the delay between checks, before jitter.
   *
   * @defaultValue `{ seconds: 300 }`
   */
  maxDelay?: Duration;
  /**
   * Factor that multiplies the delay after each check.
   *
   * @defaultValue 1.5
   */
  backoffRate?: number;
  /**
   * Random change applied to each delay.
   *
   * @defaultValue `JitterStrategy.FULL`
   */
  jitter?: JitterStrategy;
  /**
   * Returns `true` while the condition is not met yet, so polling continues.
   * Returns `false` to stop polling and return the state.
   */
  shouldContinuePolling: (result: T) => boolean;
  /**
   * @deprecated The strategy ignores this option. Limit the total wait with
   * `maxAttempts`, `initialDelay`, `maxDelay` and `backoffRate`.
   */
  timeoutSeconds?: number;
}

const DEFAULT_CONFIG = {
  maxAttempts: 60,
  initialDelay: { seconds: 5 },
  maxDelay: { seconds: 300 }, // 5 minutes
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

/**
 * Creates a wait strategy for `context.waitForCondition` that polls with
 * exponential backoff.
 *
 * @remarks
 * The delay before check `n + 1` is `initialDelay * backoffRate^(n - 1)`,
 * capped at `maxDelay`. The strategy then applies `jitter` and rounds the
 * delay to whole seconds, with a minimum of 1 second. After `maxAttempts`
 * checks that all say to continue, it throws an error, and
 * `waitForCondition` fails.
 *
 * @example
 * ```typescript
 * const job = await context.waitForCondition(
 *   async (state) => getJobStatus(state.jobId),
 *   {
 *     initialState: { jobId, status: "PENDING" },
 *     waitStrategy: createWaitStrategy({
 *       maxAttempts: 20,
 *       initialDelay: { seconds: 10 },
 *       shouldContinuePolling: (state) => state.status === "PENDING",
 *     }),
 *   },
 * );
 * ```
 *
 * @param config - Backoff options and the condition that keeps polling.
 * @returns A function that takes the latest state and the number of checks
 * made, and returns whether to continue and how long to wait.
 *
 * @public
 */
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
    const initialDelaySeconds = durationToSeconds(finalConfig.initialDelay);
    const maxDelaySeconds = durationToSeconds(finalConfig.maxDelay);

    const baseDelay = Math.min(
      initialDelaySeconds * finalConfig.backoffRate ** (attemptsMade - 1),
      maxDelaySeconds,
    );

    // Apply jitter
    const delayWithJitter = applyJitter(baseDelay, finalConfig.jitter);

    // Ensure delay is an integer >= 1
    const finalDelay = Math.max(1, Math.round(delayWithJitter));

    return { shouldContinue: true, delay: { seconds: finalDelay } };
  };
};

export type { WaitStrategyConfig };
