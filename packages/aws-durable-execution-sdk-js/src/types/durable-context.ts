import { Context } from "aws-lambda";
import { Logger, LoggerConfig } from "./logger";
import { StepFunc, StepConfig } from "./step";
import { ChildFunc, ChildConfig } from "./child-context";
import { InvokeConfig } from "./invoke";
import { Duration } from "./core";
import {
  CreateCallbackConfig,
  CreateCallbackResult,
  WaitForCallbackSubmitterFunc,
  WaitForCallbackConfig,
} from "./callback";
import {
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
} from "./wait-condition";
import {
  MapFunc,
  MapConfig,
  ParallelFunc,
  ParallelConfig,
  NamedParallelBranch,
  BatchResult,
} from "./batch";

export interface DurableContext {
  /**
   * The underlying AWS Lambda context
   */
  lambdaContext: Context;
  
  /**
   * Logger instance for this context, automatically enriched with durable execution metadata.
   * 
   * **Automatic Enrichment:**
   * All log entries are automatically enhanced with:
   * - `timestamp`: ISO timestamp of the log entry
   * - `execution_arn`: Durable execution ARN for tracing
   * - `step_id`: Current step identifier (when logging from within a step)
   * - `level`: Log level (info, error, warn, debug)
   * - `message`: The log message
   * 
   * **Output Format:**
   * ```json
   * {
   *   "timestamp": "2025-11-21T18:39:24.743Z",
   *   "execution_arn": "arn:aws:lambda:...",
   *   "level": "info", 
   *   "step_id": "abc123",
   *   "message": "User action completed",
   *   "data": { "userId": "123", "action": "login" }
   * }
   * ```
   * 
   * @example
   * ```typescript
   * // Basic usage
   * context.logger.info("User logged in", { userId: "123" });
   * 
   * // Error logging
   * context.logger.error("Database connection failed", error, { retryCount: 3 });
   * 
   * // With custom logger (handles circular refs)
   * import { Logger } from '@aws-lambda-powertools/logger';
   * const powertoolsLogger = new Logger();
   * context.configureLogger({ customLogger: powertoolsLogger });
   * ```
   */
  logger: Logger;

  /**
   * Executes a function as a durable step with automatic retry and state persistence
   *
   * @remarks
   * **IMPORTANT**: `step()` is designed for single atomic operations and cannot be used to group
   * multiple durable operations (like other steps, waits, or child contexts). The step function
   * receives a simple `StepContext` (for logging only), not a full `DurableContext`.
   *
   * **To group multiple durable operations, use `runInChildContext()` instead:**
   * ```typescript
   * // ❌ WRONG: Cannot call durable operations inside step
   * await context.step("process-order", async (ctx) => {
   *   await context.wait({ seconds: 1 });    // ERROR: context not available
   *   await context.step(async () => ...);   // ERROR: context not available
   *   return result;
   * });
   *
   * // ✅ CORRECT: Use runInChildContext to group operations
   * await context.runInChildContext("process-order", async (childCtx) => {
   *   await childCtx.wait({ seconds: 1 });
   *   const step1 = await childCtx.step(async () => validateOrder(order));
   *   const step2 = await childCtx.step(async () => chargePayment(step1));
   *   return step2;
   * });
   * ```
   *
   * @param name - Step name for tracking and debugging
   * @param fn - Function to execute as a durable step
   * @param config - Optional configuration for retry strategy, semantics, and serialization
   * @throws \{StepError\} When the step function fails after all retry attempts are exhausted
   * @example
   * ```typescript
   * // ✅ Good: Single atomic operation
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
   *
   * @remarks
   * **IMPORTANT**: `step()` cannot group multiple durable operations. Use `runInChildContext()`
   * to group steps, waits, or other durable operations together. See the named overload for details.
   *
   * @param fn - Function to execute as a durable step
   * @param config - Optional configuration for retry strategy, semantics, and serialization
   * @throws \{StepError\} When the step function fails after all retry attempts are exhausted
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
   * @param config - Optional configuration for serialization
   * @throws \{InvokeError\} When the invoked function fails or times out
   * @example
   * ```typescript
   * const result = await context.invoke(
   *   "process-payment",
   *   "arn:aws:lambda:us-east-1:123456789012:function:payment-processor",
   *   { amount: 100, currency: "USD" }
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
   * @param config - Optional configuration for serialization
   * @throws \{InvokeError\} When the invoked function fails or times out
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
   * @throws \{ChildContextError\} When the child context function fails
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
   * @throws \{ChildContextError\} When the child context function fails
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

  /**
   * Pauses execution for the specified duration
   * @param name - Step name for tracking and debugging
   * @param duration - Duration to wait
   * @example
   * ```typescript
   * // Wait 5 seconds before retrying
   * await context.wait("retry-delay", { seconds: 5 });
   *
   * // Wait for a longer duration
   * await context.wait("long-delay", { minutes: 5, seconds: 30 });
   * ```
   */
  wait(name: string, duration: Duration): Promise<void>;

