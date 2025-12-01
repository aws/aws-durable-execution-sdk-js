// Main interface for customers to interface with for both the local
// and cloud-based test runners.

import {
  OperationStatus,
  Event,
  ExecutionStatus,
} from "@aws-sdk/client-lambda";
import { DurableOperation } from "./durable-operation";

/**
 * Request parameters for invoking a durable function.
 * @public
 */
export interface InvokeRequest {
  /** Optional payload to send to the durable function */
  payload?: unknown;
}

/**
 * Main interface for durable function test runners.
 * Provides methods to run durable executions and retrieve operations for testing.
 *
 * @typeParam TDurableOperation - The type of operations returned by this test runner
 * @typeParam ResultType - The expected result type of the durable function
 * @public
 */
export interface DurableTestRunner<
  TDurableOperation extends DurableOperation,
  ResultType,
> {
  /**
   * Runs the durable execution and returns the test result.
   *
   * @param params - Optional parameters for the function invocation
   * @returns A promise that resolves to the test result containing function output and operation history
   */
  run(params?: InvokeRequest): Promise<TestResult<ResultType>>;

  /**
   * Gets the first operation with the specified name.
   *
   * @param name - The name of the operation to retrieve
   * @returns An operation instance that can be used to inspect operation details
   */
  getOperation(name: string): TDurableOperation;

  /**
   * Gets an operation by its execution order index.
   *
   * @param index - The zero-based index of the operation in execution order
   * @returns An operation instance for the operation at the specified index
   */
  getOperationByIndex(index: number): TDurableOperation;

  /**
   * Gets an operation by name and index when multiple operations have the same name.
   *
   * @param name - The name of the operation
   * @param index - The zero-based index among operations with the same name
   * @returns An operation instance for the specified named operation occurrence
   */
  getOperationByNameAndIndex(name: string, index: number): TDurableOperation;

  /**
   * Gets an operation by its unique identifier.
   *
   * @param id - The unique identifier of the operation
   * @returns An operation instance for the operation with the specified ID
   */
  getOperationById(id: string): TDurableOperation;
}

/**
 * Error information from a test execution or operation.
 * @public
 */
export interface TestResultError {
  /** The error message, if available */
  errorMessage: string | undefined;
  /** The type/category of the error, if available */
  errorType: string | undefined;
  /** Additional error data in string format, if available */
  errorData: string | undefined;
  /** Stack trace lines from the error, if available */
  stackTrace: string[] | undefined;
}

/**
 * Result of a durable function test execution.
 * Contains the function result, operation history, and methods to inspect the execution.
 *
 * @typeParam TResult - The expected result type of the durable function
 * @public
 */
export interface TestResult<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
> {
  /**
   * Gets a list of all operations from the execution.
   *
   * @param params - Optional filter parameters
   * @returns An array of operations that occurred during the execution
   */
  getOperations(params?: { status: OperationStatus }): DurableOperation[];

  /**
   * Gets informatiAn about individual Lambda handler invocations.
   *
   * Can be used to assert on the data for a specific invocation and validate
   * the number of invocations that were run during the durable execution.
   *
   * @returns An array of invocation details
   */
  getInvocations(): Invocation[];

  /**
   * Gets the status of the durable execution.
   *
   * @returns The execution status, or undefined if not available
   */
  getStatus(): ExecutionStatus | undefined;

  /**
   * Gets the final result of the durable execution.
   *
   * @returns The execution result, or undefined if not available
   * @throws Will throw the execution error if the execution failed
   */
  getResult(): TResult | undefined;

  /**
   * Gets the error from a failed durable execution.
   *
   * @returns The execution error details
   * @throws Will throw an error if the execution succeeded
   */
  getError(): TestResultError;

  /**
   * Gets the complete history of events for the durable execution.
   *
   * @returns An array of all events that occurred during the execution
   */
  getHistoryEvents(): Event[];

  /**
   * Prints a formatted table of all operations to the console with their details.
   *
   * @param config - Optional configuration to control which columns to display
   */
  print(config?: {
    parentId?: boolean;
    name?: boolean;
    type?: boolean;
    subType?: boolean;
    status?: boolean;
    startTime?: boolean;
    endTime?: boolean;
    duration?: boolean;
  }): void;
}

/**
 * Tracks a single invocation of the durable function handler.
 * Contains timing information, request ID, and any errors that occurred.
 * @public
 */
export interface Invocation {
  /** The timestamp when the handler invocation started */
  startTimestamp: Date | undefined;
  /** The timestamp when the handler invocation ended */
  endTimestamp: Date | undefined;
  /** The AWS request ID for this invocation */
  requestId: string | undefined;
  /** Error information if the invocation failed */
  error: TestResultError | undefined;
}
