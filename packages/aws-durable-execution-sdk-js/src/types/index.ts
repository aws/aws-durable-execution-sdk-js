import { Context } from "aws-lambda";
import { TerminationManager } from "../termination-manager/termination-manager";
import { ExecutionState } from "../storage/storage-provider";
import { Serdes } from "../utils/serdes/serdes";

import { ErrorObject, Operation } from "@aws-sdk/client-lambda";

// Define BatchItemStatus enum
export enum BatchItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  STARTED = "STARTED",
}

// Import types for concurrent execution
import type {
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
} from "../handlers/concurrent-execution-handler/concurrent-execution-handler";

// Import BatchResult types
import type { BatchResult } from "../handlers/concurrent-execution-handler/batch-result";

export interface LambdaHandler<T> {
  (event: T, context: Context): Promise<DurableExecutionInvocationOutput>;
}

// TODO - prefer to import this entire input model from the SDK,
// but it's not part of the frontend model so it doesn't get generated.
export interface DurableExecutionInvocationInput {
  DurableExecutionArn: string;
  CheckpointToken: string;
  InitialExecutionState: {
    Operations: Operation[];
    NextMarker: string;
  };
  LoggingMode?: string;

  /**
   * Flag to indicate if this execution is running against local runner.
   */
  LocalRunner?: boolean;
}

export enum InvocationStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  PENDING = "PENDING",
}

export enum OperationSubType {
  STEP = "Step",
  WAIT = "Wait",
  CALLBACK = "Callback",
  RUN_IN_CHILD_CONTEXT = "RunInChildContext",
  MAP = "Map",
  MAP_ITERATION = "MapIteration",
  PARALLEL = "Parallel",
  PARALLEL_BRANCH = "ParallelBranch",
  WAIT_FOR_CALLBACK = "WaitForCallback",
  WAIT_FOR_CONDITION = "WaitForCondition",
  INVOKE = "Invoke",
}

interface DurableExecutionInvocationOutputFailed {
  Status: InvocationStatus.FAILED;
  Error: ErrorObject;
}

interface DurableExecutionInvocationOutputSucceeded {
  Status: InvocationStatus.SUCCEEDED;
  Result?: string;
}

interface DurableExecutionInvocationOutputPending {
  Status: InvocationStatus.PENDING;
}

export type DurableExecutionInvocationOutput =
  | DurableExecutionInvocationOutputSucceeded
  | DurableExecutionInvocationOutputFailed
  | DurableExecutionInvocationOutputPending;

export interface DurableContext extends Context {
  _stepPrefix?: string;
  _stepCounter: number;
  /**
   * Executes a function as a durable step with automatic retry and state persistence
   * @param name - Step name for tracking and debugging
   * @param fn - Function to execute as a durable step
   * @param config - Optional configuration for retry strategy, semantics, and serialization
   * @example
   * ```typescript
   * const result = await context.step(
   *   "fetch-user-data",
   *   async (ctx) => {
   *     return await fetchUserFromAPI(userId);
   *   },
   *   { retryStrategy: exponentialBackoff }
   * );
   * ```
   */
  step<T>(
    name: string | undefined,
    fn: StepFunc<T>,
    config?: StepConfig<T>,
  ): Promise<T>;

  /**
   * Executes a function as a durable step with automatic retry and state persistence
   * @param fn - Function to execute as a durable step
   * @param config - Optional configuration for retry strategy, semantics, and serialization
   * @example
   * ```typescript
   * const result = await context.step(
   *   async (ctx) => {
   *     return await fetchUserFromAPI(userId);
   *   }
   * );
   * ```
   */
  step<T>(fn: StepFunc<T>, config?: StepConfig<T>): Promise<T>;

  /**
   * Invokes another durable function with the specified input
   * @param name - Step name for tracking and debugging
   * @param funcId - Function ID or ARN of the durable function to invoke
   * @param input - Input data to pass to the invoked function
   * @param config - Optional configuration for serialization and timeout
   * @example
   * ```typescript
   * const result = await context.invoke(
   *   "process-payment",
   *   "arn:aws:lambda:us-east-1:123456789012:function:payment-processor",
   *   { amount: 100, currency: "USD" },
   *   { timeoutSeconds: 300 }
   * );
   * ```
   */
  invoke<I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;

