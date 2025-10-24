# AWS Durable Execution SDK - API Specification

## DurableContext Interface

The `DurableContext` is the main interface for building durable workflows. It extends the Lambda Context and provides methods for executing steps, waiting, invoking other functions, and coordinating parallel operations.

```typescript
interface DurableContext {
  /**
   * The underlying AWS Lambda context
   */
  lambdaContext: Context;

  /**
   * Logger instance for this context, enriched with execution context information
   */
  logger: Logger;

  // Step operations
  step<T>(
    name: string | undefined,
    fn: StepFunc<T>,
    config?: StepConfig<T>,
  ): Promise<T>;
  step<T>(fn: StepFunc<T>, config?: StepConfig<T>): Promise<T>;

  // Invoke operations
  invoke<I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;
  invoke<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;

  // Child context operations
  runInChildContext<T>(
    name: string | undefined,
    fn: ChildFunc<T>,
    config?: ChildConfig<T>,
  ): Promise<T>;
  runInChildContext<T>(fn: ChildFunc<T>, config?: ChildConfig<T>): Promise<T>;

  // Wait operations
  wait(name: string, seconds: number): Promise<void>;
  wait(seconds: number): Promise<void>;

  // Conditional waiting
  waitForCondition<T>(
    name: string | undefined,
    checkFunc: WaitForConditionCheckFunc<T>,
    config: WaitForConditionConfig<T>,
  ): Promise<T>;
  waitForCondition<T>(
    checkFunc: WaitForConditionCheckFunc<T>,
    config: WaitForConditionConfig<T>,
  ): Promise<T>;

  // Callback operations
  createCallback<T>(
    name: string | undefined,
    config?: CreateCallbackConfig<T>,
  ): Promise<CreateCallbackResult<T>>;
  createCallback<T>(
    config?: CreateCallbackConfig<T>,
  ): Promise<CreateCallbackResult<T>>;

  waitForCallback<T>(
    name: string | undefined,
    submitter: WaitForCallbackSubmitterFunc,
    config?: WaitForCallbackConfig<T>,
  ): Promise<T>;
  waitForCallback<T>(
    submitter: WaitForCallbackSubmitterFunc,
    config?: WaitForCallbackConfig<T>,
  ): Promise<T>;

  // Batch operations
  map<TInput, TOutput>(
    name: string | undefined,
    items: TInput[],
    mapFunc: MapFunc<TInput, TOutput>,
    config?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>>;
  map<TInput, TOutput>(
    items: TInput[],
    mapFunc: MapFunc<TInput, TOutput>,
    config?: MapConfig<TInput, TOutput>,
  ): Promise<BatchResult<TOutput>>;

  parallel<T>(
    name: string | undefined,
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig<T>,
  ): Promise<BatchResult<T>>;
  parallel<T>(
    branches: (ParallelFunc<T> | NamedParallelBranch<T>)[],
    config?: ParallelConfig<T>,
  ): Promise<BatchResult<T>>;

  executeConcurrently<TItem, TResult>(
    name: string | undefined,
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult>,
    config?: ConcurrencyConfig<TResult>,
  ): Promise<BatchResult<TResult>>;
  executeConcurrently<TItem, TResult>(
    items: ConcurrentExecutionItem<TItem>[],
    executor: ConcurrentExecutor<TItem, TResult>,
    config?: ConcurrencyConfig<TResult>,
  ): Promise<BatchResult<TResult>>;

  // Promise combinators
  promise: {
    all<T>(name: string | undefined, promises: Promise<T>[]): Promise<T[]>;
    all<T>(promises: Promise<T>[]): Promise<T[]>;
    allSettled<T>(
      name: string | undefined,
      promises: Promise<T>[],
    ): Promise<PromiseSettledResult<T>[]>;
    allSettled<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]>;
    any<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;
    any<T>(promises: Promise<T>[]): Promise<T>;
    race<T>(name: string | undefined, promises: Promise<T>[]): Promise<T>;
    race<T>(promises: Promise<T>[]): Promise<T>;
  };

  // Logger customization
  setCustomLogger(logger: Logger): void;
}
```

## Type Definitions

### Function Types

