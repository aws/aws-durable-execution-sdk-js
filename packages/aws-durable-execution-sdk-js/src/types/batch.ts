import { Serdes } from "../utils/serdes/serdes";
import { DurableContext } from "./durable-context";
import { ChildContextError } from "../errors/durable-error/durable-error";
import { DurableLogger } from "./durable-logger";

/**
 * Nesting type for batch operations (map and parallel)
 *
 * Controls how child contexts are created for each branch/iteration, affecting
 * observability, cost, and scale limits.
 *
 * @public
 */
export enum NestingType {
  /**
   * Create CONTEXT operations for each branch/iteration with full checkpointing.
   * Operations within each branch/iteration are wrapped in their own context.
   *
   * - **Observability**: High - each branch/iteration appears as separate operation in execution history
   * - **Cost**: Higher - consumes more operations due to CONTEXT creation overhead
   * - **Scale**: Lower maximum iterations due to operation limits
   */
  NESTED = "NESTED",
  /**
   * Skip CONTEXT operations for branches/iterations using virtual contexts.
   * Operations execute directly without individual context wrapping.
   *
   * - **Observability**: Lower - branches/iterations don't appear as separate operations
   * - **Cost**: ~30% lower - reduces operation consumption by skipping CONTEXT overhead
   * - **Scale**: Higher maximum iterations possible within operation limits
   */
  FLAT = "FLAT",
}

/**
 * The status of a batch item
 * @public
 */
export enum BatchItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  /**
   * Item was still in flight when the batch completed early. Observability
   * only and not guaranteed to survive suspend/resume reconstruction — see
   * {@link BatchResult.started}.
   */
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
 * Reason why a batch operation (map, parallel, or concurrent execution)
 * completed.
 *
 * - `ALL_COMPLETED`: every item finished.
 * - `MIN_SUCCESSFUL_REACHED`: {@link CompletionConfig.minSuccessful} was reached.
 * - `FAILURE_TOLERANCE_EXCEEDED`: a failure threshold was exceeded.
 * - `CUSTOM_COMPLETION_SUCCEEDED`: a custom {@link CompletionConfig.shouldComplete}
 *   predicate signalled completion with a `SUCCEEDED` outcome before all items
 *   finished.
 * - `CUSTOM_COMPLETION_FAILED`: a custom {@link CompletionConfig.shouldComplete}
 *   predicate signalled completion with a `FAILED` outcome before all items
 *   finished.
 *
 * @public
 */
export type CompletionReason =
  | "ALL_COMPLETED"
  | "MIN_SUCCESSFUL_REACHED"
  | "FAILURE_TOLERANCE_EXCEEDED"
  | "CUSTOM_COMPLETION_SUCCEEDED"
  | "CUSTOM_COMPLETION_FAILED";

/**
 * Result of a batch operation (map, parallel, or concurrent execution)
 *
 * @public
 */
export interface BatchResult<TResult> {
  /**
   * All items in the batch with their results/errors.
   *
   * Treat this array as immutable: counts ({@link BatchResult.successCount},
   * {@link BatchResult.failureCount}, {@link BatchResult.startedCount}) and the
   * filtered views ({@link BatchResult.succeeded}, {@link BatchResult.failed},
   * {@link BatchResult.started}) are computed once and will not reflect
   * mutations made to this array after construction.
   *
   * The completed (SUCCEEDED/FAILED) items are stable across suspend/resume.
   * Any STARTED (in-flight) entries are not guaranteed to be reproduced on
   * replay — see {@link BatchResult.started}.
   */
  all: Array<BatchItem<TResult>>;
  /** Returns only the items that succeeded */
  succeeded(): Array<BatchItem<TResult> & { result: TResult }>;
  /** Returns only the items that failed */
  failed(): Array<BatchItem<TResult> & { error: ChildContextError }>;
  /**
   * Returns only the items that are still in progress (STARTED) — items that
   * were in flight when the batch completed early (e.g. via
   * {@link CompletionConfig.minSuccessful} or a custom
   * {@link CompletionConfig.shouldComplete}).
   *
   * @remarks
   * The STARTED set is observability-only and is **not guaranteed to be stable
   * across suspend/resume**. On a resumed invocation the batch result is
   * reconstructed, and when the aggregate result was large enough to be
   * checkpointed as a summary only the completed (SUCCEEDED/FAILED) items are
   * rebuilt — in-flight items may be absent, so {@link BatchResult.started},
   * {@link BatchResult.startedCount} and {@link BatchResult.totalCount} can
   * differ from what the live run observed (and from a smaller result that fit
   * in a single checkpoint). Do not branch on the started set across replay;
   * the completed items and {@link BatchResult.completionReason} are the
   * stable, deterministic parts of the result.
   */
  started(): Array<BatchItem<TResult> & { status: BatchItemStatus.STARTED }>;
  /** Overall status of the batch (SUCCEEDED if no failures, FAILED otherwise) */
  status: BatchItemStatus.SUCCEEDED | BatchItemStatus.FAILED;
  /** Reason why the batch completed */
  completionReason: CompletionReason;
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
  /**
   * Number of started but not completed items.
   *
   * Not guaranteed to be stable across suspend/resume — see
   * {@link BatchResult.started}.
   */
  startedCount: number;
  /** Total number of items */
  totalCount: number;
}