  /**
   * Invokes another durable function with the specified input
   * @param funcId - Function ID or ARN of the durable function to invoke
   * @param input - Input data to pass to the invoked function
   * @param config - Optional configuration for serialization and timeout
   * @example
   * ```typescript
   * const result = await context.invoke(
   *   "payment-processor-function",
   *   { amount: 100, currency: "USD" }
   * );
   * ```
   */
  invoke<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;

  /**
   * Runs a function in a child context with isolated state and execution tracking
   * @param name - Step name for tracking and debugging
   * @param fn - Function to execute in the child context
   * @param config - Optional configuration for serialization and sub-typing
   * @example
   * ```typescript
   * const result = await context.runInChildContext(
   *   "process-batch",
   *   async (childCtx) => {
   *     // Child context has its own step counter and state
   *     const step1 = await childCtx.step("validate", async () => validate(data));
   *     const step2 = await childCtx.step("transform", async () => transform(step1));
   *     return step2;
   *   },
   *   { subType: "batch-processor" }
   * );
   * ```
   */
  runInChildContext<T>(
    name: string | undefined,
    fn: ChildFunc<T>,
    config?: ChildConfig<T>,
  ): Promise<T>;

  /**
   * Runs a function in a child context with isolated state and execution tracking
   * @param fn - Function to execute in the child context
   * @param config - Optional configuration for serialization and sub-typing
   * @example
   * ```typescript
   * const result = await context.runInChildContext(
   *   async (childCtx) => {
   *     return await childCtx.step(async () => processData(input));
   *   }
   * );
   * ```
   */
  runInChildContext<T>(fn: ChildFunc<T>, config?: ChildConfig<T>): Promise<T>;

  wait: {
    /**
     * Pauses execution for the specified duration
     * @param name - Step name for tracking and debugging
     * @param millis - Duration to wait in milliseconds
     * @example
     * ```typescript
     * // Wait 5 seconds before retrying
     * await context.wait("retry-delay", 5000);
     * ```
     */
    (name: string, millis: number): Promise<void>;

    /**
     * Pauses execution for the specified duration
     * @param millis - Duration to wait in milliseconds
     * @example
     * ```typescript
     * // Wait 30 seconds for rate limiting
     * await context.wait(30000);
     * ```
     */
    (millis: number): Promise<void>;
  };

  /**
   * Waits for a condition to be met by periodically checking state
   * @param name - Step name for tracking and debugging
   * @param checkFunc - Function that checks the current state and returns updated state
   * @param config - Configuration for initial state, wait strategy, and serialization
   * @example
   * ```typescript
   * const finalState = await context.waitForCondition(
   *   "wait-for-job-completion",
   *   async (currentState, ctx) => {
   *     const jobStatus = await checkJobStatus(currentState.jobId);
   *     return { ...currentState, status: jobStatus };
   *   },
   *   {
   *     initialState: { jobId: "job-123", status: "pending" },
   *     waitStrategy: (state, attempt) => {
   *       if (state.status === "completed") {
   *         return { shouldContinue: false };
   *       }
   *       return { shouldContinue: true, delaySeconds: Math.min(attempt * 2, 60) };
   *     }
   *   }
   * );
   * ```
   */
  waitForCondition<T>(
    name: string | undefined,
    checkFunc: WaitForConditionCheckFunc<T>,
    config: WaitForConditionConfig<T>,
  ): Promise<T>;

  /**
   * Waits for a condition to be met by periodically checking state
   * @param checkFunc - Function that checks the current state and returns updated state
   * @param config - Configuration for initial state, wait strategy, and serialization
   * @example
   * ```typescript
   * const result = await context.waitForCondition(
   *   async (state, ctx) => {
   *     const updated = await pollExternalAPI(state.requestId);
   *     return updated;
   *   },
   *   {
   *     initialState: { requestId: "req-456", ready: false },
   *     waitStrategy: (state, attempt) =>
   *       state.ready ? { shouldContinue: false } : { shouldContinue: true, delaySeconds: 10 }
   *   }
   * );
   * ```
   */
  waitForCondition<T>(
    checkFunc: WaitForConditionCheckFunc<T>,
    config: WaitForConditionConfig<T>,
  ): Promise<T>;