  /**
   * Pauses execution for the specified duration
   * @param duration - Duration to wait
   * @example
   * ```typescript
   * // Wait 30 seconds for rate limiting
   * await context.wait({ seconds: 30 });
   *
   * // Wait using multiple units
   * await context.wait({ hours: 1, minutes: 30 });
   * ```
   */
  wait(duration: Duration): Promise<void>;

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
   *       return { shouldContinue: true, delay: { seconds: Math.min(attempt * 2, 60) } };
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
   *       state.ready ? { shouldContinue: false } : { shouldContinue: true, delay: { seconds: 10 } }
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
   * @throws \{CallbackError\} When callback fails, times out, or external system reports failure (thrown by the returned promise)
   * @example
   * ```typescript
   * const [callbackPromise, callbackId] = await context.createCallback(
   *   "external-approval",
   *   { timeout: { hours: 1 } } // 1 hour timeout
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
    config?: CreateCallbackConfig<T>,
  ): Promise<CreateCallbackResult<T>>;

  /**
   * Creates a callback that external systems can complete
   * @param config - Optional configuration for timeout and serialization
   * @returns Tuple of [promise that resolves when callback is submitted, callback ID]
   * @throws \{CallbackError\} When callback fails, times out, or external system reports failure (thrown by the returned promise)
   * @example
   * ```typescript
   * const [promise, callbackId] = await context.createCallback({
   *   timeout: { minutes: 30 } // 30 minutes
   * });
   * await notifyExternalSystem(callbackId);
   * const result = await promise;
   * ```
   */
  createCallback<T>(
    config?: CreateCallbackConfig<T>,
  ): Promise<CreateCallbackResult<T>>;

  /**
   * Wait for an external system to complete a callback with the SendDurableExecutionCallbackSuccess or SendDurableExecutionCallbackFailure APIs.
   * @param name - Step name for tracking and debugging
   * @param submitter - Function that receives the callback ID and submits the callback
   * @param config - Optional configuration for timeout and retry behavior
   * @throws \{CallbackError\} When callback fails, times out, or external system reports failure
   * @example
   * ```typescript
   * const result = await context.waitForCallback(
   *   "wait-for-external-api",
   *   async (callbackId, ctx) => {
   *     // Submit callback ID to external system
   *     await submitToExternalAPI(callbackId);
   *   },
   *   { timeout: { minutes: 5 } }
   * );
   * ```
   */
  waitForCallback<T>(
    name: string | undefined,
    submitter: WaitForCallbackSubmitterFunc,
    config?: WaitForCallbackConfig<T>,
  ): Promise<T>;

  /**
   * Wait for an external system to complete a callback with the SendDurableExecutionCallbackSuccess or SendDurableExecutionCallbackFailure APIs.
   * @param submitter - Function that receives the callback ID and submits the callback
   * @param config - Optional configuration for timeout and retry behavior
   * @throws \{CallbackError\} When callback fails, times out, or external system reports failure
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
    config?: WaitForCallbackConfig<T>,
  ): Promise<T>;

  /**
   * Maps over an array of items with a function, executing in parallel with optional concurrency control
   * @param name - Step name for tracking and debugging
   * @param items - Array of items to process
   * @param mapFunc - Function to apply to each item (context, item, index, array) =\> Promise\<TOutput\>
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
    config?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>>;

  /**
   * Maps over an array of items with a function, executing in parallel with optional concurrency control
   * @param items - Array of items to process
   * @param mapFunc - Function to apply to each item (context, item, index, array) =\> Promise\<TOutput\>
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
    config?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>>;

  /**
   * Executes multiple functions in parallel with optional concurrency control
   * @param name - Step name for tracking and debugging
   * @param branches - Array of functions or named branches to execute in parallel (all must return same type)
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * // Strict: all branches must return string
   * const results = await context.parallel<string>(
   *   "parallel-operations",
   *   [
   *     async (ctx) => ctx.step(async () => "result1"),
   *     async (ctx) => ctx.step(async () => "result2")
   *   ]
   * );
   * ```
   */
  parallel<T>(
    name: string | undefined,
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig<T>,
  ): Promise<BatchResult<T>>;