/**
 * Outcome of a custom completion decision — whether completing the batch now
 * represents an overall success or failure.
 *
 * This is a decision-level outcome (about the whole batch), distinct from
 * {@link BatchItemStatus}, which describes an individual item.
 *
 * @public
 */
export enum CompletionOutcome {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
}

/**
 * Decision returned by {@link CompletionConfig.shouldComplete}.
 *
 * Return {@link continueBatch} to keep going, or {@link completeBatch} to stop
 * the batch now — declaring whether that completion represents overall success
 * or failure.
 *
 * @public
 */
export type CompletionDecision =
  | {
      /** Keep starting/awaiting items. */
      complete: false;
    }
  | {
      /** Complete the batch now, without starting/awaiting remaining items. */
      complete: true;
      /**
       * Whether this completion is an overall success or failure.
       *
       * {@link CompletionOutcome.FAILED} marks the whole batch as failed (its
       * {@link BatchResult.status} is `FAILED` and {@link BatchResult.throwIfError}
       * throws) even when no individual item failed — for example when a
       * required quorum can no longer be met. Defaults to
       * {@link CompletionOutcome.SUCCEEDED}.
       */
      outcome?: CompletionOutcome;
    };

/** Continue the batch. Convenience factory for {@link CompletionDecision}. @public */
export const continueBatch = (): CompletionDecision => ({ complete: false });

/**
 * Complete the batch now with the given outcome (default
 * {@link CompletionOutcome.SUCCEEDED}). Convenience factory for
 * {@link CompletionDecision}.
 * @public
 */
export const completeBatch = (
  outcome: CompletionOutcome = CompletionOutcome.SUCCEEDED,
): CompletionDecision => ({ complete: true, outcome });

/**
 * Threshold-based completion for map/parallel operations.
 *
 * @remarks
 * **Race Condition Behavior**: When multiple children complete simultaneously,
 * the parent operation may have more completed children than the specified threshold
 * by the time the completion check occurs. This is expected behavior due to the
 * asynchronous nature of concurrent execution.
 *
 * @public
 */
export interface ThresholdCompletionConfig {
  /** Minimum number of successful executions required */
  minSuccessful?: number;
  /** Maximum number of failures tolerated */
  toleratedFailureCount?: number;
  /** Maximum percentage of failures tolerated (0-100) */
  toleratedFailurePercentage?: number;
  /** Not allowed together with the threshold fields. */
  shouldComplete?: never;
}

/**
 * Custom completion for map/parallel operations, driven by a predicate.
 *
 * @public
 */
export interface CustomCompletionConfig {
  /**
   * Custom completion predicate evaluated as items finish.
   *
   * Return {@link continueBatch}() to keep going, or {@link completeBatch}(outcome)
   * to stop the batch now (stop starting and awaiting any remaining items). The
   * batch always completes once every item has finished, regardless of the
   * predicate.
   *
   * The predicate MUST be deterministic and depend only on the provided
   * {@link CompletionStatus}. It runs during live execution and its effect
   * (how many items ran) is what gets checkpointed, so replay stays
   * consistent. The same race-condition caveat as the threshold fields
   * applies: when several items finish at once the batch may end with slightly
   * more completed items than the predicate first observed.
   *
   * The per-item statuses in {@link CompletionStatus.items} are ordered by the
   * item's original index (definition order), so `items[0]` is always the
   * first item/branch, `items[1]` the second, and so on — even when items
   * finish out of order and even when they have no `name`. This makes
   * quorum/dependency-style rules expressible, e.g. "complete when branch 0
   * succeeds OR branches 1 and 2 both succeed".
   *
   * When the returned decision completes the batch, the resulting
   * {@link BatchResult.completionReason} is `CUSTOM_COMPLETION_SUCCEEDED` or
   * `CUSTOM_COMPLETION_FAILED` depending on the decision's `outcome`.
   */
  shouldComplete: (status: CompletionStatus) => CompletionDecision;
  /** Not allowed together with a custom predicate. */
  minSuccessful?: never;
  /** Not allowed together with a custom predicate. */
  toleratedFailureCount?: never;
  /** Not allowed together with a custom predicate. */
  toleratedFailurePercentage?: never;
}