  /**
   * Creates a callback that external systems can complete
   * @param name - Step name for tracking and debugging
   * @param config - Optional configuration for timeout and serialization
   * @returns Tuple of [promise that resolves when callback is submitted, callback ID]
   * @example
   * ```typescript
   * const [callbackPromise, callbackId] = await context.createCallback(
   *   "external-approval",
   *   { timeout: 3600 } // 1 hour timeout
   * );
   *
   * // Send callback ID to external system
   * await sendApprovalRequest(callbackId, requestData);
   *
   * // Wait for external system to submit callback
   * const approvalResult = await callbackPromise;
   * ```
   */
  createCallback<T>(
    name: string | undefined,
    config?: CreateCallbackConfig,
  ): Promise<CreateCallbackResult<T>>;

  /**
   * Creates a callback that external systems can complete
   * @param config - Optional configuration for timeout and serialization
   * @returns Tuple of [promise that resolves when callback is submitted, callback ID]
   * @example
   * ```typescript
   * const [promise, callbackId] = await context.createCallback({
   *   timeout: 1800 // 30 minutes
   * });
   * await notifyExternalSystem(callbackId);
   * const result = await promise;
   * ```
   */
  createCallback<T>(
    config?: CreateCallbackConfig,
  ): Promise<CreateCallbackResult<T>>;
  /**
   * Wait for an external system to complete a callback with the SendDurableExecutionCallbackSuccess or SendDurableExecutionCallbackFailure APIs.
   * @param name - Step name for tracking and debugging
   * @param submitter - Function that receives the callback ID and submits the callback
   * @param config - Optional configuration for timeout and retry behavior
   * @example
   * ```typescript
   * const result = await context.waitForCallback(
   *   "wait-for-external-api",
   *   async (callbackId, ctx) => {
   *     // Submit callback ID to external system
   *     await submitToExternalAPI(callbackId);
   *   },
   *   { timeout: 300 }
   * );
   * ```
   */
  waitForCallback<T>(
    name: string | undefined,
    submitter: WaitForCallbackSubmitterFunc,
    config?: WaitForCallbackConfig,
  ): Promise<T>;

  /**
   * Wait for an external system to complete a callback with the SendDurableExecutionCallbackSuccess or SendDurableExecutionCallbackFailure APIs.
   * @param submitter - Function that receives the callback ID and submits the callback
   * @param config - Optional configuration for timeout and retry behavior
   * @example
   * ```typescript
   * const result = await context.waitForCallback(
   *   async (callbackId, ctx) => {
   *     await submitToExternalAPI(callbackId);
   *   }
   * );
   * ```
   */
  waitForCallback<T>(
    submitter: WaitForCallbackSubmitterFunc,
    config?: WaitForCallbackConfig,
  ): Promise<T>;
  /**
   * Maps over an array of items with a function, executing in parallel with optional concurrency control
   * @param name - Step name for tracking and debugging
   * @param items - Array of items to process
   * @param mapFunc - Function to apply to each item (context, item, index, array) => Promise<TOutput>
   * @param config - Optional configuration for concurrency, completion behavior, and item naming
   * @example
   * ```typescript
   * const results = await context.map(
   *   "process-users",
   *   users,
   *   async (ctx, user, index) => processUser(user),
   *   {
   *     maxConcurrency: 2,
   *     itemNamer: (user, index) => `User-${user.id || index}`
   *   }
   * );
   * ```
   */
  map<TInput, TOutput>(
    name: string | undefined,
    items: TInput[],
    mapFunc: MapFunc<TInput, TOutput>,
    config?: MapConfig<TInput>,
  ): Promise<BatchResult<TOutput>>;

