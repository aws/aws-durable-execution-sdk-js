import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { ExceptionOptionType as __ExceptionOptionType } from "@smithy/smithy-client";
/**
 * @public
 */
export interface ErrorObject {
  ErrorMessage?: string | undefined;
  ErrorType?: string | undefined;
  ErrorData?: string | undefined;
  StackTrace?: string[] | undefined;
}
/**
 * @internal
 */
export declare const ErrorObjectFilterSensitiveLog: (obj: ErrorObject) => any;
/**
 * @public
 */
export interface CallbackDetails {
  CallbackId?: string | undefined;
  Result?: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const CallbackDetailsFilterSensitiveLog: (
  obj: CallbackDetails,
) => any;
/**
 * @public
 */
export interface EventError {
  Payload?: ErrorObject | undefined;
  Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventErrorFilterSensitiveLog: (obj: EventError) => any;
/**
 * @public
 */
export interface RetryDetails {
  CurrentAttempt?: number | undefined;
  NextAttemptDelaySeconds?: number | undefined;
}
/**
 * @public
 */
export interface CallbackFailedDetails {
  Error?: EventError | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackFailedDetailsFilterSensitiveLog: (
  obj: CallbackFailedDetails,
) => any;
/**
 * @public
 */
export interface CallbackOptions {
  TimeoutSeconds?: number | undefined;
  HeartbeatTimeoutSeconds?: number | undefined;
}
/**
 * @public
 */
export interface EventInput {
  Payload?: string | undefined;
  Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventInputFilterSensitiveLog: (obj: EventInput) => any;
/**
 * @public
 */
export interface CallbackStartedDetails {
  CallbackId?: string | undefined;
  Input?: EventInput | undefined;
  HeartbeatTimeout?: number | undefined;
  Timeout?: number | undefined;
}
/**
 * @internal
 */
export declare const CallbackStartedDetailsFilterSensitiveLog: (
  obj: CallbackStartedDetails,
) => any;
/**
 * @public
 */
export interface EventResult {
  Payload?: string | undefined;
  Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventResultFilterSensitiveLog: (obj: EventResult) => any;
/**
 * @public
 */
export interface CallbackSucceededDetails {
  Result?: EventResult | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackSucceededDetailsFilterSensitiveLog: (
  obj: CallbackSucceededDetails,
) => any;
/**
 * @public
 */
export interface CallbackTimedOutDetails {
  Error?: EventError | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackTimedOutDetailsFilterSensitiveLog: (
  obj: CallbackTimedOutDetails,
) => any;
/**
 * @public
 */
export declare class CallbackTimeoutException extends __BaseException {
  readonly name: "CallbackTimeoutException";
  readonly $fault: "client";
  /**
   * @internal
   */
  constructor(
    opts: __ExceptionOptionType<CallbackTimeoutException, __BaseException>,
  );
}
/**
 * @public
 * @enum
 */
export declare const OperationAction: {
  readonly CANCEL: "CANCEL";
  readonly FAIL: "FAIL";
  readonly RETRY: "RETRY";
  readonly START: "START";
  readonly SUCCEED: "SUCCEED";
};
/**
 * @public
 */
export type OperationAction =
  (typeof OperationAction)[keyof typeof OperationAction];
/**
 * @public
 */
export interface ContextOptions {
  ReplayChildren?: boolean | undefined;
}
/**
 * @public
 */
export interface InvokeOptions {
  FunctionName?: string | undefined;
  FunctionQualifier?: string | undefined;
  DurableExecutionName?: string | undefined;
}
/**
 * @public
 */
export interface StepOptions {
  NextAttemptDelaySeconds?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const OperationType: {
  readonly CALLBACK: "CALLBACK";
  readonly CONTEXT: "CONTEXT";
  readonly EXECUTION: "EXECUTION";
  readonly INVOKE: "INVOKE";
  readonly STEP: "STEP";
  readonly WAIT: "WAIT";
};
/**
 * @public
 */
export type OperationType = (typeof OperationType)[keyof typeof OperationType];
/**
 * @public
 */
export interface WaitOptions {
  WaitSeconds?: number | undefined;
}
/**
 * @public
 */
export interface OperationUpdate {
  Id?: string | undefined;
  ParentId?: string | undefined;
  Name?: string | undefined;
  Type?: OperationType | undefined;
  SubType?: string | undefined;
  Action?: OperationAction | undefined;
  Payload?: string | undefined;
  Error?: ErrorObject | undefined;
  ContextOptions?: ContextOptions | undefined;
  StepOptions?: StepOptions | undefined;
  WaitOptions?: WaitOptions | undefined;
  CallbackOptions?: CallbackOptions | undefined;
  InvokeOptions?: InvokeOptions | undefined;
}
/**
 * @internal
 */
export declare const OperationUpdateFilterSensitiveLog: (
  obj: OperationUpdate,
) => any;
/**
 * @public
 */
export interface CheckpointDurableExecutionRequest {
  CheckpointToken: string | undefined;
  Updates?: OperationUpdate[] | undefined;
  ClientToken?: string | undefined;
}
/**
 * @internal
 */
export declare const CheckpointDurableExecutionRequestFilterSensitiveLog: (
  obj: CheckpointDurableExecutionRequest,
) => any;
/**
 * @public
 */
export interface ContextDetails {
  ReplayChildren?: boolean | undefined;
  Result?: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const ContextDetailsFilterSensitiveLog: (
  obj: ContextDetails,
) => any;
/**
 * @public
 */
export interface ExecutionDetails {
  InputPayload?: string | undefined;
}
/**
 * @internal
 */
export declare const ExecutionDetailsFilterSensitiveLog: (
  obj: ExecutionDetails,
) => any;
/**
 * @public
 */
export interface InvokeDetails {
  DurableExecutionArn?: string | undefined;
  Result?: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const InvokeDetailsFilterSensitiveLog: (
  obj: InvokeDetails,
) => any;
/**
 * @public
 * @enum
 */
export declare const OperationStatus: {
  readonly CANCELLED: "CANCELLED";
  readonly FAILED: "FAILED";
  readonly PENDING: "PENDING";
  readonly READY: "READY";
  readonly STARTED: "STARTED";
  readonly STOPPED: "STOPPED";
  readonly SUCCEEDED: "SUCCEEDED";
  readonly TIMED_OUT: "TIMED_OUT";
};
/**
 * @public
 */
export type OperationStatus =
  (typeof OperationStatus)[keyof typeof OperationStatus];
/**
 * @public
 */
export interface StepDetails {
  Attempt?: number | undefined;
  NextAttemptTimestamp?: Date | undefined;
  Result?: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const StepDetailsFilterSensitiveLog: (obj: StepDetails) => any;
/**
 * @public
 */
export interface WaitDetails {
  ScheduledTimestamp?: Date | undefined;
}
/**
 * @public
 */
export interface Operation {
  Id?: string | undefined;
  ParentId?: string | undefined;
  Name?: string | undefined;
  Type?: OperationType | undefined;
  SubType?: string | undefined;
  StartTimestamp?: Date | undefined;
  EndTimestamp?: Date | undefined;
  Status?: OperationStatus | undefined;
  ExecutionDetails?: ExecutionDetails | undefined;
  ContextDetails?: ContextDetails | undefined;
  StepDetails?: StepDetails | undefined;
  WaitDetails?: WaitDetails | undefined;
  CallbackDetails?: CallbackDetails | undefined;
  InvokeDetails?: InvokeDetails | undefined;
}
/**
 * @internal
 */
export declare const OperationFilterSensitiveLog: (obj: Operation) => any;
/**
 * @public
 */
export interface CheckpointUpdatedExecutionState {
  Operations?: Operation[] | undefined;
  NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const CheckpointUpdatedExecutionStateFilterSensitiveLog: (
  obj: CheckpointUpdatedExecutionState,
) => any;
/**
 * @public
 */
export interface CheckpointDurableExecutionResponse {
  CheckpointToken?: string | undefined;
  NewExecutionState?: CheckpointUpdatedExecutionState | undefined;
}
/**
 * @internal
 */
export declare const CheckpointDurableExecutionResponseFilterSensitiveLog: (
  obj: CheckpointDurableExecutionResponse,
) => any;
/**
 * @public
 */
export declare class InvalidParameterValueException extends __BaseException {
  readonly name: "InvalidParameterValueException";
  readonly $fault: "client";
  Type?: string | undefined;
  /**
   * @internal
   */
  constructor(
    opts: __ExceptionOptionType<
      InvalidParameterValueException,
      __BaseException
    >,
  );
}
/**
 * @public
 */
export declare class ServiceException extends __BaseException {
  readonly name: "ServiceException";
  readonly $fault: "server";
  Type?: string | undefined;
  Message?: string | undefined;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<ServiceException, __BaseException>);
}
/**
 * @public
 * @enum
 */
export declare const ThrottleReason: {
  readonly CallerRateLimitExceeded: "CallerRateLimitExceeded";
  readonly ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded";
  readonly ConcurrentSnapshotCreateLimitExceeded: "ConcurrentSnapshotCreateLimitExceeded";
  readonly FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded";
  readonly ReservedFunctionConcurrentInvocationLimitExceeded: "ReservedFunctionConcurrentInvocationLimitExceeded";
  readonly ReservedFunctionInvocationRateLimitExceeded: "ReservedFunctionInvocationRateLimitExceeded";
};
/**
 * @public
 */
export type ThrottleReason =
  (typeof ThrottleReason)[keyof typeof ThrottleReason];
/**
 * @public
 */
export declare class TooManyRequestsException extends __BaseException {
  readonly name: "TooManyRequestsException";
  readonly $fault: "client";
  retryAfterSeconds?: string | undefined;
  Type?: string | undefined;
  Reason?: ThrottleReason | undefined;
  /**
   * @internal
   */
  constructor(
    opts: __ExceptionOptionType<TooManyRequestsException, __BaseException>,
  );
}
/**
 * @public
 */
export interface ContextFailedDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ContextFailedDetailsFilterSensitiveLog: (
  obj: ContextFailedDetails,
) => any;
/**
 * @public
 */
export interface ContextStartedDetails {}
/**
 * @public
 */
export interface ContextSucceededDetails {
  Result?: EventResult | undefined;
}
/**
 * @internal
 */
export declare const ContextSucceededDetailsFilterSensitiveLog: (
  obj: ContextSucceededDetails,
) => any;
/**
 * @public
 * @enum
 */
export declare const ExecutionStatus: {
  readonly FAILED: "FAILED";
  readonly RUNNING: "RUNNING";
  readonly STOPPED: "STOPPED";
  readonly SUCCEEDED: "SUCCEEDED";
  readonly TIMED_OUT: "TIMED_OUT";
};
/**
 * @public
 */
export type ExecutionStatus =
  (typeof ExecutionStatus)[keyof typeof ExecutionStatus];
/**
 * @public
 */
export interface Execution {
  DurableExecutionArn?: string | undefined;
  DurableExecutionName?: string | undefined;
  FunctionArn?: string | undefined;
  Status?: ExecutionStatus | undefined;
  StartDate?: Date | undefined;
  StopDate?: Date | undefined;
}
/**
 * @public
 */
export interface GetDurableExecutionRequest {
  DurableExecutionArn: string | undefined;
}
/**
 * @public
 */
export interface GetDurableExecutionResponse {
  DurableExecutionArn?: string | undefined;
  DurableExecutionName?: string | undefined;
  FunctionArn?: string | undefined;
  InputPayload?: string | undefined;
  Result?: string | undefined;
  Error?: ErrorObject | undefined;
  StartDate?: Date | undefined;
  Status?: ExecutionStatus | undefined;
  StopDate?: Date | undefined;
  Version?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionResponseFilterSensitiveLog: (
  obj: GetDurableExecutionResponse,
) => any;
/**
 * @public
 */
export declare class ResourceNotFoundException extends __BaseException {
  readonly name: "ResourceNotFoundException";
  readonly $fault: "client";
  Type?: string | undefined;
  Message?: string | undefined;
  /**
   * @internal
   */
  constructor(
    opts: __ExceptionOptionType<ResourceNotFoundException, __BaseException>,
  );
}
/**
 * @public
 */
export interface GetDurableExecutionHistoryRequest {
  DurableExecutionArn: string | undefined;
  IncludeExecutionData?: boolean | undefined;
  MaxItems?: number | undefined;
  Marker?: string | undefined;
  ReverseOrder?: boolean | undefined;
}
/**
 * @public
 * @enum
 */
export declare const EventType: {
  readonly CallbackFailed: "CallbackFailed";
  readonly CallbackStarted: "CallbackStarted";
  readonly CallbackSucceeded: "CallbackSucceeded";
  readonly CallbackTimedOut: "CallbackTimedOut";
  readonly ContextFailed: "ContextFailed";
  readonly ContextStarted: "ContextStarted";
  readonly ContextSucceeded: "ContextSucceeded";
  readonly ExecutionFailed: "ExecutionFailed";
  readonly ExecutionStarted: "ExecutionStarted";
  readonly ExecutionStopped: "ExecutionStopped";
  readonly ExecutionSucceeded: "ExecutionSucceeded";
  readonly ExecutionTimedOut: "ExecutionTimedOut";
  readonly InvokeCancelled: "InvokeCancelled";
  readonly InvokeFailed: "InvokeFailed";
  readonly InvokeStarted: "InvokeStarted";
  readonly InvokeSucceeded: "InvokeSucceeded";
  readonly InvokeTimedOut: "InvokeTimedOut";
  readonly StepFailed: "StepFailed";
  readonly StepStarted: "StepStarted";
  readonly StepSucceeded: "StepSucceeded";
  readonly WaitCancelled: "WaitCancelled";
  readonly WaitStarted: "WaitStarted";
  readonly WaitSucceeded: "WaitSucceeded";
};
/**
 * @public
 */
export type EventType = (typeof EventType)[keyof typeof EventType];
/**
 * @public
 */
export interface ExecutionFailedDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionFailedDetailsFilterSensitiveLog: (
  obj: ExecutionFailedDetails,
) => any;
/**
 * @public
 */
export interface ExecutionStartedDetails {
  Input?: EventInput | undefined;
  ExecutionTimeout?: number | undefined;
}
/**
 * @internal
 */
export declare const ExecutionStartedDetailsFilterSensitiveLog: (
  obj: ExecutionStartedDetails,
) => any;
/**
 * @public
 */
export interface ExecutionStoppedDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionStoppedDetailsFilterSensitiveLog: (
  obj: ExecutionStoppedDetails,
) => any;
/**
 * @public
 */
export interface ExecutionSucceededDetails {
  Result?: EventResult | undefined;
}
/**
 * @internal
 */
export declare const ExecutionSucceededDetailsFilterSensitiveLog: (
  obj: ExecutionSucceededDetails,
) => any;
/**
 * @public
 */
export interface ExecutionTimedOutDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionTimedOutDetailsFilterSensitiveLog: (
  obj: ExecutionTimedOutDetails,
) => any;
/**
 * @public
 */
export interface InvokeCancelledDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const InvokeCancelledDetailsFilterSensitiveLog: (
  obj: InvokeCancelledDetails,
) => any;
/**
 * @public
 */
export interface InvokeFailedDetails {
  Error?: EventError | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeFailedDetailsFilterSensitiveLog: (
  obj: InvokeFailedDetails,
) => any;
/**
 * @public
 */
export interface InvokeStartedDetails {
  Input?: EventInput | undefined;
  FunctionArn?: string | undefined;
  DurableExecutionArn?: string | undefined;
}
/**
 * @internal
 */
export declare const InvokeStartedDetailsFilterSensitiveLog: (
  obj: InvokeStartedDetails,
) => any;
/**
 * @public
 */
export interface InvokeSucceededDetails {
  Result?: EventResult | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeSucceededDetailsFilterSensitiveLog: (
  obj: InvokeSucceededDetails,
) => any;
/**
 * @public
 */
export interface InvokeTimedOutDetails {
  Error?: EventError | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeTimedOutDetailsFilterSensitiveLog: (
  obj: InvokeTimedOutDetails,
) => any;
/**
 * @public
 */
export interface StepFailedDetails {
  Error?: EventError | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const StepFailedDetailsFilterSensitiveLog: (
  obj: StepFailedDetails,
) => any;
/**
 * @public
 */
export interface StepStartedDetails {}
/**
 * @public
 */
export interface StepSucceededDetails {
  Result?: EventResult | undefined;
  RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const StepSucceededDetailsFilterSensitiveLog: (
  obj: StepSucceededDetails,
) => any;
/**
 * @public
 */
export interface WaitCancelledDetails {
  Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const WaitCancelledDetailsFilterSensitiveLog: (
  obj: WaitCancelledDetails,
) => any;
/**
 * @public
 */
export interface WaitStartedDetails {
  Duration?: number | undefined;
  ScheduledEndTimestamp?: Date | undefined;
}
/**
 * @public
 */
export interface WaitSucceededDetails {
  Duration?: number | undefined;
}
/**
 * @public
 */
export interface Event {
  EventType?: EventType | undefined;
  SubType?: string | undefined;
  EventId?: number | undefined;
  Id?: string | undefined;
  Name?: string | undefined;
  EventTimestamp?: Date | undefined;
  ParentId?: string | undefined;
  ExecutionStartedDetails?: ExecutionStartedDetails | undefined;
  ExecutionSucceededDetails?: ExecutionSucceededDetails | undefined;
  ExecutionFailedDetails?: ExecutionFailedDetails | undefined;
  ExecutionTimedOutDetails?: ExecutionTimedOutDetails | undefined;
  ExecutionStoppedDetails?: ExecutionStoppedDetails | undefined;
  ContextStartedDetails?: ContextStartedDetails | undefined;
  ContextSucceededDetails?: ContextSucceededDetails | undefined;
  ContextFailedDetails?: ContextFailedDetails | undefined;
  WaitStartedDetails?: WaitStartedDetails | undefined;
  WaitSucceededDetails?: WaitSucceededDetails | undefined;
  WaitCancelledDetails?: WaitCancelledDetails | undefined;
  StepStartedDetails?: StepStartedDetails | undefined;
  StepSucceededDetails?: StepSucceededDetails | undefined;
  StepFailedDetails?: StepFailedDetails | undefined;
  InvokeStartedDetails?: InvokeStartedDetails | undefined;
  InvokeSucceededDetails?: InvokeSucceededDetails | undefined;
  InvokeFailedDetails?: InvokeFailedDetails | undefined;
  InvokeTimedOutDetails?: InvokeTimedOutDetails | undefined;
  InvokeCancelledDetails?: InvokeCancelledDetails | undefined;
  CallbackStartedDetails?: CallbackStartedDetails | undefined;
  CallbackSucceededDetails?: CallbackSucceededDetails | undefined;
  CallbackFailedDetails?: CallbackFailedDetails | undefined;
  CallbackTimedOutDetails?: CallbackTimedOutDetails | undefined;
}
/**
 * @internal
 */
export declare const EventFilterSensitiveLog: (obj: Event) => any;
/**
 * @public
 */
export interface GetDurableExecutionHistoryResponse {
  Events?: Event[] | undefined;
  NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionHistoryResponseFilterSensitiveLog: (
  obj: GetDurableExecutionHistoryResponse,
) => any;
/**
 * @public
 */
export interface GetDurableExecutionStateRequest {
  CheckpointToken: string | undefined;
  Marker?: string | undefined;
  MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface GetDurableExecutionStateResponse {
  Operations?: Operation[] | undefined;
  NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionStateResponseFilterSensitiveLog: (
  obj: GetDurableExecutionStateResponse,
) => any;
/**
 * @public
 * @enum
 */
export declare const TimeFilter: {
  readonly END: "END";
  readonly START: "START";
};
/**
 * @public
 */
export type TimeFilter = (typeof TimeFilter)[keyof typeof TimeFilter];
/**
 * @public
 */
export interface ListDurableExecutionsRequest {
  FunctionName?: string | undefined;
  FunctionVersion?: string | undefined;
  DurableExecutionName?: string | undefined;
  StatusFilter?: ExecutionStatus | undefined;
  TimeFilter?: TimeFilter | undefined;
  TimeAfter?: Date | undefined;
  TimeBefore?: Date | undefined;
  ReverseOrder?: boolean | undefined;
  Marker?: string | undefined;
  MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListDurableExecutionsResponse {
  DurableExecutions?: Execution[] | undefined;
  NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureRequest {
  CallbackId: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog: (
  obj: SendDurableExecutionCallbackFailureRequest,
) => any;
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureResponse {}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatRequest {
  CallbackId: string | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatResponse {}
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessRequest {
  CallbackId: string | undefined;
  Result?: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog: (
  obj: SendDurableExecutionCallbackSuccessRequest,
) => any;
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessResponse {}
/**
 * @public
 */
export interface StopDurableExecutionRequest {
  DurableExecutionArn: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const StopDurableExecutionRequestFilterSensitiveLog: (
  obj: StopDurableExecutionRequest,
) => any;
/**
 * @public
 */
export interface StopDurableExecutionResponse {
  StopDate?: Date | undefined;
}
