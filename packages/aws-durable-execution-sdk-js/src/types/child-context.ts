import type { Serdes } from "../utils/serdes/serdes";
import type { DurableLogger } from "./durable-logger";
import type { DurableContext } from "./durable-context";
import { DurableOperationError } from "../errors/durable-error/durable-error";

/**
 * Configuration options for child context operations
 * @public
 */
export interface ChildConfig<T> {
  /** Serialization/deserialization configuration for child context data */
  serdes?: Serdes<T> | undefined;
  /** Sub-type identifier for categorizing child contexts */
  subType?: string | undefined;
  /** Function to generate summaries for large results (used internally by map/parallel) */
  summaryGenerator?: ((result: T) => string) | undefined;
  /** Function to map child context errors to custom error types based on the original error */
  errorMapper?: (originalError: DurableOperationError) => DurableOperationError;
  /** If true, skip checkpointing and use parent's parentId for child operations */
  virtualContext?: boolean;
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
