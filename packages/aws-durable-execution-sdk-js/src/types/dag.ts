import { CompletionReason, Duration } from "./core";
import {
  BatchResult,
  ThresholdCompletionConfig,
  CompletionDecision,
  MapConfig,
  MapFunc,
  ParallelConfig,
  ParallelFunc,
  NamedParallelBranch,
  NestingType,
} from "./batch";
import { DurableContext } from "./durable-context";
import { DurableLogger } from "./durable-logger";
import { DurablePromise } from "./durable-promise";
import {
  StepContext,
  WaitForConditionContext,
  WaitForCallbackContext,
} from "./logger";
import { StepConfig, RetryDecision } from "./step";
import { InvokeConfig } from "./invoke";
import { ChildConfig } from "./child-context";
import { WaitForCallbackConfig } from "./callback";
import { WaitForConditionConfig } from "./wait-condition";
import { Serdes } from "../utils/serdes/serdes";
import { DurableOperationError } from "../errors/durable-error/durable-error";

/**
 * A registration-time reference to a DAG task, returned by every
 * {@link DagContext} method. Doubles as a builder for ordering-only
 * dependencies and the task's trigger rule.
 *
 * A `TaskHandle` is never serialized — its `_id` is an in-memory `symbol` that
 * exists only during registration and scheduling. The deserialized
 * {@link DagResult} resolves results by `name`.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface TaskHandle<TName extends string = string, TResult = unknown> {
  /**
   * The task's unique name within its DAG scope — the customer-facing result
   * key used by {@link DagResult.getResult}, {@link DagResult.getStatus}, and
   * {@link DepsMap}.
   */
  readonly name: TName;
  /**
   * In-memory identity; never serialized.
   * @internal
   */
  readonly _id: symbol;
  /**
   * Phantom field carrying `TResult` for {@link DepsMap}; never populated at runtime.
   * @internal
   */
  readonly _resultType?: TResult;

  /**
   * Add ordering-only dependencies: this task waits for them but does not
   * receive their results in its {@link DepsMap}.
   */
  after(...deps: readonly AnyTaskHandle[]): this;

  /**
   * Set the task's trigger rule (default from {@link DagConfig.defaultTriggerRule},
   * else `"ALL_SUCCESS"`).
   */
  triggerRule(rule: TriggerRule): this;
}

/**
 * A {@link TaskHandle} of any name/result type — used for dependency arrays.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type AnyTaskHandle = TaskHandle<string, unknown>;

/**
 * Maps an array of {@link TaskHandle}s to an object keyed by task name whose
 * values are the tasks' declared result types. Empty deps resolve to `{}`.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type DepsMap<TDeps extends readonly AnyTaskHandle[]> = {
  [K in TDeps[number] as K["name"]]: K extends TaskHandle<string, infer R>
    ? R
    : never;
};

/**
 * Step task function. Collapses to the native `(ctx)` shape when there are no
 * deps; otherwise deps are the first argument.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type StepTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TResult,
  TLogger extends DurableLogger = DurableLogger,
> = TDeps extends readonly []
  ? (ctx: StepContext<TLogger>) => Promise<TResult>
  : (deps: DepsMap<TDeps>, ctx: StepContext<TLogger>) => Promise<TResult>;

/**
 * Invoke payload function. Returns the payload to send to the target function.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type PayloadTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TIn,
> = TDeps extends readonly []
  ? () => TIn | Promise<TIn>
  : (deps: DepsMap<TDeps>) => TIn | Promise<TIn>;

/**
 * Callback submitter task function. Preserves the native `(callbackId, ctx)`
 * arguments, with deps prepended when non-empty.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type SubmitterTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TLogger extends DurableLogger = DurableLogger,
> = TDeps extends readonly []
  ? (callbackId: string, ctx: WaitForCallbackContext<TLogger>) => Promise<void>
  : (
      deps: DepsMap<TDeps>,
      callbackId: string,
      ctx: WaitForCallbackContext<TLogger>,
    ) => Promise<void>;

/**
 * waitForCondition check task function. Preserves the native `(state, ctx)`
 * arguments, with deps prepended when non-empty.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type CheckTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TState,
  TLogger extends DurableLogger = DurableLogger,
> = TDeps extends readonly []
  ? (state: TState, ctx: WaitForConditionContext<TLogger>) => Promise<TState>
  : (
      deps: DepsMap<TDeps>,
      state: TState,
      ctx: WaitForConditionContext<TLogger>,
    ) => Promise<TState>;

/**
 * runInChildContext task function. Preserves the native `(ctx)` argument, with
 * deps prepended when non-empty.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type ChildTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TResult,
  TLogger extends DurableLogger = DurableLogger,
> = TDeps extends readonly []
  ? (ctx: DurableContext<TLogger>) => Promise<TResult>
  : (deps: DepsMap<TDeps>, ctx: DurableContext<TLogger>) => Promise<TResult>;

/**
 * Per-task conditional configuration.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface ConditionalConfig<TDeps extends readonly AnyTaskHandle[]> {
  /**
   * Synchronous, deterministic predicate over resolved upstream results.
   * Returning `false` skips the task with skipReason `"RUN_IF_PREDICATE"`.
   */
  runIf?: (deps: DepsMap<TDeps>) => boolean;
}