```typescript
/**
 * Function to be executed as a durable step
 * @param context - Context for logging and other operations during step execution
 * @returns Promise resolving to the step result
 */
type StepFunc<T> = (context: StepContext) => Promise<T>;

/**
 * Function to be executed in a child context with isolated state
 * @param context - DurableContext with isolated step counter and state tracking
 * @returns Promise resolving to the child function result
 */
type ChildFunc<T> = (context: DurableContext) => Promise<T>;

/**
 * Function to be executed as a branch in a parallel operation
 * @param context - DurableContext for executing durable operations within the branch
 * @returns Promise resolving to the branch result
 */
type ParallelFunc<T> = (context: DurableContext) => Promise<T>;

/**
 * Function to be executed for each item in a map operation
 * @param context - DurableContext for executing durable operations within the map
 * @param item - Current item being processed
 * @param index - Index of the current item in the array
 * @param array - The original array being mapped over
 * @returns Promise resolving to the transformed value
 */
type MapFunc<TInput, TOutput> = (
  context: DurableContext,
  item: TInput,
  index: number,
  array: TInput[],
) => Promise<TOutput>;

/**
 * Function that submits a callback ID to an external system
 * @param callbackId - Unique identifier for the callback that should be submitted to external system
 * @param context - Context for logging and other operations during callback submission
 * @returns Promise that resolves when the callback ID has been successfully submitted
 */
type WaitForCallbackSubmitterFunc = (
  callbackId: string,
  context: WaitForCallbackContext,
) => Promise<void>;

/**
 * Function that checks and updates state for waitForCondition operations
 * @param state - Current state value
 * @param context - Context for logging and other operations during state checking
 * @returns Promise resolving to the updated state
 */
type WaitForConditionCheckFunc<T> = (
  state: T,
  context: WaitForConditionContext,
) => Promise<T>;

/**
 * Function that determines whether to continue waiting and how long to delay
 * @param state - Current state value
 * @param attempt - Current attempt number (starts at 1)
 * @returns Decision object indicating whether to continue and delay duration
 */
type WaitForConditionWaitStrategyFunc<T> = (
  state: T,
  attempt: number,
) => WaitForConditionDecision;

/**
 * Executor function type for concurrent execution
 */
type ConcurrentExecutor<TItem, TResult> = (
  item: ConcurrentExecutionItem<TItem>,
  childContext: DurableContext,
) => Promise<TResult>;
```

### Configuration Types

```typescript
/**
 * Retry decision returned by retry strategy functions
 */
export interface RetryDecision {
  shouldRetry: boolean;
  delaySeconds?: number;
}

/**
 * Execution semantics for step operations
 */
export enum StepSemantics {
  AtMostOncePerRetry = "AT_MOST_ONCE_PER_RETRY",
  AtLeastOncePerRetry = "AT_LEAST_ONCE_PER_RETRY",
}

/**
 * Jitter strategy for retry delays to prevent thundering herd problem
 * @remarks
 * Jitter adds randomness to retry delays to spread out retry attempts when multiple operations fail simultaneously
 */
export enum JitterStrategy {
  /** No jitter - use exact calculated delay */
  NONE = "NONE",
  /** Full jitter - random delay between 0 and calculated delay */
  FULL = "FULL",
  /** Half jitter - random delay between 50% and 100% of calculated delay */
  HALF = "HALF",
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
 * Configuration options for invoke operations
 */
export interface InvokeConfig<I, O> {
  /** Serialization/deserialization configuration for input payload */
  payloadSerdes?: Serdes<I>;
  /** Serialization/deserialization configuration for result data */
  resultSerdes?: Serdes<O>;
}

/**
 * Configuration options for child context operations
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
 * Completion configuration for batch operations
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
 * Configuration options for createCallback operations
 */
export interface CreateCallbackConfig<T> {
  /** Maximum time to wait for callback submission in seconds */
  timeout?: number;
  /** Heartbeat timeout in seconds to detect stalled callback operations */
  heartbeatTimeout?: number;
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<T>;
}

/**
 * Configuration options for waitForCallback operations
 */
export interface WaitForCallbackConfig<T> {
  /** Maximum time to wait for callback in seconds */
  timeout?: number;
  /** Heartbeat timeout in seconds to detect stalled operations */
  heartbeatTimeout?: number;
  /** Strategy for retrying failed callback submissions */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;
  /** Serialization/deserialization configuration for callback data */
  serdes?: Serdes<T>;
}

export type CreateCallbackResult<T> = [Promise<T>, string];
```

### Batch Result Types

```typescript
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
  /** The error if the item failed */
  error?: Error;
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
  failed(): Array<BatchItem<R> & { error: Error }>;
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
  getErrors(): Array<Error>;
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
 * Named parallel branch with optional custom name
 */
export interface NamedParallelBranch<T> {
  name?: string;
  func: ParallelFunc<T>;
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
```

