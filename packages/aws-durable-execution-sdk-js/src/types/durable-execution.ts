import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { DurableContext } from "./durable-context";
import { DurableLogger } from "./durable-logger";
import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "./core";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEvent = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
   * When provided, this client will be used for all AWS Lambda service calls including
   * checkpoint operations and execution state management. This is useful for:
   * - Custom AWS configurations (regions, credentials, endpoints)
   * - Testing with mocked Lambda clients
   * - Advanced networking configurations (VPC endpoints, proxies)
   * - Custom retry and timeout configurations
   *
   * If not provided, a default Lambda client will be created automatically using
   * the standard AWS SDK configuration chain (environment variables, IAM roles, etc.).
   *
   * @example
   * ```typescript
   * import { LambdaClient } from '@aws-sdk/client-lambda';
   *
   * const customClient = new LambdaClient({
   *   region: 'us-west-2',
   *   maxAttempts: 5,
   *   retryMode: 'adaptive'
   * });
   *
   * export const handler = withDurableExecution(myHandler, {
   *   client: customClient
   * });
   * ```
   */
  client?: LambdaClient;
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
