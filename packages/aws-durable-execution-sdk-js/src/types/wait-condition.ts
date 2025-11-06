import { Serdes } from "../utils/serdes/serdes";
import { WaitForConditionContext } from "./logger";
import { Duration } from "../types";

/**
 * Function that checks and updates state for waitForCondition operations
 * @param state - Current state value
 * @param context - Context for logging and other operations during state checking
 * @returns Promise resolving to the updated state
 */
export type WaitForConditionCheckFunc<T> = (
  state: T,
  context: WaitForConditionContext,
) => Promise<T>;

/**
 * Function that determines whether to continue waiting and how long to delay
 * @param state - Current state value
 * @param attempt - Current attempt number (starts at 1)
 * @returns Decision object indicating whether to continue and delay duration
 */
export type WaitForConditionWaitStrategyFunc<T> = (
  state: T,
  attempt: number,
) => WaitForConditionDecision;

/**
 * Decision object for waitForCondition wait strategy
 */
export type WaitForConditionDecision =
  | { shouldContinue: true; delay: Duration }
  | { shouldContinue: false };

/**
 * Configuration options for waitForCondition operations
 */
export interface WaitForConditionConfig<T> {
  /** Strategy function that determines when to continue waiting and how long to delay */
  waitStrategy: WaitForConditionWaitStrategyFunc<T>;
  /** Initial state value to start the condition checking with */
  initialState: T;
  /** Serialization/deserialization configuration for state data */
  serdes?: Serdes<T>;
}
