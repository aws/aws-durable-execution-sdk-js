import {
  Operation,
  Event,
  OperationType,
  OperationStatus,
  SendDurableExecutionCallbackSuccessResponse,
  ErrorObject,
  SendDurableExecutionCallbackFailureResponse,
  SendDurableExecutionCallbackHeartbeatResponse,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "@aws/durable-execution-sdk-js";
import { TestResultError } from "./durable-test-runner";

/**
 * Details for a context operation result, containing either a successful result or an error.
 * @public
 */
export interface ContextDetails<TResult = unknown> {
  /** The successful result of the context operation, if available */
  readonly result: TResult | undefined;
  /** The error that occurred during the context operation, if any */
  readonly error: TestResultError | undefined;
}

/**
 * Details for a step operation result, including retry information and outcome.
 * @public
 */
export interface StepDetails<TResult = unknown> {
  /** The current attempt number for this step operation */
  readonly attempt: number | undefined;
  /** The timestamp when the next attempt will be made, if retries are scheduled */
  readonly nextAttemptTimestamp: Date | undefined;
  /** The successful result of the step operation, if available */
  readonly result: TResult | undefined;
  /** The error that occurred during the step operation, if any */
  readonly error: TestResultError | undefined;
}

/**
 * Details for a callback operation result, including the callback identifier and outcome.
 * @public
 */
export interface CallbackDetails<TResult = unknown> {
  /** The unique identifier for the callback operation */
  readonly callbackId: string;
  /** The error that occurred during the callback operation, if any */
  readonly error?: TestResultError;
  /** The successful result of the callback operation, if available */
  readonly result?: TResult;
}

/**
 * Details for a chained invoke operation result.
 * @public
 */
export interface ChainedInvokeDetails<TResult = unknown> {
  /** The error that occurred during the chained invoke operation, if any */
  readonly error?: TestResultError;
  /** The successful result of the chained invoke operation, if available */
  readonly result?: TResult;
}

/**
 * Details for a wait operation, including duration and scheduling information.
 * @public
 */
export interface WaitResultDetails {
  /** The duration of the wait operation in seconds */
  readonly waitSeconds?: number;
  /** The timestamp when the wait operation is scheduled to complete */
  readonly scheduledEndTimestamp?: Date;
}

/**
 * An enum for different available waiting operation statuses.
 *
 * @example
 * ```typescript
 * const wait = runner.getOperation("my-wait")
 * const myWait = await wait.waitForData()
 * assert(myWait.getWaitDetails()?.waitSeconds === 10)
 * ```
 *
 * @example
 * ```typescript
 * const callback = runner.getOperation("my-callback")
 * const myCallback = await callback.waitForData(WaitingOperationStatus.SUBMITTED)
 * myCallback.sendCallbackSuccess("Hello World")
 * ```
 * @public
 */
export enum WaitingOperationStatus {
  /**
   * Fires when the operation starts.
   */
  STARTED = "STARTED",
  /**
   * Submitted is the same as COMPLETED, except for the case where the operation is waitForCallback.
   * In that case, SUBMITTED will fire when the waitForCallback submitter is completed.
   */
  SUBMITTED = "SUBMITTED",
  /**
   * Fires when the operation is completed. This includes a status of CANCELLED, FAILED, STOPPED,
   * SUCCEEDED, or TIMED_OUT.
   */
  COMPLETED = "COMPLETED",
}

/**
 * Interface for individual operation level interactions in durable executions.
 * Provides methods to inspect operation details, wait for data, and send callback responses.
 * @public
 */
export interface DurableOperation<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
> {
  /**
   * Wait for data for the current operation. If data is not found by the time
   * the execution completes, this function will throw an error.
   *
   * @example
   * ```typescript
   * const wait = runner.getOperation("my-wait")
   * const myWait = await wait.waitForData()
   * assert(myWait.getWaitDetails()?.waitSeconds === 10)
   * ```
   *
   * @example
   * ```typescript
   * const callback = runner.getOperation("my-callback")
   * const myCallback = await callback.waitForData(WaitingOperationStatus.SUBMITTED)
   * myCallback.sendCallbackSuccess("Hello World")
   * ```
   *
   * @param status - The operation status to wait for. Default value is STARTED
   * @returns A promise that resolves to this OperationWithData instance once the specified status is reached
   * @throws Will throw an error if data is not available when the execution completes
   */
  waitForData(
    status?: WaitingOperationStatus,
  ): Promise<DurableOperation<TResult>>;

  /**
   * Gets the details for a context operation.
   * @returns The context operation details, or undefined if no operation data is available
   * @throws Will throw an error if the operation type is not CONTEXT
   */
  getContextDetails(): ContextDetails<TResult> | undefined;

  /**
   * Gets the details for a step operation.
   * @returns The step operation details, or undefined if no operation data is available
   * @throws Will throw an error if the operation type is not STEP
   */
  getStepDetails(): StepDetails<TResult> | undefined;

  /**
   * Gets the details for a chained invoke operation.
   * @returns The chained invoke operation details, or undefined if no operation data is available
   * @throws Will throw an error if the operation type is not CHAINED_INVOKE
   */
  getChainedInvokeDetails(): ChainedInvokeDetails<TResult> | undefined;

  /**
   * Gets the details for a callback operation.
   * @returns The callback operation details, or undefined if no operation data is available
   * @throws Will throw an error if the operation is not a valid callback type
   */
  getCallbackDetails(): CallbackDetails<TResult> | undefined;

  /**
   * Gets the details for a wait operation.
   * @returns The wait operation details, or undefined if no operation data is available
   * @throws Will throw an error if the operation type is not WAIT or if wait event details are missing
   */
  getWaitDetails(): WaitResultDetails | undefined;

  /**
   * Gets all child operations of this operation.
   * @returns An array of child operations, or undefined if no operation data is available
   * @throws Will throw an error if the operation ID is not available
   */
  getChildOperations(): DurableOperation[] | undefined;

  /**
   * Gets the raw operation data.
   * @returns The operation data, or undefined if not available
   */
  getOperationData(): Operation | undefined;

  /**
   * Gets the events associated with this operation.
   * @returns An array of events, or undefined if not available
   */
  getEvents(): Event[] | undefined;

  /**
   * Gets the unique identifier of this operation.
   * @returns The operation ID, or undefined if not available
   */
  getId(): string | undefined;

  /**
   * Gets the unique identifier of the parent operation.
   * @returns The parent operation ID, or undefined if not available
   */
  getParentId(): string | undefined;

  /**
   * Gets the name of this operation.
   * @returns The operation name, or undefined if not available
   */
  getName(): string | undefined;

  /**
   * Gets the type of this operation.
   * @returns The operation type, or undefined if not available
   */
  getType(): OperationType | undefined;

  /**
   * Gets the subtype of this operation.
   * @returns The operation subtype, or undefined if not available
   */
  getSubType(): OperationSubType | undefined;

  /**
   * Checks if this operation is a wait-for-callback operation.
   * @returns True if this is a wait-for-callback operation, false otherwise
   */
  isWaitForCallback(): boolean;

  /**
   * Checks if this operation is a callback operation.
   * @returns True if this is a callback operation, false otherwise
   */
  isCallback(): boolean;

  /**
   * Gets the current status of this operation.
   * @returns The operation status, or undefined if not available
   */
  getStatus(): OperationStatus | undefined;

  /**
   * Gets the timestamp when this operation started.
   * @returns The start timestamp, or undefined if not available
   */
  getStartTimestamp(): Date | undefined;

  /**
   * Gets the timestamp when this operation ended.
   * @returns The end timestamp, or undefined if not available
   */
  getEndTimestamp(): Date | undefined;

  /**
   * Sends a successful callback result to the durable execution service.
   * @param result - Optional result data to send with the callback
   * @returns A promise that resolves to the callback success response
   * @throws Will throw an error if callback details are not available
   */
  sendCallbackSuccess(
    result?: string,
  ): Promise<SendDurableExecutionCallbackSuccessResponse>;

  /**
   * Sends a callback failure to the durable execution service.
   * @param error - Optional error object to send with the callback failure
   * @returns A promise that resolves to the callback failure response
   * @throws Will throw an error if callback details are not available
   */
  sendCallbackFailure(
    error?: ErrorObject,
  ): Promise<SendDurableExecutionCallbackFailureResponse>;

  /**
   * Sends a callback heartbeat to the durable execution service to keep the callback active.
   * @returns A promise that resolves to the callback heartbeat response
   * @throws Will throw an error if callback details are not available
   */
  sendCallbackHeartbeat(): Promise<SendDurableExecutionCallbackHeartbeatResponse>;
}
