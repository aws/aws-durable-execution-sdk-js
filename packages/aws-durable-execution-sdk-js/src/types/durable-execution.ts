// Type-only: `LambdaClient` appears in the public `DurableExecutionConfig.client`
// signature so callers can inject a configured client. Importing it as a type keeps
// `@aws-sdk/client-lambda` out of the runtime graph for this module.
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "./wire";
import { DurableContext } from "./durable-context";
import { DurableLogger } from "./durable-logger";
import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "./core";
import { DurableInstrumentationPlugin } from "./plugin";

/**
 * A handler function type for a durable execution that provides automatic state persistence,
 * retry logic, and workflow orchestration capabilities.
 *
 * This handler type is the core interface for building stateful, long-running AWS Durable Executions
 * using the Durable Execution SDK. The handler receives a durable context that enables:
 * - Step-based execution with automatic checkpointing and replay
 * - Built-in retry strategies with exponential backoff and jitter
 * - Workflow orchestration with parallel execution and child contexts
 * - External system integration via callbacks and conditional waiting
 * - Batch operations with concurrency control
 *
 * This handler function must be wrapped by `withDurableExecution()` to enable
 * durable execution capabilities. During replay scenarios, the handler function is re-executed,
 * however the durable context operations that already completed(steps, waits, callbacks, etc.) are
 * not re-executed.
 *
 * @typeParam TEvent - The type of the input event payload (defaults to any)
 * @typeParam TResult - The type of the return value (defaults to any)
 * @typeParam TLogger - The type of a custom logger implementation (defaults to DurableLogger)
 *
 * @param event - The parsed JSON input event data for the invocation
 * @param context - The durable context providing methods for durable operations like steps,
 *                  waits, parallel execution, external callbacks, and workflow orchestration
 *
 * @returns A promise that resolves with the handler's result value or rejects with an
 *          execution error. The result will be automatically serialized and may be
 *          checkpointed if it exceeds response size limits.
 *
 * @example
 * ```typescript
 * const durableHandler: DurableExecutionHandler<{ userId: string }, { status: string }> = async (event, context) => {
 *   // Execute durable step with automatic retry and checkpointing
 *   const user = await context.step("fetch-user", async () =>
 *     fetchUserFromDB(event.userId)
 *   );
 *
 *   // Wait for external callback (e.g., manual approval)
 *   const approval = await context.waitForCallback("approval", async (callbackId) => {
 *     await sendApprovalRequest(callbackId, user);
 *   });
 *
 *   // Process in parallel with concurrency control
 *   const results = await context.parallel("parallel-tasks", [
 *     async (ctx) => ctx.step("task1", () => processTask1(user)),
 *     async (ctx) => ctx.step("task2", () => processTask2(user))
 *   ]);
 *
 *   return { status: "completed" };
 * };
 *
 * export const handler = withDurableExecution(durableHandler);
 * ```
 *
 * @public
 */
export type DurableExecutionHandler<
  TEvent = any,
  TResult = any,
  TLogger extends DurableLogger = DurableLogger,
> = (event: TEvent, context: DurableContext<TLogger>) => Promise<TResult>;

/**
 * Configuration options for durable execution setup.
 *
 * This interface allows customization of the durable execution runtime behavior,
 * primarily for dependency injection and testing scenarios. In most production
 * use cases, the default configuration is sufficient.
 *
 * @public
 */
export interface DurableExecutionConfig {
  /**
   * Optional custom AWS Lambda client instance for durable execution operations.
   *
   * @deprecated Use {@link DurableExecutionConfig.durableExecutionClient} instead, which
   * accepts any transport rather than only a Lambda client. To keep the Lambda transport
   * with your own client, hand it to {@link DurableExecutionApiClient}:
   *
   * ```typescript
   * // Before
   * withDurableExecution(handler, { client: myLambdaClient });
   *
   * // After
   * withDurableExecution(handler, {
   *   durableExecutionClient: new DurableExecutionApiClient(myLambdaClient),
   * });
   * ```
   *
   * This property will be removed in the next major version. It is the last place the AWS
   * SDK appears in the SDK's public type surface, and durable functions are being extended
   * to compute types other than Lambda, where a `LambdaClient` has no meaning.
   *
   * When provided, this client will be used for all AWS Lambda service calls including
   * checkpoint operations and execution state management. This is useful for:
   * - Custom AWS configurations (regions, credentials, endpoints)
   * - Testing with mocked Lambda clients
   * - Advanced networking configurations (VPC endpoints, proxies)
   * - Custom retry and timeout configurations
   *
   * If not provided, a default Lambda client will be created automatically using
   * the standard AWS SDK configuration chain (environment variables, IAM roles, etc.).
   */
  client?: LambdaClient;