/**
 * Configuration for early completion of map/parallel operations.
 *
 * Either threshold-based ({@link ThresholdCompletionConfig}) or a custom
 * predicate ({@link CustomCompletionConfig}) — the two are mutually exclusive.
 * Specifying `shouldComplete` together with any of `minSuccessful`,
 * `toleratedFailureCount`, or `toleratedFailurePercentage` is a compile-time
 * error.
 *
 * @remarks
 * The mutual exclusivity is enforced only at the type level. There is no
 * runtime guard, so a plain-JavaScript caller (or TypeScript code that casts
 * around the union) that passes both is accepted: the handler checks
 * `shouldComplete` first in all three completion spots (`shouldContinue`,
 * `isComplete`, `getCompletionReason`), so the predicate wins and the threshold
 * fields (`minSuccessful`/`toleratedFailureCount`/`toleratedFailurePercentage`)
 * are silently ignored.
 *
 * @public
 */
export type CompletionConfig =
  | ThresholdCompletionConfig
  | CustomCompletionConfig;

/**
 * Snapshot of a single item/branch at the moment
 * {@link CompletionConfig.shouldComplete} is evaluated.
 *
 * @public
 */
export interface CompletionItemStatus {
  /** Index of the item/branch in the original array (definition order) */
  index: number;
  /** Optional custom name of the item/branch, when one was provided */
  name?: string;
  /**
   * Current status of the item/branch, or `undefined` if it has not started
   * yet (possible when `maxConcurrency` limits how many run at once).
   */
  status?: BatchItemStatus;
}

/**
 * Progress passed to {@link CompletionConfig.shouldComplete}.
 *
 * @public
 */
export interface CompletionStatus {
  /** Number of items that have completed successfully so far */
  successCount: number;
  /** Number of items that have failed so far */
  failureCount: number;
  /** Number of items that have completed so far (successCount + failureCount) */
  completedCount: number;
  /** Total number of items in the batch */
  totalCount: number;
  /**
   * Per-item/branch status snapshot, ordered by original index so that
   * `items[i]` is always the item/branch defined at position `i`.
   */
  items: readonly CompletionItemStatus[];
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
/**
 * Applied to each item of a batch, in that item's own child context.
 *
 * The body should perform at least one durable operation (`step`, `invoke`,
 * `wait`, a nested context, ...). A mapper that only computes buys nothing from
 * the surrounding context — the work is not checkpointed, so it re-runs on every
 * replay — and leaves the item with no record of its own. Put the computation in
 * a `step` instead. See `DurableContext.runInChildContext`.
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
  /**
   * Function to generate a summary string from the batch result.
   *
   * The summary is used as the checkpointed payload when the serialized batch
   * result exceeds the checkpoint size limit (ReplayChildren mode). When
   * omitted, a default map summary generator is used.
   */
  summaryGenerator?: (result: BatchResult<TResult>) => string;
  /**
   * Nesting type for map iterations (default: NestingType.NESTED)
   * - NESTED: Create full child contexts with checkpointing
   * - FLAT: Use virtual contexts to skip checkpointing and reduce costs by ~30%
   */
  nesting?: NestingType;
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
  /**
   * Function to generate a summary string from the batch result.
   *
   * The summary is used as the checkpointed payload when the serialized batch
   * result exceeds the checkpoint size limit (ReplayChildren mode). When
   * omitted, a default parallel summary generator is used.
   */
  summaryGenerator?: (result: BatchResult<TResult>) => string;
  /**
   * Nesting type for parallel branches (default: NestingType.NESTED)
   * - NESTED: Create full child contexts with checkpointing
   * - FLAT: Use virtual contexts to skip checkpointing and reduce costs by ~30%
   */
  nesting?: NestingType;
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
  /**
   * Nesting type for concurrent execution contexts (default: NestingType.NESTED)
   *
   * Controls how child contexts are created for each concurrent execution, affecting
   * observability, cost, and scale limits.
   *
   * - **NESTED**: Create CONTEXT operations with full observability but higher cost
   * - **FLAT**: Use virtual contexts for ~30% cost reduction and higher scale
   */
  nesting?: NestingType;
}