  /**
   * Executes multiple functions in parallel with optional concurrency control
   * @param branches - Array of functions or named branches to execute in parallel (all must return same type)
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * // Strict: all branches must return string
   * const results = await context.parallel<string>([
   *   async (ctx) => ctx.step(async () => "task1"),
   *   async (ctx) => ctx.step(async () => "task2")
   * ]);
   * ```
   */
  parallel<T>(
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig<T>,
  ): Promise<BatchResult<T>>;

  /**
   * Executes multiple functions in parallel with optional concurrency control
   *
   * @remarks
   * This overload provides automatic type inference for heterogeneous return types.
   * When branches return different types, the result will be `BatchResult<T1 | T2 | ...>`.
   * Use the explicit type parameter overloads above for strict homogeneous type checking.
   *
   * @param name - Step name for tracking and debugging
   * @param branches - Array of functions or named branches to execute in parallel
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * // Flexible: TypeScript infers union type automatically
   * const results = await context.parallel("parallel-operations", [
   *   async (ctx) => ctx.step(async () => ({ step1: "completed" })),
   *   async (ctx) => ctx.step(async () => "task 2 completed")
   * ]);
   * // results: BatchResult<{ step1: string } | string>
   * ```
   */
  parallel<Branches extends readonly unknown[]>(
    name: string | undefined,
    branches: Branches,
    config?: ParallelConfig<
      Branches[number] extends ParallelFunc<infer ReturnType>
        ? ReturnType
        : Branches[number] extends NamedParallelBranch<infer ReturnType>
          ? ReturnType
          : never
    >,
  ): Promise<
    BatchResult<
      Branches[number] extends ParallelFunc<infer ReturnType>
        ? ReturnType
        : Branches[number] extends NamedParallelBranch<infer ReturnType>
          ? ReturnType
          : never
    >
  >;

  /**
   * Executes multiple functions in parallel with optional concurrency control
   *
   * @remarks
   * This overload provides automatic type inference for heterogeneous return types.
   * When branches return different types, the result will be `BatchResult<T1 | T2 | ...>`.
   * Use the explicit type parameter overload above for strict homogeneous type checking.
   *
   * @param branches - Array of functions or named branches to execute in parallel
   * @param config - Optional configuration for concurrency and completion behavior
   * @example
   * ```typescript
   * // Flexible: TypeScript infers union type automatically
   * const results = await context.parallel([
   *   async (ctx) => ctx.step(async () => ({ step1: "completed" })),
   *   async (ctx) => ctx.step(async () => "task 2 completed")
   * ]);
   * // results: BatchResult<{ step1: string } | string>
   * ```
   */
  parallel<Branches extends readonly unknown[]>(
    branches: Branches,
    config?: ParallelConfig<
      Branches[number] extends ParallelFunc<infer ReturnType>
        ? ReturnType
        : Branches[number] extends NamedParallelBranch<infer ReturnType>
          ? ReturnType
          : never
    >,
  ): Promise<
    BatchResult<
      Branches[number] extends ParallelFunc<infer ReturnType>
        ? ReturnType
        : Branches[number] extends NamedParallelBranch<infer ReturnType>
          ? ReturnType
          : never
    >
  >;

