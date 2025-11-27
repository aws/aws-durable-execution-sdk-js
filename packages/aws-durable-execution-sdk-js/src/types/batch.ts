import { Serdes } from "../utils/serdes/serdes";
import { DurableContext } from "./durable-context";
import { ChildContextError } from "../errors/durable-error/durable-error";
import { DurableLogger } from "./durable-logger";

/**
 * The status of a batch item
 * @public
 */
export enum BatchItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  STARTED = "STARTED",
}

/**
 * Represents a single item in a batch result
 *
 * @public
 */
export interface BatchItem<TResult> {
  /** The result value if the item succeeded */
  result?: TResult;
  /** The error if the item failed (always ChildContextError since batch items run in child contexts) */
  error?: ChildContextError;
  /** Index of the item in the original array */
  index: number;
  /** Status of the item execution */
  status: BatchItemStatus;
}

/**
 * Result of a batch operation (map, parallel, or concurrent execution)
 *
 * @public
 */
export interface BatchResult<TResult> {
  /** All items in the batch with their results/errors */
  all: Array<BatchItem<TResult>>;
  /** Returns only the items that succeeded */
  succeeded(): Array<BatchItem<TResult> & { result: TResult }>;
  /** Returns only the items that failed */
  failed(): Array<BatchItem<TResult> & { error: ChildContextError }>;
  /** Returns only the items that are still in progress */
  started(): Array<BatchItem<TResult> & { status: BatchItemStatus.STARTED }>;
  /** Overall status of the batch (SUCCEEDED if no failures, FAILED otherwise) */
  status: BatchItemStatus.SUCCEEDED | BatchItemStatus.FAILED;
  /** Reason why the batch completed */
  completionReason:
    | "ALL_COMPLETED"
    | "MIN_SUCCESSFUL_REACHED"
    | "FAILURE_TOLERANCE_EXCEEDED";
  /** Whether any item in the batch failed */
  hasFailure: boolean;
  /** Throws the first error if any item failed */
  throwIfError(): void;
  /** Returns array of all successful results */
  getResults(): Array<TResult>;
  /** Returns array of all errors */
  getErrors(): Array<ChildContextError>;
  /** Number of successful items */
  successCount: number;
  /** Number of failed items */
  failureCount: number;
  /** Number of started but not completed items */
  startedCount: number;
  /** Total number of items */
  totalCount: number;
}

/**
 * @public
 */
export interface CompletionConfig {
  /** Minimum number of successful executions required */
  minSuccessful?: number;
  /** Maximum number of failures tolerated */
  toleratedFailureCount?: number;
  /** Maximum percentage of failures tolerated (0-100) */
  toleratedFailurePercentage?: number;
}

/**
 * Function to be executed for each item in a map operation
 * @param context - DurableContext for executing durable operations within the map
 * @param item - Current item being processed
 * @param index - Index of the current item in the array
 * @param array - The original array being mapped over
 * @returns Promise resolving to the transformed value
 *
 * @public
 */
export type MapFunc<TInput, TOutput, Logger extends DurableLogger> = (
  context: DurableContext<Logger>,
  item: TInput,
  index: number,
  array: TInput[],
) => Promise<TOutput>;

/**
 * Configuration options for map operations
 * @public
 */
export interface MapConfig<TItem, TResult> {
  /** Maximum number of concurrent executions (default: unlimited) */
  maxConcurrency?: number;
  /** Function to generate custom names for map items */
  itemNamer?: (item: TItem, index: number) => string;
  /** Serialization/deserialization configuration for parent context */
  serdes?: Serdes<BatchResult<TResult>>;
  /** Serialization/deserialization configuration for each item */
  itemSerdes?: Serdes<TResult>;
  /** Configuration for completion behavior */
  completionConfig?: CompletionConfig;
}

/**
 * Function to be executed as a branch in a parallel operation
 * @param context - DurableContext for executing durable operations within the branch
 * @returns Promise resolving to the branch result
 *
 * @public
 */
export type ParallelFunc<
  TResult,
  Logger extends DurableLogger = DurableLogger,
> = (context: DurableContext<Logger>) => Promise<TResult>;

/**
 * Named parallel branch with optional custom name
 * @public
 */
export interface NamedParallelBranch<TResult, Logger extends DurableLogger> {
  name?: string;
  func: ParallelFunc<TResult, Logger>;
}

/**
 * Configuration options for parallel operations
 * @public
 */
export interface ParallelConfig<TResult> {
  /** Maximum number of concurrent executions (default: unlimited) */
  maxConcurrency?: number;
  /** Serialization/deserialization configuration for parent context */
  serdes?: Serdes<BatchResult<TResult>>;
  /** Serialization/deserialization configuration for each branch */
  itemSerdes?: Serdes<TResult>;
  /** Configuration for completion behavior */
  completionConfig?: CompletionConfig;
}

/**
 * Represents an item to be executed with metadata for deterministic replay
 * @public
 */
export interface ConcurrentExecutionItem<T> {
  /** Unique identifier for the item */
  id: string;
  /** The actual data/payload for the item */
  data: T;
  /** Index of the item in the original array */
  index: number;
  /** Optional custom name for the item */
  name?: string;
}

/**
 * Executor function type for concurrent execution
 * @public
 */
export type ConcurrentExecutor<TItem, TResult, Logger extends DurableLogger> = (
  item: ConcurrentExecutionItem<TItem>,
  childContext: DurableContext<Logger>,
) => Promise<TResult>;

/**
 * Configuration options for concurrent execution operations
 * @public
 */
export interface ConcurrencyConfig<TResult> {
  /** Maximum number of concurrent executions (default: unlimited) */
  maxConcurrency?: number;
  /** Top-level operation subtype for tracking */
  topLevelSubType?: string;
  /** Iteration-level operation subtype for tracking */
  iterationSubType?: string;
  /** Function to generate summary from batch result */
  summaryGenerator?: (result: BatchResult<TResult>) => string;
  /** Serialization/deserialization configuration for parent context */
  serdes?: Serdes<BatchResult<TResult>>;
  /** Serialization/deserialization configuration for each item */
  itemSerdes?: Serdes<TResult>;
  /** Configuration for completion behavior */
  completionConfig?: CompletionConfig;
}
