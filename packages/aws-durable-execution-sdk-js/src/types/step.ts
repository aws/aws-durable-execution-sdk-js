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
 * Execution semantics for step operations.
 *
 * @remarks
 * These semantics control how step execution is checkpointed and replayed. **Important**: The guarantees apply *per
 * retry attempt*, not per overall workflow execution.
 *
 * With retries enabled (the default), a step could execute multiple times across different retry attempts even when
 * using `AtMostOncePerRetry`. To achieve step-level at-most-once execution, combine `AtMostOncePerRetry` with a retry
 * strategy that disables retries (`shouldRetry: false`).
 *
 * @example
 * ```typescript
 * // At-least-once per retry (default) - safe for idempotent operations
 * await context.step("send-notification", async () => sendEmail(), {
 *   semantics: StepSemantics.AtLeastOncePerRetry,
 * });
 *
 * // At-most-once per retry - for non-idempotent operations
 * await context.step("charge-payment", async () => processPayment(), {
 *   semantics: StepSemantics.AtMostOncePerRetry,
 *   retryStrategy: () => ({ shouldRetry: false }),
 * });
 * ```
 *
 * @public
 */
export enum StepSemantics {
  /**
   * At-most-once execution per retry attempt.
   *
   * @remarks
   * A checkpoint is created before step execution. If a failure occurs after the checkpoint
   * but before step completion, the previous step retry attempt is skipped on replay.
   *
   * **Note**: This is "at-most-once *per retry*". With multiple retry attempts, the step
   * could still execute multiple times across different retries. To guarantee the step
   * executes at most once, disable retries by returning
   * `{ shouldRetry: false }` from your retry strategy.
   */
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",

  /**
   * At-least-once execution per retry attempt (default).
   *
   * @remarks
   * The step will execute at least once on each retry attempt. If the step succeeds
   * but the checkpoint fails (e.g., due to a sandbox crash), the step will re-execute
   * on replay. This is the safer default for operations that are idempotent or can
   * tolerate duplicate execution.
   */
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