### Serialization Types

```typescript
interface SerdesContext {
  entityId: string;
  durableExecutionArn: string;
}

interface Serdes<T> {
  serialize: (
    value: T | undefined,
    context?: SerdesContext,
  ) => Promise<string | undefined>;
  deserialize: (
    data: string | undefined,
    context?: SerdesContext,
  ) => Promise<T | undefined>;
}
```

## Operation Details

### ctx.step - Running Checkpointed Steps

Durably run a block of code and persist its result so that it does not run to completion more than once (only will run more than once for retriable failures/results, subject to optional retry config).

**Signature**

```typescript
step<T>(name: string, fn: StepFunc<T>, config?: StepConfig<T>): DurablePromise<T>;
step<T>(fn: StepFunc<T>, config?: StepConfig<T>): DurablePromise<T>;
```

**Parameters**

- `name` - Optional name (improves readability in logs and execution details)
- `fn` - A function that performs some work and returns a promise
- `config` - Optional configuration for the code block execution

**Behavior**

- Runs the code block and checkpoints its result
- On replay, fetches previously-checkpointed result instead of running the code block
- Supports configurable retry strategies
- Provides at-least-once or at-most-once semantics

**Step Semantics**

By default, `step` provides at-least-once semantics (at least once per retry). The step's result is only checkpointed when it completes. If the code block starts but fails before completing, the step will run again on replay.

With at-most-once semantics (`StepSemantics.AtMostOncePerRetry`), `step` checkpoints twice: once before the code block starts, and once when complete. This ensures the step runs at most once per retry attempt.

**Retry Configuration**

Developers can configure retry behavior in several ways:

1. **Default Retry**: Unlimited retries with default strategy

```typescript
const result = await context.step(async () => callMyApi(event.value));
```

2. **Built-in Retry Presets**

```typescript
const result = await context.step(async () => callMyApi(event.value), {
  retryStrategy: retryPresets.exponentialBackoff(),
});
```

3. **createRetryStrategy Helper**

```typescript
const customRetryStrategy = createRetryStrategy({
  maxAttempts: 5,
  initialDelaySeconds: 1,
  maxDelaySeconds: 60,
  backoffRate: 2,
  jitterSeconds: 0.5,
  retryableErrors: ["Intentional failure", /Network error/],
  retryableErrorTypes: [NetworkError, TimeoutError],
});

const result = await context.step(
  "my_step",
  async () => callMyApi(event.value),
  { retryStrategy: customRetryStrategy },
);
```

4. **Custom Retry Function**

```typescript
const myCustomStrategy = (error: Error, attempt: number) => {
  if (attempt >= 5) {
    return { shouldRetry: false };
  }
  return { shouldRetry: true, delaySeconds: 1 + attempt };
};

const result = await context.step(async () => callMyApi(event.value), {
  retryStrategy: myCustomStrategy,
});
```

**Handling Interrupted Steps**

When a step with at-most-once semantics is interrupted after the initial checkpoint but before completion, the system will:

1. Detect the interrupted execution when the workflow resumes
2. Generate a `StepInterruptedError` with information about the interrupted step
3. Pass this error to the step's retry strategy
4. Based on the retry decision, either schedule a retry or mark the step as failed

Steps with at-least-once semantics will simply re-execute when interrupted.

### ctx.invoke - Invoke a Durable Function

Invoke another durable Lambda function and wait for its result.

**Signature**

```typescript
invoke<I,O>(name: string, funcId: FunctionIdentifier, input: I, config?: InvokeConfig): DurablePromise<O>;
invoke<I,O>(funcId: FunctionIdentifier, input: I, config?: InvokeConfig): DurablePromise<O>;
```

**Parameters**

- `name` - Optional name for tracking
- `funcId` - Function ID or ARN of the durable function to invoke
- `input` - Input data to pass to the invoked function
- `config` - Optional configuration for retry and serialization

**Behavior**

- Guarantees idempotency with at-most-once semantics
- Suspends the invoker to wait for the result
- Supports retry strategies similar to `step`

### ctx.wait - Waiting for a Period of Time

Durably wait for a specified period of time in seconds.

**Signature**

```typescript
wait(name: string, seconds: number): Promise<void>;
wait(seconds: number): Promise<void>;
```

**Parameters**

- `name` - Optional name for tracking
- `seconds` - Amount of time to wait in seconds