  /**
   * Optional transport used to read execution state and write checkpoints.
   *
   * Supplying one replaces the SDK's own transport entirely. {@link DurableExecutionClient}
   * is compute-neutral — it names no AWS types in its parameters or results — so an
   * implementation can talk to any backend that provides the same two operations.
   *
   * Leave it unset for the default behaviour: the SDK uses
   * {@link DurableExecutionApiClient}, which calls the Lambda durable execution APIs and
   * creates its own client. To keep that transport but configure the underlying client
   * yourself, construct it explicitly rather than using the deprecated
   * {@link DurableExecutionConfig.client}:
   *
   * ```typescript
   * withDurableExecution(handler, {
   *   durableExecutionClient: new DurableExecutionApiClient(
   *     new LambdaClient({ region: "us-west-2", maxAttempts: 5 }),
   *   ),
   * });
   * ```
   *
   * An implementation should throw {@link DurableExecutionClientError} to tell the SDK
   * whether a failure ends only the current invocation or the whole execution. Without
   * that, every failure is treated as transient and a permanent one is retried until the
   * execution times out.
   *
   * A stated scope is believed, and is checked before the SDK inspects the error's shape.
   * A transport that wraps another one therefore takes over responsibility for classifying
   * the errors it wraps: wrapping an AWS error as INVOCATION scope suppresses the
   * heuristics that would otherwise recognize it — for example a KMS misconfiguration,
   * which arrives as a 502 but can never succeed on retry — and it will be retried until
   * the execution times out. Either classify wrapped errors deliberately, or let them
   * through unwrapped so the existing heuristics still apply.
   *
   * Supplying both this and {@link DurableExecutionConfig.client} is a configuration error
   * and fails the execution before the handler runs, because the two contradict each other.
   */
  durableExecutionClient?: DurableExecutionClient;

  /**
   * Optional array of instrumentation plugins for observability and tracing.
   *
   * Plugins receive lifecycle callbacks at key points during durable execution,
   * enabling integration with tracing systems (e.g., OpenTelemetry, X-Ray),
   * custom metrics, and logging enrichment.
   *
   * Multiple plugins can be provided and will be called in order. Plugin errors
   * are swallowed to prevent instrumentation from affecting execution correctness.
   *
   * @example
   * ```typescript
   * import { withDurableExecution } from '@aws/durable-execution-sdk-js';
   * import { myTracingPlugin } from './tracing';
   *
   * export const handler = withDurableExecution(myHandler, {
   *   plugins: [myTracingPlugin]
   * });
   * ```
   *
   * @experimental This parameter is experimental and may be changed or removed in future releases.
   */
  plugins?: DurableInstrumentationPlugin[];

  /**
   * Execution-level settings that affect how instrumentation plugins observe
   * the run.
   *
   * @experimental This parameter is experimental and may be changed or removed in future releases.
   */
  pluginsConfig?: {
    /**
     * How many nested levels of child-context operations to **preserve across
     * suspend/resume** so instrumentation plugins can observe the full
     * operation tree.
     *
     * By default, when a parent context finishes the backend prunes its child
     * operations from the state handed to later invocations (a performance
     * optimization). As a result, a snapshot taken in a *later* invocation
     * (e.g. after a `wait`) will only contain top-level operations — the
     * children of already-finished contexts are gone. This setting keeps them.
     *
     * Counting (children of the top level = 1):
     * - `undefined` / `0` — preserve nothing extra (default; top-level only).
     * - `1` — keep the direct children of top-level contexts (e.g. map items,
     *   parallel branches).
     * - `2` — also keep their children (e.g. the steps inside each map item).
     * - `Infinity` — keep the entire tree.
     *
     * Must be a non-negative integer or `Infinity`; any other value (negative,
     * fractional, or `NaN`) is a configuration error that **fails the execution
     * immediately** — before the handler runs — rather than being silently
     * ignored.
     *
     * Depth is counted over the **visible operation tree**: virtual wrapper
     * contexts created by map/parallel with FLAT nesting don't checkpoint and
     * their children re-parent onto the ancestor, so they are transparent to
     * this count (they don't consume a level).
     *
     * Applies to both **succeeded and failed** contexts (a failed branch's
     * children are often the most useful to inspect). A failed context still
     * throws its checkpointed error on replay and is never re-executed, so
     * preserving its children adds no replay cost.
     *
     * ⚠️ **Cost:** preservation is implemented by forcing the SDK's
     * `ReplayChildren` mode on each preserved context. This keeps that
     * context's child operations in the execution state (they aren't pruned
     * when the context finishes) and, on replay, rebuilds the context's result
     * by **replaying** those already-checkpointed children — i.e. the context's
     * orchestration code re-runs, but the children themselves are **not**
     * re-executed: steps and other durable operations inside the context return
     * their checkpointed results, so no step body or side effect runs again.
     * The added cost is therefore an extra replay pass over each preserved
     * context (re-running its orchestration and deserializing its children)
     * plus carrying those children in the execution state — it grows with the
     * number of preserved contexts and the depth requested, and is **not** a
     * re-doing of the children's work. Enable only the depth you actually need.
     *
     * @experimental
     */
    childOperationsDepth?: number;
  };
}

