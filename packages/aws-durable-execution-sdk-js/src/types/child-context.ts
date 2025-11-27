import { Serdes } from "../utils/serdes/serdes";
import { DurableLogger } from "./durable-logger";
import { DurableContext } from "./durable-context";

/**
 * Configuration options for child context operations
 * @public
 */
export interface ChildConfig<T> {
  /** Serialization/deserialization configuration for child context data */
  serdes?: Serdes<T>;
  /** Sub-type identifier for categorizing child contexts */
  subType?: string;
  /** Function to generate summaries for large results (used internally by map/parallel) */
  summaryGenerator?: (result: T) => string;
}

/**
 * Function to be executed in a child context with isolated state
 * @param context - DurableContext with isolated step counter and state tracking
 * @returns Promise resolving to the child function result
 *
 * @public
 */
export type ChildFunc<T, Logger extends DurableLogger = DurableLogger> = (
  context: DurableContext<Logger>,
) => Promise<T>;