  /**
   * Maps over an array of items with a function, executing in parallel with optional concurrency control
   * @param items - Array of items to process
   * @param mapFunc - Function to apply to each item (context, item, index, array) => Promise<TOutput>
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * const results = await context.map(
   *   [1, 2, 3],
   *   async (ctx, item, index) => item * 2
   * );
   * ```
   */
  map<TInput, TOutput>(
    items: TInput[],
    mapFunc: MapFunc<TInput, TOutput>,
    config?: MapConfig<TInput>,
  ): Promise<BatchResult<TOutput>>;
  /**
   * Executes multiple functions in parallel with optional concurrency control
   * @param name - Step name for tracking and debugging
   * @param branches - Array of functions or named branches to execute in parallel
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * const results = await context.parallel(
   *   "parallel-operations",
   *   [
   *     { name: "task1", func: async (ctx) => ctx.step(async () => "result1") },
   *     async (ctx) => ctx.step(async () => "task2")
   *   ],
   *   { maxConcurrency: 2 }
   * );
   * ```
   */
  parallel<T>(
    name: string | undefined,
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig,
  ): Promise<BatchResult<T>>;

  /**
   * Executes multiple functions in parallel with optional concurrency control
   * @param branches - Array of functions or named branches to execute in parallel
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * const results = await context.parallel(
   *   [
   *     async (ctx) => ctx.step(async () => "task1"),
   *     async (ctx) => ctx.step(async () => "task2")
   *   ]
   * );
   * ```
   */
  parallel<T>(
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig,
  ): Promise<BatchResult<T>>;
  promise: {
    /**
     * Waits for all promises to resolve and returns an array of all results
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to wait for
     * @example
     * ```typescript
     * const [user, posts, comments] = await context.promise.all(
     *   "fetch-user-data",
     *   [
     *     fetchUser(userId),
     *     fetchUserPosts(userId),
     *     fetchUserComments(userId)
     *   ]
     * );
     * ```
     */
    all<T>(name: string | undefined, promises: Promise<T>[]): Promise<T[]>;

    /**
     * Waits for all promises to resolve and returns an array of all results
     * @param promises - Array of promises to wait for
     * @example
     * ```typescript
     * const results = await context.promise.all([
     *   fetchUser(userId),
     *   fetchUserPosts(userId)
     * ]);
     * ```
     */
    all<T>(promises: Promise<T>[]): Promise<T[]>;

    /**
     * Waits for all promises to settle (resolve or reject) and returns results with status
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to wait for
     * @example
     * ```typescript
     * const results = await context.promise.allSettled(
     *   "fetch-all-data",
     *   [
     *     fetchUser(userId),
     *     fetchUserPosts(userId), // might fail
     *     fetchUserComments(userId)
     *   ]
     * );
     * // Handle both successful and failed results
     * results.forEach((result, index) => {
     *   if (result.status === 'fulfilled') {
     *     console.log(`Result ${index}:`, result.value);
     *   } else {
     *     console.error(`Error ${index}:`, result.reason);
     *   }
     * });
     * ```
     */
    allSettled<T>(
      name: string | undefined,
      promises: Promise<T>[],
    ): Promise<PromiseSettledResult<T>[]>;

    /**
     * Waits for all promises to settle (resolve or reject) and returns results with status
     * @param promises - Array of promises to wait for
     * @example
     * ```typescript
     * const results = await context.promise.allSettled([
     *   fetchUser(userId),
     *   fetchUserPosts(userId)
     * ]);
     * ```
     */
    allSettled<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]>;

    /**
     * Waits for the first promise to resolve successfully, ignoring rejections until all fail
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to race
     * @example
     * ```typescript
     * // Try multiple data sources, use the first successful one
     * const userData = await context.promise.any(
     *   "fetch-from-any-source",
     *   [
     *     fetchFromPrimaryDB(userId),
     *     fetchFromSecondaryDB(userId),
     *     fetchFromCache(userId)
     *   ]
     * );
     * ```
     */
    any<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;

    /**
     * Waits for the first promise to resolve successfully, ignoring rejections until all fail
     * @param promises - Array of promises to race
     * @example
     * ```typescript
     * const result = await context.promise.any([
     *   fetchFromPrimaryDB(userId),
     *   fetchFromCache(userId)
     * ]);
     * ```
     */
    any<T>(promises: Promise<T>[]): Promise<T>;