/**
 * Client interface for durable execution backend operations.
 *
 * This interface defines the core operations needed to manage durable execution state
 * and checkpoints. It abstracts the underlying service calls and provides
 * a clean contract for:
 * - Retrieving execution state during replay scenarios
 * - Creating checkpoints for state persistence
 * - Managing long-running workflow state
 *
 * Implementations of this interface handle the communication with AWS services to
 * ensure durable execution capabilities including automatic retry, state recovery,
 * and workflow orchestration.
 *
 * @public
 */
export interface DurableExecutionClient {
  /**
   * Retrieves the current execution state for a durable execution.
   *
   * This method fetches the persisted state data from the durable execution backend,
   * including step history, checkpoint data, and execution metadata. It's primarily
   * used during replay scenarios to restore the execution context and determine
   * which operations have already been completed.
   *
   * The execution state contains all information needed to resume a durable function
   * from where it left off, enabling fault tolerance and long-running workflows.
   *
   * @param params - Request parameters including execution ARN and state identifiers
   * @param logger - Optional logger instance for operation logging and debugging
   *
   * @returns Promise resolving to the execution state response containing step history,
   *          checkpoint data, and execution metadata
   *
   * @throws Will throw an error if the execution state cannot be retrieved due to
   *         network issues, authentication problems, or invalid execution ARN
   */
  getExecutionState(
    params: GetDurableExecutionStateRequest,
    logger?: DurableLogger,
  ): Promise<GetDurableExecutionStateResponse>;

  /**
   * Creates a checkpoint to persist the current execution state.
   *
   * This method saves the current execution progress, step results, and context data
   * to enable recovery and replay capabilities. Checkpoints are created automatically
   * at key points during execution (after steps complete, before waits, etc.) and
   * can also be triggered manually for custom persistence needs.
   *
   * Checkpointing enables:
   * - Automatic recovery from timeouts or failures
   * - Resumption of long-running workflows
   * - Replay semantics for consistent execution
   * - State persistence across execution boundaries
   *
   * @param params - Checkpoint request parameters including execution data and metadata
   * @param logger - Optional logger instance for operation logging and debugging
   *
   * @returns Promise resolving to the checkpoint response with confirmation and metadata
   *
   * @throws Will throw an error if the checkpoint cannot be created due to network issues,
   *         authentication problems, or storage limitations
   */
  checkpoint(
    params: CheckpointDurableExecutionRequest,
    logger?: DurableLogger,
  ): Promise<CheckpointDurableExecutionResponse>;
}

/**
 * The handler type returned by `withDurableExecution()` that handles durable execution behaviour.
 *
 * This handler type represents the final lambda function that gets deployed and invoked by the Durable
 * Execution service.
 *
 * The handler receives `DurableExecutionInvocationInput` containing execution metadata, checkpoint tokens,
 * and operation history, then returns `DurableExecutionInvocationOutput` with execution status and results.
 *
 * @example
 * ```typescript
 * // Define your durable handler
 * const myHandler: DurableExecutionHandler<MyEvent, MyResult> = async (event, context) => {
 *   const result = await context.step("process", async () => processEvent(event));
 *   return result;
 * };
 *
 * // Wrap it to create a DurableLambdaHandler
 * export const handler: DurableLambdaHandler = withDurableExecution(myHandler);
 *
 * // Deploy this handler - it will receive DurableExecutionInvocationInput
 * // and handle all the durability management automatically
 * ```
 *
 * @public
 */
export type DurableLambdaHandler = (
  event: DurableExecutionInvocationInput,
  context: Context,
) => Promise<DurableExecutionInvocationOutput>;
