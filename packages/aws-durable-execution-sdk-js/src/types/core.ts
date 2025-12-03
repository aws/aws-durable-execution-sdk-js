import { TerminationManager } from "../termination-manager/termination-manager";
import { DurableExecutionClient } from "./durable-execution";
import { ErrorObject, Operation } from "@aws-sdk/client-lambda";

/**
 * @internal
 */
export enum DurableExecutionMode {
  ExecutionMode = "ExecutionMode",
  ReplayMode = "ReplayMode",
  ReplaySucceededContext = "ReplaySucceededContext",
}

/**
 * Input structure for durable execution invocations.
 *
 * This interface defines the payload structure that the durable execution service provides
 * to durable functions. It contains all the necessary information for the Durable
 * Execution Language SDK to:
 * - Manage checkpointing and state persistence
 * - Replay completed operations from previous state
 *
 * The input is automatically provided by the durable execution service and
 * contains both execution metadata and the operation history for replay.
 *
 * @public
 */
export interface DurableExecutionInvocationInput {
  /**
   * Amazon Resource Name (ARN) that uniquely identifies this durable execution instance.
   */
  DurableExecutionArn: string;

  /**
   * Unique token for the next checkpoint in this execution.
   *
   * This token:
   * - Ensures checkpoint operations are idempotent
   * - Prevents duplicate checkpoints
   * - Validates that checkpoint requests belong to the current execution cycle
   */
  CheckpointToken: string;

  /**
   * Execution state including operation history and pagination information.
   *
   * Contains the full context needed to resume execution including:
   * - All previously completed operations with their results
   * - Execution metadata and step identifiers
   * - Pagination markers for long operation histories
   */
  InitialExecutionState: {
    /**
     * Array of completed operations with their execution details and results.
     *
     * Each operation contains:
     * - Operation type and subtype (STEP, WAIT, CALLBACK, etc.)
     * - Unique operation identifier
     * - Output results
     * - Execution timestamps and status
     */
    Operations: Operation[];

    /**
     * Pagination marker for retrieving additional operation history if needed.
     *
     * Used when the operation history is too large to fit in a single response.
     * The Durable Execution Language SDK handles pagination automatically.
     */
    NextMarker: string;
  };
}

/**
 * Status enumeration for durable execution invocation results.
 *
 * This enum defines the possible outcomes of a durable execution invocation,
 * indicating whether the execution completed successfully, failed, or is
 * continuing asynchronously.
 *
 * The status determines how the AWS durable execution service will handle
 * the execution:
 * - SUCCEEDED: Execution completed successfully with a final result
 * - FAILED: Execution failed with an error that cannot be retried
 * - PENDING: Execution is continuing and will be resumed later (checkpointed)
 *
 * @public
 */
export enum InvocationStatus {
  /**
   * The durable execution completed successfully.
   *
   * This status indicates:
   * - A final result is available (if any)
   * - No further invocations are needed
   * - The execution has reached its natural completion
   */
  SUCCEEDED = "SUCCEEDED",

  /**
   * The durable execution failed with an unrecoverable error.
   *
   * This status indicates:
   * - An error occurred that cannot be automatically retried
   * - Error details are provided in the response
   * - No further invocations will occur
   */
  FAILED = "FAILED",

  /**
   * The durable execution is continuing asynchronously.
   *
   * This status indicates:
   * - Execution was checkpointed and will resume later
   * - Common scenarios: waiting for callbacks, retries, wait operations
   * - The function may terminate while execution continues
   * - Future invocations will resume from the checkpoint
   */
  PENDING = "PENDING",
}

/**
 * Operation subtype enumeration for categorizing different types of durable operations.
 *
 * This enum provides fine-grained classification of durable operations beyond the
 * basic operation types. Subtypes enable improved observability for specific
 * operation patterns.
 *
 * Each subtype corresponds to a specific durable context method or execution pattern.
 *
 * @public
 */
export enum OperationSubType {
  /**
   * A durable step operation (`context.step`).
   *
   * Represents atomic operations with automatic retry and checkpointing.
   * Steps are the fundamental building blocks of durable executions.
   */
  STEP = "Step",

  /**
   * A wait operation (`context.wait`).
   *
   * Represents time-based delays that pause execution for a specified duration.
   * Waits allow long-running workflows without keeping invocations active.
   */
  WAIT = "Wait",

  /**
   * A callback creation operation (`context.createCallback`).
   *
   * Represents the creation of a callback that external systems can complete.
   * Used for human-in-the-loop workflows and external system integration.
   */
  CALLBACK = "Callback",

  /**
   * A child context operation (`context.runInChildContext`).
   *
   * Represents execution within an isolated child context with its own
   * step counter and state tracking. Used for grouping related operations.
   */
  RUN_IN_CHILD_CONTEXT = "RunInChildContext",