    /**
     * Returns the result of the first promise to settle (resolve or reject)
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to race
     * @example
     * ```typescript
     * // Use fastest response, whether success or failure
     * const result = await context.promise.race(
     *   "fastest-response",
     *   [
     *     fetchFromFastAPI(userId),
     *     fetchFromSlowAPI(userId)
     *   ]
     * );
     * ```
     */
    race<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;

    /**
     * Returns the result of the first promise to settle (resolve or reject)
     * @param promises - Array of promises to race
     * @example
     * ```typescript
     * const result = await context.promise.race([
     *   fetchFromAPI(userId),
     *   timeout(5000) // Race against timeout
     * ]);
     * ```
     */
    race<T>(promises: Promise<T>[]): Promise<T>;
  };

  /**
   * Executes items concurrently with fine-grained control over execution strategy
   * @param name - Step name for tracking and debugging
   * @param items - Array of items to execute concurrently
   * @param executor - Function that processes each item
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * const results = await context.executeConcurrently(
   *   "process-files",
   *   [
   *     { id: "file1", path: "/path/to/file1.txt" },
   *     { id: "file2", path: "/path/to/file2.txt" },
   *     { id: "file3", path: "/path/to/file3.txt" }
   *   ],
   *   async (item, ctx) => {
   *     return await ctx.step(`process-${item.id}`, async () => {
   *       return await processFile(item.path);
   *     });
   *   },
   *   {
   *     maxConcurrency: 3,
   *     completionConfig: {
   *       minSuccessful: 2,
   *       toleratedFailureCount: 1
   *     }
   *   }
   * );
   * ```
   */
  executeConcurrently<TItem, TResult>(
    name: string | undefined,
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult>,
    config?: ConcurrencyConfig,
  ): Promise<BatchResult<TResult>>;

  /**
   * Executes items concurrently with fine-grained control over execution strategy
   * @param items - Array of items to execute concurrently
   * @param executor - Function that processes each item
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * const results = await context.executeConcurrently(
   *   [{ data: "item1" }, { data: "item2" }],
   *   async (item, ctx) => {
   *     return await processItem(item.data);
   *   }
   * );
   * ```
   */
  executeConcurrently<TItem, TResult>(
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult>,
    config?: ConcurrencyConfig,
  ): Promise<BatchResult<TResult>>;

  /**
   * Sets a custom logger for this context
   * @param logger - Custom logger implementation
   * @example
   * ```typescript
   * const customLogger = {
   *   log: (level, message, data, error) => console.log(`[${level}] ${message}`, data),
   *   error: (message, error, data) => console.error(message, error, data),
   *   warn: (message, data) => console.warn(message, data),
   *   info: (message, data) => console.info(message, data),
   *   debug: (message, data) => console.debug(message, data)
   * };
   * context.setCustomLogger(customLogger);
   * ```
   */
  setCustomLogger(logger: Logger): void;
}

export interface ExecutionContext {
  executionContextId: string;
  customerHandlerEvent: any;
  state: ExecutionState;
  _stepData: Record<string, Operation>; // Private, use getStepData() instead
  terminationManager: TerminationManager;
  isLocalMode: boolean;
  isVerbose: boolean;
  durableExecutionArn: string;
  parentId?: string;
  getStepData(stepId: string): Operation | undefined;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delaySeconds?: number;
}