/**
 * Trigger rule controlling whether a task runs based on the terminal statuses
 * of its upstream dependencies.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type TriggerRule =
  | "ALL_SUCCESS"
  | "ALL_FAILED"
  | "ALL_DONE"
  | "ANY_SUCCESS"
  | "ANY_FAILED"
  | "NONE_FAILED";

/**
 * Terminal (or in-flight) status of a DAG task.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type TaskStatus = "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";

/**
 * Reason a task was skipped.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type SkipReason = "TRIGGER_RULE" | "RUN_IF_PREDICATE";

/**
 * The recorded execution of a single DAG task.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface TaskExecution<TResult = unknown> {
  name: string;
  status: TaskStatus;
  /** Present only when `status === "SKIPPED"`. */
  skipReason?: SkipReason;
  /** Present only when `status === "SUCCEEDED"`. */
  result?: TResult;
  /** Present only when `status === "FAILED"`. */
  error?: DurableOperationError;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Completion reason for a DAG. A superset of the shared core
 * {@link CompletionReason}, adding `"COMPLETED_WITH_FAILURES"` so a default
 * drain that encountered failures is distinguishable from a clean run.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES";

/**
 * Aggregated result of a `context.dag(...)` execution.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagResult {
  /** Returns a task's result by handle (typed) or by name. */
  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;
  /** Returns a task's status, or `undefined` if the task never started. */
  getStatus(taskNameOrHandle: string | AnyTaskHandle): TaskStatus | undefined;

  /** Tasks that succeeded. */
  succeeded(): TaskExecution[];
  /** Tasks that failed. */
  failed(): TaskExecution[];
  /** Tasks that were skipped. */
  skipped(): TaskExecution[];

  /** All recorded task executions, keyed by task name. */
  readonly results: ReadonlyMap<string, TaskExecution>;

  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;

  readonly completionReason: DagCompletionReason;

  /** Throws {@link DagExecutionError} if any task failed (or a failed custom completion). */
  throwIfError(): void;
}

/**
 * Per-task snapshot passed to a DAG custom completion predicate.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagCompletionItemStatus<TResult = unknown> {
  name: string;
  /** Full task status including `"SKIPPED"`; `undefined` if not yet started. */
  status?: TaskStatus;
  /** Present only when `status === "SUCCEEDED"`. */
  result?: TResult;
  /** Present only when `status === "SKIPPED"`. */
  skipReason?: SkipReason;
}

/**
 * Progress snapshot passed to a DAG custom completion predicate.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagCompletionStatus {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  /** successCount + failureCount + skippedCount (all terminal states). */
  completedCount: number;
  totalCount: number;
  /** Per-task snapshot, ordered by registration order. */
  items: readonly DagCompletionItemStatus[];
  /** Live view of terminal task snapshots by name. */
  results: ReadonlyMap<string, DagCompletionItemStatus>;
}