**Behavior**

- Persists the wait period and sets a durable timer
- Terminates the invocation to avoid paying for CPU while waiting
- Reinvokes the function when the timer fires

**Example**

```typescript
// Wait 5 seconds
await context.wait(5000);

// Wait 30 seconds with a name
await context.wait("rate-limit-delay", 30000);
```

### ctx.waitForCallback - Wait Until a Callback Occurs

Run a function to submit work to an external system, then suspend to wait for the external system to call back with the result.

**Signature**

```typescript
waitForCallback<T>(name: string, submitter?: WaitForCallbackSubmitterFunc, config?: WaitForCallbackConfig): DurablePromise<T>;
waitForCallback<T>(submitter?: WaitForCallbackSubmitterFunc, config?: WaitForCallbackConfig): DurablePromise<T>;
```

**Parameters**

- `name` - Optional name for tracking
- `submitter` - Function that receives a callbackId and sends it to an external component
- `config` - Optional configuration for timeout, heartbeat, and retry

**Behavior**

1. Generates a unique `callbackId` and checkpoints it
2. Calls the `submitter` function with the `callbackId`
3. Returns a promise that completes when the callback is submitted via `SendDurableExecutionCallbackSuccess` or `SendDurableExecutionCallbackFailure` API

**Configuration**

- `timeout` - Maximum seconds to wait for callback completion (default: no timeout)
- `heartbeatTimeout` - Maximum seconds between heartbeats (default: no timeout)
- `retryStrategy` - Used when submitter throws, callback fails, or timeout occurs

**Heartbeating**

External processes can call `SendDurableExecutionCallbackHeartbeat` API to prevent heartbeat timeouts. This allows early detection of external process failures.

```typescript
const result = await context.waitForCallback(
  "do async stuff",
  async (callbackId) => await InitiateAsyncWork(event, callbackId),
  { timeout: 24 * 60 * 60, heartbeatTimeout: 30 * 60 },
);
```

### ctx.createCallback - Create a CallbackId and Promise

Creates a new `callbackId` and returns the `callbackId` and a promise that will complete when the callback completes.

**Signature**

```typescript
createCallback<T>(name: string, config?: CreateCallbackConfig): DurablePromise<CreateCallbackResult<T>>;
createCallback<T>(config?: CreateCallbackConfig): DurablePromise<CreateCallbackResult<T>>;

type CreateCallbackResult<T> = [DurablePromise<T>, string]
```

**Parameters**

- `name` - Optional name for tracking
- `config` - Optional configuration for timeout and heartbeat

**Behavior**

- Creates and checkpoints a new `callbackId`
- Returns a tuple of [promise, callbackId]
- Allows more flexible callback patterns than `waitForCallback`

**Example: Send CallbackId Separately**

```typescript
const [callbackPromise, callbackId] = await context.createCallback();
await context.step(async () => await TriggerTask(event, callbackId));
const result = await callbackPromise;
```

### ctx.waitForCondition - Wait Until a Given Condition is Met

Wait for a condition to be met by repeatedly calling a check function.

**Signature**

```typescript
waitForCondition<T>(name: string, check: WaitForConditionCheckFunc<T>, config?: WaitForConditionConfig<T>): DurablePromise<T>;
waitForCondition<T>(check: WaitForConditionCheckFunc<T>, config?: WaitForConditionConfig<T>): DurablePromise<T>;
```

**Parameters**

- `name` - Optional name for tracking
- `check` - Function that accepts a state and returns an updated state
- `config` - Configuration with waitStrategy and initialState

**Behavior**

1. Calls the `check` function with the current state
2. Checkpoints the result
3. Passes result to `waitStrategy` function to determine if condition is met
4. If not met, sets a durable timer and suspends
5. Repeats when timer fires

**createWaitStrategy Helper**

```typescript
const customWaitStrategy = createWaitStrategy({
  maxAttempts: 60,
  initialDelaySeconds: 5,
  maxDelaySeconds: 30,
  backoffRate: 1.5,
  jitterSeconds: 1,
  shouldContinuePolling: (result) => result.status !== "CURRENT",
  timeoutSeconds: 600,
});

const result = await context.waitForCondition(
  async (state) => describeStackInstance(stackId),
  { waitStrategy: customWaitStrategy, initialState: null },
);
```

**Custom Wait Strategy**