export enum StepSemantics {
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",
  AtLeastOncePerRetry = "AT_LEAST_ONCE_PER_RETRY",
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
 * Configuration options for child context operations
 */
export interface ChildConfig<T = any> {
  /** Serialization/deserialization configuration for child context data */
  serdes?: Serdes<T>;
  /** Sub-type identifier for categorizing child contexts */
  subType?: string;
  /** Function to generate summaries for large results (used internally by map/parallel) */
  summaryGenerator?: (result: T) => string;
}

/**
 * Configuration options for createCallback operations
 */
export interface CreateCallbackConfig {
  /** Maximum time to wait for callback submission in seconds */
  timeout?: number; // seconds
  /** Heartbeat timeout in seconds to detect stalled callback operations */
  heartbeatTimeout?: number; // seconds
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<any>;
}

/**
 * Configuration options for waitForCallback operations
 */
export interface WaitForCallbackConfig {
  /** Maximum time to wait for callback in seconds */
  timeout?: number; // seconds
  /** Heartbeat timeout in seconds to detect stalled operations */
  heartbeatTimeout?: number; // seconds
  /** Strategy for retrying failed callback submissions */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<any>;
}

/**
 * Configuration options for invoke operations
 */
export interface InvokeConfig<I = any, O = any> {
  /** Serialization/deserialization configuration for input payload */
  payloadSerdes?: Serdes<I>;
  /** Serialization/deserialization configuration for result data */
  resultSerdes?: Serdes<O>;
  /** Maximum execution time for the invoked function in seconds */
  timeoutSeconds?: number | undefined;
}

export type CreateCallbackResult<T> = [Promise<T>, string]; // [promise, callbackId]
/**
 * Function that submits a callback ID to an external system
 * @param callbackId - Unique identifier for the callback that should be submitted to external system
 * @param context - Context for logging and other operations during callback submission
 * @returns Promise that resolves when the callback ID has been successfully submitted
 */
export type WaitForCallbackSubmitterFunc = (
  callbackId: string,
  context: WaitForCallbackContext,
) => Promise<void>;

/**
 * Generic logger interface for custom logger implementations
 * Provides structured logging capabilities for durable execution contexts
 */
export interface Logger {
  /** Generic log method with configurable level */
  log(level: string, message?: string, data?: unknown, error?: Error): void;
  /** Log error messages with optional error object and additional data */
  error(message?: string, error?: Error, data?: unknown): void;
  /** Log warning messages with optional additional data */
  warn(message?: string, data?: unknown): void;
  /** Log informational messages with optional additional data */
  info(message?: string, data?: any): void;
  /** Log debug messages with optional additional data */
  debug(message?: string, data?: any): void;
}

/**
 * Base interface for operation contexts.
 * Do not use directly - use specific context types like StepContext, WaitForConditionContext, etc.
 */
export interface OperationContext {
  logger: Logger;
}

export type StepContext = OperationContext;

export type WaitForConditionContext = OperationContext;

export type WaitForCallbackContext = OperationContext;

/**
 * Function to be executed as a durable step
 * @param context - Context for logging and other operations during step execution
 * @returns Promise resolving to the step result
 */
export type StepFunc<T> = (context: StepContext) => Promise<T>;
/**
 * Function to be executed in a child context with isolated state
 * @param context - DurableContext with isolated step counter and state tracking
 * @returns Promise resolving to the child function result
 */
export type ChildFunc<T> = (context: DurableContext) => Promise<T>;
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
  | { shouldContinue: true; delaySeconds: number }
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

/**
 * Configuration options for map operations
 */
export interface MapConfig<T = any> {
  /** Maximum number of concurrent executions (default: unlimited) */
  maxConcurrency?: number;
  /** Function to generate custom names for map items */
  itemNamer?: (item: T, index: number) => string;
  /** Configuration for completion behavior */
  completionConfig?: {
    /** Minimum number of successful executions required */
    minSuccessful?: number;
    /** Maximum number of failures tolerated */
    toleratedFailureCount?: number;
    /** Maximum percentage of failures tolerated (0-100) */
    toleratedFailurePercentage?: number;
  };
}

/**
 * Configuration options for parallel operations
 */
export interface ParallelConfig {
  /** Maximum number of concurrent executions (default: unlimited) */
  maxConcurrency?: number;
  /** Configuration for completion behavior */
  completionConfig?: {
    /** Minimum number of successful executions required */
    minSuccessful?: number;
    /** Maximum number of failures tolerated */
    toleratedFailureCount?: number;
    /** Maximum percentage of failures tolerated (0-100) */
    toleratedFailurePercentage?: number;
  };
}

// Re-export concurrent execution types for public API
export type {
  ConcurrentExecutionItem,
  ConcurrentExecutor,
  ConcurrencyConfig,
} from "../handlers/concurrent-execution-handler/concurrent-execution-handler";

// Re-export BatchResult types for public API
export type {
  BatchResult,
  BatchItem,
} from "../handlers/concurrent-execution-handler/batch-result";
