// Main interface for customers to interface with for both the local
// and cloud-based test runners.

import {
  ErrorObject,
  OperationStatus,
  SendDurableExecutionCallbackFailureCommandOutput,
  SendDurableExecutionCallbackHeartbeatCommandOutput,
  SendDurableExecutionCallbackSuccessCommandOutput,
  Event,
  ExecutionStatus,
} from "@aws-sdk/client-lambda";
import { OperationWithData } from "./common/operations/operation-with-data";

export enum WaitingOperationStatus {
  STARTED = "STARTED",
  COMPLETED = "COMPLETED",
}

// TODO: use the real Lambda InvokeRequest parameters
export interface InvokeRequest {
  payload?: unknown;
}

export interface DurableTestRunner<
  T extends DurableOperation<unknown>,
  ResultType
> {
  // Run the durable execution and return the result/error.
  run(params?: InvokeRequest): Promise<TestResult<ResultType>>;

  // Methods to get the operation to assert on the operation result

  // Get the first operation with this name
  getOperation(name: string): T;
  // Get the operation called at this index.
  getOperationByIndex(index: number): T;
  // If a name is passed, get the operation by index filtered by name.
  getOperationByNameAndIndex(name: string, index: number): T;
  // Get the operation with this ID
  getOperationById(id: string): T;
  // Get the first operation with this path.
  // TODO: add when parallel/map are added
  // getOperationByPath(path: (string | number)[]): T;
}

// Interfaces for individual operation level interactions

export interface DurableOperation<Value> extends OperationWithData<Value> {
  waitForData(
    status?: WaitingOperationStatus
  ): Promise<DurableOperation<Value>>;

  // Callback APIs
  sendCallbackSuccess(
    result: string
  ): Promise<SendDurableExecutionCallbackSuccessCommandOutput>;
  sendCallbackFailure(
    error: ErrorObject
  ): Promise<SendDurableExecutionCallbackFailureCommandOutput>;
  sendCallbackHeartbeat(): Promise<SendDurableExecutionCallbackHeartbeatCommandOutput>;
}

// Interfaces available after the completion of the execution from the `run` method

export interface TestResultError {
  errorMessage: string | undefined;
  errorType: string | undefined;
  errorData: string | undefined;
  stackTrace: string[] | undefined;
}

export interface TestResult<T> {
  // Returns a list of all completed operations
  getOperations(params?: {
    // Filter by operation status (completed, failed, etc.)
    status: OperationStatus;
  }): OperationWithData[];

  // Description of the individual invocations to the Lambda handler.
  // Can be used to assert on the data for a specific invocation and validate
  // the number of invocations that were run.
  getInvocations(): Invocation[];

  /**
   * Gets the status of the execution.
   */
  getStatus(): ExecutionStatus | undefined;

  /**
   * Gets the result of the execution.
   * @throws The execution error if the execution failed.
   */
  getResult(): T | undefined;
  /**
   * Gets the error from an execution.
   * @throws An error if the execution succeeded.
   */
  getError(): TestResultError;

  /**
   * Returns the history events for the execution.
   */
  getHistoryEvents(): Event[]

  /**
   * Prints a table of all operations to the console with their details.
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

// Tracks a single invocation of the handler function
export interface Invocation {
  id: string;
  // Get completed steps in this invocation
  getOperations(params?: {
    status: OperationStatus;
  }): OperationWithData[];
}