/**
 * DAG custom-predicate completion config.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagCustomCompletionConfig {
  /** Deterministic predicate over DAG progress + task results. */
  shouldComplete: (status: DagCompletionStatus) => CompletionDecision;
  minSuccessful?: never;
  toleratedFailureCount?: never;
  toleratedFailurePercentage?: never;
}

/**
 * Early-completion config for a DAG — threshold-based (reused from batch,
 * unchanged) or a DAG-specific custom predicate.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type DagCompletionConfig =
  | ThresholdCompletionConfig
  | DagCustomCompletionConfig;

/**
 * Configuration for a `context.dag(...)` operation.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagConfig {
  /** Maximum number of concurrent top-level tasks (default: unlimited). */
  maxConcurrency?: number;
  /** DAG-specific early-completion config (NOT the batch `CompletionConfig`). */
  completionConfig?: DagCompletionConfig;
  /** Retry strategy applied to tasks that do not declare their own. */
  defaultRetryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Default trigger rule for tasks (default `"ALL_SUCCESS"`). */
  defaultTriggerRule?: TriggerRule;
  /** Serdes for the aggregated {@link DagResult} container payload. */
  serdes?: Serdes<DagResult>;
  /**
   * Observability-only text generator for the large-payload fallback. Its
   * output is stored verbatim under `DagSummary.summary` and is NEVER read on
   * replay. It cannot override the SDK-owned count/reason/started fields.
   */
  summaryGenerator?: (result: DagResult) => string;
  /** Nesting type for task child contexts. */
  nesting?: NestingType;
}

/**
 * Configuration for a nested `dag` task. Currently identical to
 * {@link DagConfig}; kept distinct for future divergence.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type NestedDagConfig = DagConfig;

/**
 * Declarative task-registration context passed to the `register` callback of
 * `context.dag(...)`. Each method registers exactly one task and returns a
 * {@link TaskHandle}.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagContext<TLogger extends DurableLogger = DurableLogger> {
  step<TName extends string, TDeps extends readonly AnyTaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepTaskFn<TDeps, TResult, TLogger>,
    config?: StepConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  invoke<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TIn,
    TOut,
  >(
    name: TName,
    funcId: string,
    deps: TDeps,
    payloadFn: PayloadTaskFn<TDeps, TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TOut>;

  callback<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult = string,
  >(
    name: TName,
    deps: TDeps,
    submitter: SubmitterTaskFn<TDeps, TLogger>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  wait<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    duration: Duration,
    config?: ConditionalConfig<TDeps>,
  ): TaskHandle<TName, void>;

  waitForCondition<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TState,
  >(
    name: TName,
    deps: TDeps,
    check: CheckTaskFn<TDeps, TState, TLogger>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TState>;

  runInChildContext<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult,
  >(
    name: TName,
    deps: TDeps,
    fn: ChildTaskFn<TDeps, TResult, TLogger>,
    config?: ChildConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  map<TName extends string, TDeps extends readonly AnyTaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TDeps extends readonly AnyTaskHandle[], TOut>(
    name: TName,
    deps: TDeps,
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  dag<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    register: (subDagCtx: DagContext<TLogger>) => void | Promise<void>,
    config?: NestedDagConfig & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, DagResult>;
}

/**
 * SDK-owned compact envelope checkpointed for a DAG whose serialized result
 * exceeds the checkpoint size limit. The customer `summaryGenerator` output is
 * quarantined under `summary` and is never read on replay.
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface DagSummary {
  type: "DagResult";
  totalCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  completedCount: number;
  completionReason: DagCompletionReason;
  /** Task names STARTED-but-not-terminal at an early completion. */
  startedTaskNames: string[];
  /** Terminal task names (SUCCEEDED/FAILED/SKIPPED), for diagnostics. */
  terminalTaskNames: string[];
  /** Observability-only text from the customer generator; never read on replay. */
  summary?: string;
}

/**
 * Entry-point signature added to {@link DurableContext} for declaring a DAG.
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type DagFn<TLogger extends DurableLogger = DurableLogger> = (
  name: string,
  register: (dagCtx: DagContext<TLogger>) => void | Promise<void>,
  config?: DagConfig,
) => DurablePromise<DagResult>;