  promise: {
    /**
     * Waits for all promises to resolve and returns an array of all results
     *
     * @remarks
     * **IMPORTANT**: Promise combinators accept already-created promises that start executing immediately.
     * They cannot control concurrency, implement completion policies, or provide durability.
     *
     * **Consider using `map()` or `parallel()` instead if you need:**
     * - Concurrency control (limit simultaneous executions)
     * - Completion policies (minSuccessful, toleratedFailureCount)
     * - Durability (survive Lambda timeouts and resume from checkpoints)
     * - Per-item retry strategies
     * - Progress tracking for long-running operations
     *
     * **Use promise combinators only for:**
     * - Fast, in-memory operations (less than a few seconds)
     * - Operations that must all start immediately
     * - Simple coordination of already-running promises
     *
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to wait for (already executing)
     * @example
     * ```typescript
     * // ❌ All promises start immediately - no concurrency control
     * const [user, posts, comments] = await context.promise.all(
     *   "fetch-user-data",
     *   [
     *     fetchUser(userId),        // Already running
     *     fetchUserPosts(userId),   // Already running
     *     fetchUserComments(userId) // Already running
     *   ]
     * );
     *
     * // ✅ Better: Use map() for controlled, durable execution
     * const results = await context.map(
     *   [userId, userId, userId],
     *   async (ctx, id, index) => {
     *     if (index === 0) return fetchUser(id);
     *     if (index === 1) return fetchUserPosts(id);
     *     return fetchUserComments(id);
     *   },
     *   { maxConcurrency: 2 } // Control concurrency, survives timeouts
     * );
     * ```
     */
    all<T>(name: string | undefined, promises: Promise<T>[]): Promise<T[]>;

    /**
     * Waits for all promises to resolve and returns an array of all results
     *
     * @remarks
     * **IMPORTANT**: Promises start executing immediately when created. Consider using `map()` or `parallel()`
     * for concurrency control, durability, and completion policies. See the named overload for details.
     *
     * @param promises - Array of promises to wait for (already executing)
     * @example
     * ```typescript
     * // ❌ Limited: No concurrency control or durability
     * const results = await context.promise.all([
     *   fetchUser(userId),
     *   fetchUserPosts(userId)
     * ]);
     *
     * // ✅ Better: Use parallel() for durable execution
     * const results = await context.parallel([
     *   async (ctx) => ctx.step(async () => fetchUser(userId)),
     *   async (ctx) => ctx.step(async () => fetchUserPosts(userId))
     * ]);
     * ```
     */
    all<T>(promises: Promise<T>[]): Promise<T[]>;

    /**
     * Waits for all promises to settle (resolve or reject) and returns results with status
     *
     * @remarks
     * **IMPORTANT**: Promise combinators accept already-created promises that start executing immediately.
     * Consider using `map()` or `parallel()` with completion policies for better control over failure handling.
     *
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to wait for (already executing)
     * @example
     * ```typescript
     * // ❌ All promises start immediately
     * const results = await context.promise.allSettled(
     *   "fetch-all-data",
     *   [
     *     fetchUser(userId),
     *     fetchUserPosts(userId),
     *     fetchUserComments(userId)
     *   ]
     * );
     *
     * // ✅ Better: Use map() with completion config
     * const results = await context.map(
     *   [userId, userId, userId],
     *   async (ctx, id, index) => {
     *     // Fetch different data based on index
     *   },
     *   {
     *     completionConfig: {
     *       minSuccessful: 2, // Stop early if 2 succeed
     *       toleratedFailureCount: 1
     *     }
     *   }
     * );
     * ```
     */
    allSettled<T>(
      name: string | undefined,
      promises: Promise<T>[],
    ): Promise<PromiseSettledResult<T>[]>;

    /**
     * Waits for all promises to settle (resolve or reject) and returns results with status
     *
     * @remarks
     * **IMPORTANT**: Promises start executing immediately. Consider using `map()` or `parallel()`
     * for better failure handling and durability. See the named overload for details.
     *
     * @param promises - Array of promises to wait for (already executing)
     */
    allSettled<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]>;