  /**
   * A map operation (`context.map`).
   *
   * Represents parallel processing of an array of items with concurrency control
   * and completion policies. Each map operation coordinates multiple iterations.
   */
  MAP = "Map",

  /**
   * An individual iteration within a map operation.
   *
   * Represents the processing of a single item within a `context.map` call.
   * Each iteration runs in its own child context with isolated state.
   */
  MAP_ITERATION = "MapIteration",

  /**
   * A parallel execution operation (`context.parallel`).
   *
   * Represents concurrent execution of multiple branches with optional
   * concurrency control and completion policies.
   */
  PARALLEL = "Parallel",

  /**
   * An individual branch within a parallel operation.
   *
   * Represents a single branch of execution within a `context.parallel` call.
   * Each branch runs in its own child context with isolated state.
   */
  PARALLEL_BRANCH = "ParallelBranch",

  /**
   * A wait for callback operation (`context.waitForCallback`).
   *
   * Represents waiting for an external system to complete a callback,
   * combining callback creation with submission logic.
   */
  WAIT_FOR_CALLBACK = "WaitForCallback",

  /**
   * A wait for condition operation (`context.waitForCondition`).
   *
   * Represents periodic checking of a condition until it's met,
   * with configurable polling intervals and wait strategies.
   */
  WAIT_FOR_CONDITION = "WaitForCondition",

  /**
   * A chained invocation operation (`context.invoke`).
   *
   * Represents calling another durable function with input parameters
   * and waiting for its completion. Used for function composition and workflows.
   */
  CHAINED_INVOKE = "ChainedInvoke",
}

/**
 * Response structure for failed durable execution invocations.
 * @public
 */
interface DurableExecutionInvocationOutputFailed {
  /** Status indicating the execution failed */
  Status: InvocationStatus.FAILED;
  /** Error object containing failure details and stack trace */
  Error: ErrorObject;
}

/**
 * Response structure for successfully completed durable execution invocations.
 * @public
 */
interface DurableExecutionInvocationOutputSucceeded {
  /** Status indicating successful completion */
  Status: InvocationStatus.SUCCEEDED;
  /** Optional serialized result from the execution (undefined for void results) */
  Result?: string;
}

/**
 * Response structure for durable execution invocations that are continuing asynchronously.
 * @public
 */
interface DurableExecutionInvocationOutputPending {
  /** Status indicating the execution is pending and will be resumed later */
  Status: InvocationStatus.PENDING;
}

/**
 * Union type representing all possible output formats for durable execution invocations.
 *
 * This type defines the complete response structure that durable functions return
 * to the AWS Durable Execution service. The response format varies based on the
 * execution outcome:
 *
 * **Successful Completion (`SUCCEEDED`):**
 * - Contains the final execution result (if any) as a serialized string
 * - Indicates the execution has completed and no further invocations are needed
 * - The Result field may be undefined for void functions or large results that were checkpointed
 *
 * **Execution Failure (`FAILED`):**
 * - Contains structured error information including message and stack trace
 * - Indicates an unrecoverable error that terminates the execution
 * - No further automatic retries will occur
 *
 * **Continued Execution (`PENDING`):**
 * - Indicates the execution is continuing asynchronously
 * - Common for operations involving waits, callbacks, or retries
 * - The execution will be resumed in a future invocation
 *
 * The durable execution service uses this response to determine next steps:
 * - Schedule continuation for PENDING status
 * - Complete the execution for SUCCEEDED status
 * - Complete the execution for FAILED status
 *
 * @public
 */
export type DurableExecutionInvocationOutput =
  | DurableExecutionInvocationOutputSucceeded
  | DurableExecutionInvocationOutputFailed
  | DurableExecutionInvocationOutputPending;

/**
 * Type representing time durations for durable execution operations, such as
 * `wait`, `retry`, and `timeout` options.
 *
 * **Supported Units:**
 * - `days`: Number of days
 * - `hours`: Number of hours
 * - `minutes`: Number of minutes
 * - `seconds`: Number of seconds
 *
 * **Usage Rules:**
 * - At least one time unit must be specified
 * - All numeric values must be positive integers
 * - Fractional values are not supported
 *
 * @example
 * ```typescript
 * // Wait for 30 seconds
 * await context.wait({ seconds: 30 });
 * ```
 *
 * @public
 */
export type Duration =
  | { days: number; hours?: number; minutes?: number; seconds?: number }
  | { hours: number; minutes?: number; seconds?: number }
  | { minutes: number; seconds?: number }
  | { seconds: number };

/**
 * @internal
 */
export interface ExecutionContext {
  durableExecutionClient: DurableExecutionClient;
  _stepData: Record<string, Operation>; // Private, use getStepData() instead
  terminationManager: TerminationManager;
  durableExecutionArn: string;

  requestId: string;
  tenantId: string | undefined;
  pendingCompletions: Set<string>; // Track stepIds with pending SUCCEED/FAIL
  getStepData(stepId: string): Operation | undefined;
}