```typescript
const myCustomWaitStrategy = (result: StackInstance, attempt: number) => {
  if (result.status === "CURRENT") {
    return { shouldContinue: false };
  } else if (attempt > 60) {
    throw new Error("Exceeded max attempts");
  } else {
    return {
      shouldContinue: true,
      delaySeconds: Math.min(5 * attempt, 30),
    };
  }
};
```

### ctx.parallel - Run Multiple Operations in Parallel

Run multiple durable operations in parallel with configurable concurrency and completion behavior.

**Signature**

```typescript
parallel<T>(name: string, branches: ParallelFunc<T>[], config?: ParallelConfig): DurablePromise<BatchResult<T>>;
parallel<T>(branches: ParallelFunc<T>[], config?: ParallelConfig): DurablePromise<BatchResult<T>>;
```

**Parameters**

- `name` - Optional name for tracking
- `branches` - Array of functions, each accepting a DurableContext
- `config` - Optional configuration for concurrency and completion

**Configuration**

- `maxConcurrency` - Maximum number of concurrent executions (default: unlimited)
- `completionConfig` - Conditions for when the parallel operation completes
  - `minSuccessful` - Number of successful executions required (default: all)
  - `toleratedFailureCount` - Number of failures tolerated (default: 0)
  - `toleratedFailurePercentage` - Percentage of failures tolerated (0-100)

**Behavior**

- Wraps each function in `runInChildContext` for isolated execution
- Runs functions concurrently up to `maxConcurrency`
- Completes when completion conditions are met
- Marks abandoned operations so they cannot perform more durable operations

**Example**

```typescript
const result = await context.parallel(
  [async (ctx) => await task1(ctx), async (ctx) => await task2(ctx)],
  {
    maxConcurrency: 2,
    completionConfig: { minSuccessful: 1, toleratedFailureCount: 1 },
  },
);

if (result.hasFailure) {
  console.log(`${result.failureCount} tasks failed`);
}
```

### ctx.map - Run Durable Operations for Every Array Item

Process each item of an array with durable operations, running them concurrently.

**Signature**

```typescript
map<T>(name: string, items: any[], mapFunc: MapFunc<T>, config?: MapConfig): DurablePromise<BatchResult<T>>;
map<T>(items: any[], mapFunc: MapFunc<T>, config?: MapConfig): DurablePromise<BatchResult<T>>;
```

**Parameters**

- `name` - Optional name for tracking
- `items` - Array of items to process
- `mapFunc` - Function that accepts (context, item, index, array) and returns a promise
- `config` - Optional configuration for concurrency and completion

**Configuration**
Same as `parallel`, plus:

- `itemNamer` - Function to generate custom names for map items

**Example**

```typescript
const result = await context.map(
  users,
  async (ctx, user, index) => {
    return await ctx.step(`process-${user.id}`, async () => processUser(user));
  },
  {
    maxConcurrency: 5,
    completionConfig: { minSuccessful: 8, toleratedFailureCount: 2 },
    itemNamer: (user, index) => `User-${user.id}`,
  },
);

console.log(`Success: ${result.successCount}, Failed: ${result.failureCount}`);
result.throwIfError(); // Throws if any failures
```

### ctx.promise - Durable Promise Combinators

Durable versions of standard Promise combinators that checkpoint completion order for deterministic replay.

**Why Needed**

Regular promise combinators can be non-deterministic on replay due to differing promise completion orders. Durable promise combinators checkpoint their results to deterministically return the same result on replay.

**Methods**

```typescript
promise.all<T>(name: string, promises: DurablePromise<T>[]): DurablePromise<T[]>;
promise.all<T>(promises: Promise<T>[]): DurablePromise<T[]>;
```

Waits for all promises to resolve. Rejects if any promise rejects.

```typescript
promise.allSettled<T>(name: string, promises: DurablePromise<T>[]): DurablePromise<PromiseSettledResult<T>[]>;
promise.allSettled<T>(promises: DurablePromise<T>[]): DurablePromise<PromiseSettledResult<T>[]>;
```

Waits for all promises to settle (resolve or reject).

```typescript
promise.any<T>(name: string, promises: DurablePromise<T>[]): DurablePromise<T>;
promise.any<T>(promises: DurablePromise<T>[]): DurablePromise<T>;
```

Returns the first successfully resolved value. Throws AggregateError if all reject.

```typescript
promise.race<T>(name: string, promises: DurablePromise<T>[]): DurablePromise<T>;
promise.race<T>(promises: DurablePromise<T>[]): DurablePromise<T>;
```

Returns the result of the first promise to settle (resolve or reject).

**Example**

