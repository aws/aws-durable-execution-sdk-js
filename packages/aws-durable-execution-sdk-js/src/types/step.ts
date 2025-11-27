import { Serdes } from "../utils/serdes/serdes";
import { StepContext } from "./logger";
import { DurableLogger, Duration } from "../types";

/**
 * Decision returned by a retry strategy function
 *
 * @remarks
 * Returned by retry strategy functions to indicate whether an operation should be retried
 * and how long to wait before the next attempt.
 *
 * @example
 * ```typescript
 * // Don't retry
 * { shouldRetry: false }
 *
 * // Retry after 5 seconds
 * { shouldRetry: true, delay: { seconds: 5 } }
 *
 * // Retry after 2 minutes
 * { shouldRetry: true, delay: { minutes: 2 } }
 * ```
 *
 * @see {@link createRetryStrategy} for creating retry strategies
 *
 * @public
 */
export interface RetryDecision {
  /** Whether the operation should be retried */
  shouldRetry: boolean;
  /**
   * Delay before the next retry attempt
   * @remarks Only used when `shouldRetry` is true. If not specified, defaults to 1 second.
   */
  delay?: Duration;
}

/**
 * @public
 */
export enum StepSemantics {
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",
  AtLeastOncePerRetry = "AT_LEAST_ONCE_PER_RETRY",
}

/**
 * Jitter strategy for retry delays to prevent thundering herd. Jitter reduces simultaneous retry attempts
 * by spreading retries out over a randomized delay interval.
 *
 * @public
 */
export enum JitterStrategy {
  /** No jitter - use exact calculated delay */
  NONE = "NONE",
  /** Full jitter - random delay between 0 and calculated delay */
  FULL = "FULL",
  /** Half jitter - random delay between 50% and 100% of calculated delay */
  HALF = "HALF",
}

/**
 * Configuration options for step operations
 * @public
 */
export interface StepConfig<T> {
  /** Strategy for retrying failed step executions */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Execution semantics for the step (at-most-once or at-least-once per retry) */
  semantics?: StepSemantics;
  /** Serialization/deserialization configuration for step data */
  serdes?: Serdes<T>;
}

/**
 * Function to be executed as a durable step
 * @param context - Context for logging and other operations during step execution
 * @returns Promise resolving to the step result
 * @public
 */
export type StepFunc<T, Logger extends DurableLogger = DurableLogger> = (
  context: StepContext<Logger>,
) => Promise<T>;