    /**
     * Waits for the first promise to resolve successfully, ignoring rejections until all fail
     *
     * @remarks
     * **IMPORTANT**: Promise combinators accept already-created promises that start executing immediately.
     * All promises race simultaneously with no control over execution order or resource usage.
     *
     * **Consider using `parallel()` with completion policies instead** for controlled racing with durability.
     *
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to race (already executing)
     * @example
     * ```typescript
     * // ❌ All sources queried immediately
     * const userData = await context.promise.any(
     *   "fetch-from-any-source",
     *   [
     *     fetchFromPrimaryDB(userId),
     *     fetchFromSecondaryDB(userId),
     *     fetchFromCache(userId)
     *   ]
     * );
     *
     * // ✅ Better: Use parallel() with early completion
     * const result = await context.parallel(
     *   [
     *     async (ctx) => ctx.step(async () => fetchFromPrimaryDB(userId)),
     *     async (ctx) => ctx.step(async () => fetchFromSecondaryDB(userId)),
     *     async (ctx) => ctx.step(async () => fetchFromCache(userId))
     *   ],
     *   {
     *     completionConfig: { minSuccessful: 1 } // Stop after first success
     *   }
     * );
     * ```
     */
    any<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;

    /**
     * Waits for the first promise to resolve successfully, ignoring rejections until all fail
     *
     * @remarks
     * **IMPORTANT**: Promises start executing immediately. Consider using `parallel()` with
     * `minSuccessful: 1` for durable racing. See the named overload for details.
     *
     * @param promises - Array of promises to race (already executing)
     */
    any<T>(promises: Promise<T>[]): Promise<T>;

    /**
     * Returns the result of the first promise to settle (resolve or reject)
     *
     * @remarks
     * **IMPORTANT**: Promise combinators accept already-created promises that start executing immediately.
     * All promises race simultaneously with no control over execution.
     *
     * **Use promise.race() only for:**
     * - Racing against timeouts or deadlines
     * - Simple coordination of already-running operations
     *
     * **For durable racing with control, use `parallel()` with `minSuccessful: 1`**
     *
     * @param name - Step name for tracking and debugging
     * @param promises - Array of promises to race (already executing)
     * @example
     * ```typescript
     * // ✅ Good use case: Racing against timeout
     * const result = await context.promise.race(
     *   "fetch-with-timeout",
     *   [
     *     fetchFromAPI(userId),
     *     new Promise((_, reject) =>
     *       setTimeout(() => reject(new Error("Timeout")), 5000)
     *     )
     *   ]
     * );
     * ```
     */
    race<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;

    /**
     * Returns the result of the first promise to settle (resolve or reject)
     *
     * @remarks
     * **IMPORTANT**: Promises start executing immediately. Use only for simple timeout patterns.
     * See the named overload for details.
     *
     * @param promises - Array of promises to race (already executing)
     */
    race<T>(promises: Promise<T>[]): Promise<T>;
  };

  /**
   * Configures logger behavior for this context
   *
   * @param config - Logger configuration options
   * @example
   * ```typescript
   * // Set custom logger
   * const customLogger = {
   *   log: (level, message, data, error) => console.log(`[${level}] ${message}`, data),
   *   error: (message, error, data) => console.error(message, error, data),
   *   warn: (message, data) => console.warn(message, data),
   *   info: (message, data) => console.info(message, data),
   *   debug: (message, data) => console.debug(message, data)
   * };
   * context.configureLogger({ customLogger });
   *
   * // Disable mode-aware logging to see logs during replay
   * context.configureLogger({ modeAware: false });
   *
   * // Both together
   * context.configureLogger({
   *   customLogger,
   *   modeAware: false
   * });
   * ```
   */
  configureLogger(config: LoggerConfig): void;
}
