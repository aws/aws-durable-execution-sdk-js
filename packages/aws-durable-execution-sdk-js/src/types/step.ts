import type { Serdes } from "../utils/serdes/serdes";
import type { StepContext } from "./logger";
import type { DurableLogger, Duration } from "../types";

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
  /**
   * Pauses the durable execution after this failed attempt.
   *
   * @remarks
   * When `pause` is true and `shouldRetry` is true, the SDK saves the retry as usual, calls
   * the Lambda `PauseDurableExecution` API and ends the invocation. An operator resumes the
   * execution with the Lambda `ResumeDurableExecution` API. After the resume, the next attempt
   * runs. When `shouldRetry` is false, the SDK ignores `pause` and the step fails as usual. So
   * `pause` never changes how many attempts run.
   *
   * A pause happens only when the step function threw in this invocation. A step that was
   * interrupted in an earlier invocation does not pause. Steps and the submitter step of
   * `waitForCallback` use `pause`. {@link withRetry} ignores it.
   *
   * The function's execution role needs `lambda:PauseDurableExecution` on the function's own
   * durable execution ARNs. You give it that permission. If the function uses a customer
   * managed AWS KMS key, the role also needs `kms:Decrypt` on that key. Without these
   * permissions, the pause call fails, the SDK logs a warning and the step retries as usual.
   * The step also retries as usual when the `DurableExecutionClient` has no `pauseExecution`
   * method, for example a custom transport.
   *
   * The pause ends the invocation at once. A step that is still running in another `parallel`
   * or `map` branch is stopped. After the resume, an at-least-once step runs again, and an
   * `AtMostOncePerRetry` step counts it as an interrupted attempt.
   *
   * @defaultValue false
   * @experimental This option is experimental and may be changed or removed in future releases.
   */
  pause?: boolean;
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
  /**
   * Subtype recorded in the checkpoint, in replay validation, and in plugin
   * events. The default is `"Step"`.
   *
   * A custom operation built from steps uses this to label its steps, so
   * history and plugins can filter them without parsing names. The service
   * accepts 1 to 32 characters from `[a-zA-Z0-9-_]`. An empty string selects
   * the default.
   *
   * Replay compares the subtype with the checkpoint. So changing the subtype
   * of an existing step is a breaking change for executions in flight.
   */
  subType?: string;
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
