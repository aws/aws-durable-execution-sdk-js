import { Serdes } from "../utils/serdes/serdes";
import { StepContext } from "./logger";
import { Duration } from "../types";

export interface RetryDecision {
  shouldRetry: boolean;
  delay?: Duration;
}

export enum StepSemantics {
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",
  AtLeastOncePerRetry = "AT_LEAST_ONCE_PER_RETRY",
}

/**
 * Jitter strategy for retry delays to prevent thundering herd problem
 * @remarks
 * Jitter adds randomness to retry delays to spread out retry attempts when multiple operations fail simultaneously
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
 */
export type StepFunc<T> = (context: StepContext) => Promise<T>;
