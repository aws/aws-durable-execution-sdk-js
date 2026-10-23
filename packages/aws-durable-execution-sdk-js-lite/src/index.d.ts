// Public types for @aws/durable-execution-sdk-js-lite. Keep in sync with src/*.js.

/** The wire error format. Stack traces are not sent. */
export interface ErrorObject {
  ErrorType?: string;
  ErrorMessage?: string;
  ErrorData?: string;
}

/** Every failed durable operation throws this error, on the first run and on replay. */
export class DurableOperationError extends Error {
  constructor(opts?: {
    errorType?: string;
    message?: string;
    data?: string;
    cause?: unknown;
  });
  readonly name: "DurableOperationError";
  /** The original error's name, or a fixed SDK value such as "CallbackTimeoutError". */
  errorType?: string;
  data?: string;
  cause?: unknown;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RetryDecision {
  shouldRetry: boolean;
  /** Whole seconds, at least 1. Defaults to 1. */
  delaySeconds?: number;
}

/** attempt is 1-based: the number of the attempt that just failed. */
export type RetryStrategy = (args: {
  error: unknown;
  attempt: number;
}) => RetryDecision;

export interface RetryStrategyConfig {
  /** Default 6. */
  maxAttempts?: number;
  /** Default 5. */
  initialDelaySeconds?: number;
  /** Default 60. */
  maxDelaySeconds?: number;
  /** Default 2. */
  backoffRate?: number;
  /** Full jitter. Default true. */
  jitter?: boolean;
  /** Default: retry every error. */
  shouldRetry?: (args: { error: unknown }) => boolean;
}

export function createRetryStrategy(
  config?: RetryStrategyConfig,
): RetryStrategy;

/** What a serdes function receives besides the value. */
export interface SerdesContext {
  /** The operation's raw id, for example "2" or "3-1". Unique in one execution. */
  entityId: string;
  /** The execution's ARN. Use it with entityId to build a unique storage key. */
  durableExecutionArn: string;
}

/**
 * Turns a value into the string that the SDK checkpoints, and back. Both functions can
 * be async. deserialize(serialize(v)) must return a value equivalent to v. Neither
 * function may call durable operations. A throw throws from the Lambda handler, so
 * Lambda invokes again.
 */
export interface Serdes<T> {
  /** Returns the string to checkpoint, or undefined for no payload. */
  serialize(
    args: { value: T } & SerdesContext,
  ): string | undefined | Promise<string | undefined>;
  /** data is undefined when the checkpoint has no payload. */
  deserialize(
    args: { data: string | undefined } & SerdesContext,
  ): T | Promise<T>;
}

export type StepSemantics =
  | "AT_LEAST_ONCE_PER_RETRY"
  | "AT_MOST_ONCE_PER_RETRY";

export interface StepOptions<T> {
  name?: string;
  fn: (args: { logger: Logger; attempt: number }) => T | Promise<T>;
  /** Default: createRetryStrategy(). */
  retryStrategy?: RetryStrategy;
  /** Default "AT_LEAST_ONCE_PER_RETRY". */
  semantics?: StepSemantics;
  /**
   * Replaces the default SubType "Step" on the wire. An empty string selects the
   * default. The service accepts 1 to 32 characters of letters, digits, "-" and "_".
   * Replay compares it, so changing it fails running executions like a rename.
   */
  subType?: string;
  /** Default: JSON. The first run returns fn's value; only a replay calls deserialize. */
  serdes?: Serdes<T>;
}

export interface WaitOptions {
  name?: string;
  /** Whole seconds. The service ends the wait. */
  seconds: number;
}

export interface CreateCallbackOptions<T = string | undefined> {
  name?: string;
  /** The callback times out after this many seconds. Default: no timeout. */
  timeoutSeconds?: number;
  /** The callback times out if no heartbeat arrives for this many seconds. */
  heartbeatTimeoutSeconds?: number;
  /**
   * Replaces the default SubType "Callback" on the wire. An empty string selects the
   * default. The service accepts 1 to 32 characters of letters, digits, "-" and "_".
   * Replay compares it, so changing it fails running executions like a rename.
   */
  subType?: string;
  /** Reads the raw result string. Default: the raw string itself. */
  serdes?: Pick<Serdes<T>, "deserialize">;
}

export interface Callback<T = string | undefined> {
  /** Give this id to the outside system that completes the callback. */
  callbackId: string;
  /**
   * The raw result string the sender sent, not JSON-parsed, or serdes.deserialize of
   * it. Rejects with a DurableOperationError when the callback fails or times out
   * (errorType "CallbackTimeoutError").
   */
  result: Promise<T>;
}

export interface InvokeOptions<I, O = unknown> {
  name?: string;
  /** The durable function to invoke: a qualified function ARN or alias. */
  functionName: string;
  /** Sent as JSON. Omitted when undefined. */
  input?: I;
  tenantId?: string;
  /** Makes the Payload from input. The invoked function receives it as its event. */
  payloadSerdes?: Pick<Serdes<I | undefined>, "serialize">;
  /** Reads the invoked function's result. Default: JSON.parse. */
  resultSerdes?: Pick<Serdes<O>, "deserialize">;
}

export interface RunInChildContextOptions<T> {
  name?: string;
  /** Use the child ctx inside fn, not the parent ctx. */
  fn: (args: { ctx: DurableContext }) => T | Promise<T>;
  /**
   * Replaces the default SubType "RunInChildContext" on the wire. An empty string
   * selects the default. The service accepts 1 to 32 characters of letters, digits, "-" and "_".
   * Replay compares it, so changing it fails running executions like a rename.
   */
  subType?: string;
  /**
   * Default: JSON. The 256 KiB limit applies to the serialized string. The first run
   * returns fn's value; only a replay calls deserialize.
   */
  serdes?: Serdes<T>;
}

export interface WaitForCallbackOptions<T = string | undefined> {
  name?: string;
  /** Sends callbackId to the outside system. Runs in a step, so it is retried. */
  submitter: (args: {
    callbackId: string;
    logger: Logger;
  }) => void | Promise<void>;
  /** The callback times out after this many seconds. Default: no timeout. */
  timeoutSeconds?: number;
  /** The callback times out if no heartbeat arrives for this many seconds. */
  heartbeatTimeoutSeconds?: number;
  /** Retries of the submitter step. Default: createRetryStrategy(). */
  retryStrategy?: RetryStrategy;
  /** Reads the raw result string. Default: the raw string itself. */
  serdes?: Pick<Serdes<T>, "deserialize">;
}

export interface WaitForConditionDecision {
  shouldContinue: boolean;
  /** Whole seconds until the next check, at least 1. Defaults to 1. */
  delaySeconds?: number;
}

export interface WaitForConditionOptions<S> {
  name?: string;
  /** One check. Returns the new state. A throw fails the operation without retry. */
  fn: (args: { state: S; attempt: number; logger: Logger }) => S | Promise<S>;
  /** The state for the first check. Stored as JSON. */
  initialState: S;
  /** attempt is 1-based: the number of the check that just ran. */
  waitStrategy: (args: {
    state: S;
    attempt: number;
  }) => WaitForConditionDecision;
  /** Default: JSON. Saves each state and reads saved states back. */
  serdes?: Serdes<S>;
}

export interface MapOptions<I, O> {
  name?: string;
  items: readonly I[];
  /** Use the item ctx inside fn, not the parent ctx. */
  fn: (args: { ctx: DurableContext; item: I; index: number }) => O | Promise<O>;
  /** At most this many items run at once. Default: no limit. */
  maxConcurrency?: number;
  /** The Name of each item's child context. Default: no Name. */
  itemName?: (args: { item: I; index: number }) => string;
  /** When the map completes early. Default: at the first failed item. */
  completionConfig?: CompletionConfig;
  /**
   * The serdes of each item's result. Default: JSON. With itemSerdes, the map saves
   * only a summary, and a replay reads each item's own record.
   */
  itemSerdes?: Serdes<O>;
}

export interface ParallelBranch<T> {
  name?: string;
  /** Use the branch ctx inside fn, not the parent ctx. */
  fn: (args: { ctx: DurableContext }) => T | Promise<T>;
}

export interface ParallelOptions<T> {
  name?: string;
  branches: readonly ParallelBranch<T>[];
  /** At most this many branches run at once. Default: no limit. */
  maxConcurrency?: number;
  /** When the parallel completes early. Default: at the first failed branch. */
  completionConfig?: CompletionConfig;
  /** The serdes of each branch's result, as in MapOptions.itemSerdes. */
  itemSerdes?: Serdes<T>;
}

/**
 * The batch checks these after each item settles. It completes when every item settled,
 * when minSuccessful items succeeded, or when the failures exceed a tolerance. Then no
 * new item starts, and the items that still run are abandoned. With no threshold set
 * (no config, or `{}`), one failure exceeds the tolerance.
 */
export interface ThresholdCompletionConfig {
  /** Complete when this many items succeeded. */
  minSuccessful?: number;
  /** Complete when more than this many items failed. */
  toleratedFailureCount?: number;
  /** Complete when failures / all items * 100 is more than this. */
  toleratedFailurePercentage?: number;
  /** Not allowed together with the threshold keys. */
  shouldComplete?: never;
}

/**
 * The batch asks shouldComplete before it starts each item and after each item
 * settles. When it returns `complete: true`, no new item starts, and the items that
 * still run are abandoned. The batch also completes when every item settled.
 * The predicate must be deterministic and fast, and must not call durable operations.
 * A replay does not call it.
 */
export interface CustomCompletionConfig {
  shouldComplete: (status: CompletionStatus) => CompletionDecision;
  /** Not allowed together with shouldComplete. */
  minSuccessful?: never;
  /** Not allowed together with shouldComplete. */
  toleratedFailureCount?: never;
  /** Not allowed together with shouldComplete. */
  toleratedFailurePercentage?: never;
}

/** Thresholds or a predicate, not both. */
export type CompletionConfig =
  | ThresholdCompletionConfig
  | CustomCompletionConfig;

/** One item, when shouldComplete is called. */
export interface CompletionItemStatus {
  /** The item's position in items or branches. */
  index: number;
  /** The item's name: itemName's result, or the branch name. */
  name?: string;
  /** Absent when the item has not started. */
  status?: BatchItem<unknown>["status"];
}

/** The input of shouldComplete. */
export interface CompletionStatus {
  successCount: number;
  failureCount: number;
  /** successCount + failureCount. */
  completedCount: number;
  /** The number of items or branches. */
  totalCount: number;
  /** One entry per item, in index order. A new array on every call. */
  items: readonly CompletionItemStatus[];
}

/**
 * The output of shouldComplete. `outcome` defaults to "SUCCEEDED". A "FAILED" outcome
 * sets completionReason to "CUSTOM_COMPLETION_FAILED", and throwIfError then throws.
 */
export type CompletionDecision =
  | { complete: false }
  | { complete: true; outcome?: "SUCCEEDED" | "FAILED" };

export type CompletionReason =
  | "ALL_COMPLETED"
  | "MIN_SUCCESSFUL_REACHED"
  | "FAILURE_TOLERANCE_EXCEEDED"
  | "CUSTOM_COMPLETION_SUCCEEDED"
  | "CUSTOM_COMPLETION_FAILED";

export interface BatchItem<T> {
  index: number;
  /** STARTED: the item still ran when the batch completed early. */
  status: "SUCCEEDED" | "FAILED" | "STARTED";
  /** Set when status is SUCCEEDED. */
  result?: T;
  /** Set when status is FAILED. */
  error?: DurableOperationError;
}

export interface BatchResult<T> {
  /** The items that started, in index order. Items that never started are absent. */
  all: BatchItem<T>[];
  completionReason: CompletionReason;
  /** The results of the items that succeeded, in index order. */
  getResults(): T[];
  /** The errors of the items that failed, in index order. */
  getErrors(): DurableOperationError[];
  /**
   * Throws the first failed item's error, if any. Else, if completionReason is
   * "CUSTOM_COMPLETION_FAILED", throws a DurableOperationError with errorType
   * "BatchCompletionError".
   */
  throwIfError(): void;
}

export interface DurableContext {
  /** True while this context replays operations that an earlier invocation completed. */
  readonly replaying: boolean;
  /** Writes to console. Silent while replaying. */
  readonly logger: Logger;
  step<T>(opts: StepOptions<T>): Promise<T>;
  wait(opts: WaitOptions): Promise<void>;
  createCallback<T = string | undefined>(
    opts?: CreateCallbackOptions<T>,
  ): Promise<Callback<T>>;
  /** Returns the invoked function's JSON result. Its errors keep their errorType. */
  invoke<O = unknown, I = unknown>(opts: InvokeOptions<I, O>): Promise<O>;
  /** Groups operations. A completed child context returns its result without running fn. */
  runInChildContext<T>(opts: RunInChildContextOptions<T>): Promise<T>;
  /**
   * Creates a callback, runs the submitter, and resolves to the raw result string, or
   * to serdes.deserialize of it. Errors keep their errorType, for example
   * "CallbackTimeoutError".
   */
  waitForCallback<T = string | undefined>(
    opts: WaitForCallbackOptions<T>,
  ): Promise<T>;
  /** Runs fn, then waits, until waitStrategy stops. Resolves to the last state. */
  waitForCondition<S>(opts: WaitForConditionOptions<S>): Promise<S>;
  /** Runs fn for every item in its own child context. A failed item does not stop the others. */
  map<I, O>(opts: MapOptions<I, O>): Promise<BatchResult<O>>;
  /** Runs every branch in its own child context. A failed branch does not stop the others. */
  parallel<T>(opts: ParallelOptions<T>): Promise<BatchResult<T>>;
}

/**
 * A client for the two durable execution APIs. Field names follow the Lambda API.
 *
 * A failed call must throw an error with these fields. The SDK reads them to decide what
 * happens next:
 * - `name`: the AWS error code, for example "InvalidParameterValueException".
 * - `status`: the HTTP status as a number, for example 400.
 * - `message`: the error message.
 *
 * Without `status`, the SDK treats every error as retryable. Lambda then invokes again and
 * again until the execution times out. An AWS SDK v3 client puts the status in
 * `$metadata.httpStatusCode`, so copy it to `status`.
 */
export interface DurableExecutionClient {
  checkpoint(request: {
    DurableExecutionArn: string;
    CheckpointToken: string;
    Updates: object[];
    ClientToken?: string;
  }): Promise<{
    CheckpointToken?: string;
    NewExecutionState?: { Operations?: object[]; NextMarker?: string };
  }>;
  getExecutionState(request: {
    DurableExecutionArn: string;
    CheckpointToken: string;
    Marker?: string;
    MaxItems?: number;
  }): Promise<{ Operations?: object[]; NextMarker?: string }>;
}

export type DurableHandler<E = unknown, R = unknown> = (args: {
  event: E;
  ctx: DurableContext;
  lambdaContext: unknown;
}) => R | Promise<R>;

export interface DurableExecutionOutput {
  Status: "SUCCEEDED" | "FAILED" | "PENDING";
  Result?: string;
  Error?: ErrorObject;
}

export function withDurableExecution<E = unknown, R = unknown>(
  handler: DurableHandler<E, R>,
  config?: { client?: DurableExecutionClient },
): (event: unknown, lambdaContext?: unknown) => Promise<DurableExecutionOutput>;
