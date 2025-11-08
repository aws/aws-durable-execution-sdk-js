import { Serdes } from "../utils/serdes/serdes";
import { DurableContext } from "./durable-context";
import { ChildContextError } from "../errors/durable-error/durable-error";

export enum BatchItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  STARTED = "STARTED",
}

/**
 * Represents a single item in a batch result
 */
export interface BatchItem<R> {
  /** The result value if the item succeeded */
  result?: R;
  /** The error if the item failed (always ChildContextError since batch items run in child contexts) */
  error?: ChildContextError;
  /** Index of the item in the original array */
  index: number;
  /** Status of the item execution */
  status: BatchItemStatus;
}

/**
 * Result of a batch operation (map, parallel, or concurrent execution)
 */
export interface BatchResult<R> {
  /** All items in the batch with their results/errors */
  all: Array<BatchItem<R>>;
  /** Returns only the items that succeeded */
  succeeded(): Array<BatchItem<R> & { result: R }>;
  /** Returns only the items that failed */
  failed(): Array<BatchItem<R> & { error: ChildContextError }>;
  /** Returns only the items that are still in progress */
  started(): Array<BatchItem<R> & { status: BatchItemStatus.STARTED }>;
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
  getResults(): Array<R>;
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
 */
export type MapFunc<TInput, TOutput> = (
  context: DurableContext,
  item: TInput,
  index: number,
  array: TInput[],
) => Promise<TOutput>;

/**
 * Configuration options for map operations
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
 */
export type ParallelFunc<T> = (context: DurableContext) => Promise<T>;

/**
 * Named parallel branch with optional custom name
 */
export interface NamedParallelBranch<T> {
  name?: string;
  func: ParallelFunc<T>;
}

/**
 * Configuration options for parallel operations
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
 */
export type ConcurrentExecutor<TItem, TResult> = (
  item: ConcurrentExecutionItem<TItem>,
  childContext: DurableContext,
) => Promise<TResult>;

/**
 * Configuration options for concurrent execution operations
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