```typescript
const step1Promise = context.step(async () => await doStep1());
const step2Promise = context.step(async () => await doStep2());
const result = await context.promise.race([step1Promise, step2Promise]);
// result will always be the promise that won the race the first time
```

### ctx.runInChildContext - Deterministic Id Generation

Run a function inside a child context for deterministic ID generation when executing concurrently.

**Signature**

```typescript
runInChildContext<T>(name: string, fn: ChildFunc<T>, config?: ChildConfig<T>): DurablePromise<T>;
runInChildContext<T>(fn: ChildFunc<T>, config?: ChildConfig<T>): DurablePromise<T>;
```

**Parameters**

- `name` - Optional name for tracking
- `fn` - Function that receives a child context and returns a promise
- `config` - Optional configuration for serialization

**Why Needed**

When async code is initiated concurrently, timing differences can cause different interleavings on replay. `runInChildContext` creates a new durable context that deterministically generates operation IDs for child operations, even when started concurrently.

**Rules**

1. All durable operations must be started sequentially inside a single context unless wrapped in a nested `runInChildContext`
2. To run durable operations concurrently, enclose each set in its own `runInChildContext`
3. Inside the function, the `childCtx` must be used, not the outer `ctx`

**Example**

```typescript
async function doWork(ctx, waitTime) {
  const x = await ctx.step(async () => ...);
  await ctx.wait(waitTime);
  const y = await ctx.step(async () => ...);
  return x + y;
}

// Run concurrently with deterministic IDs
const s1 = context.runInChildContext(async (childCtx) => doWork(childCtx, 1000));
const s2 = context.runInChildContext(async (childCtx) => doWork(childCtx, 2000));
const res1 = await s1;
const res2 = await s2;
```

## Serialization

By default, the SDK uses JSON for serialization, but this can be overridden using the `Serdes` interface.

### The Serdes Interface

```typescript
interface Serdes<T> {
  serialize: (
    value: T | undefined,
    context?: SerdesContext,
  ) => Promise<string | undefined>;
  deserialize: (
    data: string | undefined,
    context?: SerdesContext,
  ) => Promise<T | undefined>;
}
```

### Using Serdes

Any operation that checkpoints data can use Serdes:

```typescript
const result = await context.step<Order>(
  "Process order",
  async () => processOrder(orderId),
  { serdes: orderSerdes },
);
```

### Creating a Serdes

```typescript
const orderSerdes: Serdes<Order> = {
  serialize: (order) => {
    const clone = { ...order };
    clone.createdAt = order.createdAt.toISOString();
    return JSON.stringify(clone);
  },
  deserialize: (data) => {
    const parsed = JSON.parse(data);
    const order = new Order();
    Object.assign(order, parsed);
    order.createdAt = new Date(parsed.createdAt);
    return order;
  },
};
```

### Helper Functions

**createClassSerdes**

```typescript
function createClassSerdes<T>(cls: new () => T): Serdes<T>;

// Usage
const orderSerdes = createClassSerdes(Order);
```

**createClassSerdesWithDates**

```typescript
function createClassSerdesWithDates<T extends object>(
  cls: new () => T,
  dateProps: string[],
): Serdes<T>;

// Usage
class Order {
  id: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

const orderSerdes = createClassSerdesWithDates(Order, [
  "createdAt",
  "updatedAt",
]);
```

### External Storage Example

```typescript
function createS3Serdes<T>(
  bucketName: string,
  sizeThreshold: number = 256 * 1024,
): Serdes<T> {
  return {
    serialize: async (value: T | undefined, context?: SerdesContext) => {
      if (value === undefined) return undefined;

      const jsonData = JSON.stringify(value);
      if (jsonData.length <= sizeThreshold) {
        return jsonData;
      }

      const s3Key = `${context.durableExecutionArn}/${context.entityId}`;
      await s3Client.putObject({
        Bucket: bucketName,
        Key: s3Key,
        Body: jsonData,
      });

      return JSON.stringify({
        __s3Pointer: true,
        bucket: bucketName,
        key: s3Key,
      });
    },
    deserialize: async (data: string | undefined, context?: SerdesContext) => {
      if (data === undefined) return undefined;

      const parsed = JSON.parse(data);
      if (parsed.__s3Pointer) {
        const response = await s3Client.getObject({
          Bucket: parsed.bucket,
          Key: parsed.key,
        });
        return JSON.parse(await response.Body.transformToString());
      }
      return parsed;
    },
  };
}
```
