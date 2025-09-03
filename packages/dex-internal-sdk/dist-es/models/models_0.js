import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { SENSITIVE_STRING } from "@smithy/smithy-client";
export const ErrorObjectFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ErrorMessage && { ErrorMessage: SENSITIVE_STRING }),
  ...(obj.ErrorType && { ErrorType: SENSITIVE_STRING }),
  ...(obj.ErrorData && { ErrorData: SENSITIVE_STRING }),
  ...(obj.StackTrace && { StackTrace: SENSITIVE_STRING }),
});
export const CallbackDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const EventErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: ErrorObjectFilterSensitiveLog(obj.Payload) }),
});
export const CallbackFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const EventInputFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: SENSITIVE_STRING }),
});
export const CallbackStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
});
export const EventResultFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: SENSITIVE_STRING }),
});
export const CallbackSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
export const CallbackTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export class CallbackTimeoutException extends __BaseException {
  name = "CallbackTimeoutException";
  $fault = "client";
  constructor(opts) {
    super({
      name: "CallbackTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, CallbackTimeoutException.prototype);
  }
}
export const OperationAction = {
  CANCEL: "CANCEL",
  FAIL: "FAIL",
  RETRY: "RETRY",
  START: "START",
  SUCCEED: "SUCCEED",
};
export const OperationType = {
  CALLBACK: "CALLBACK",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  INVOKE: "INVOKE",
  STEP: "STEP",
  WAIT: "WAIT",
};
export const OperationUpdateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const CheckpointDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Updates && {
    Updates: obj.Updates.map((item) => OperationUpdateFilterSensitiveLog(item)),
  }),
});
export const ContextDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const ExecutionDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: SENSITIVE_STRING }),
});
export const InvokeDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const OperationStatus = {
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  READY: "READY",
  STARTED: "STARTED",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
export const StepDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const OperationFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionDetails && {
    ExecutionDetails: ExecutionDetailsFilterSensitiveLog(obj.ExecutionDetails),
  }),
  ...(obj.ContextDetails && {
    ContextDetails: ContextDetailsFilterSensitiveLog(obj.ContextDetails),
  }),
  ...(obj.StepDetails && {
    StepDetails: StepDetailsFilterSensitiveLog(obj.StepDetails),
  }),
  ...(obj.CallbackDetails && {
    CallbackDetails: CallbackDetailsFilterSensitiveLog(obj.CallbackDetails),
  }),
  ...(obj.InvokeDetails && {
    InvokeDetails: InvokeDetailsFilterSensitiveLog(obj.InvokeDetails),
  }),
});
export const CheckpointUpdatedExecutionStateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) => OperationFilterSensitiveLog(item)),
  }),
});
export const CheckpointDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.NewExecutionState && {
    NewExecutionState: CheckpointUpdatedExecutionStateFilterSensitiveLog(
      obj.NewExecutionState,
    ),
  }),
});
export class InvalidParameterValueException extends __BaseException {
  name = "InvalidParameterValueException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "InvalidParameterValueException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidParameterValueException.prototype);
    this.Type = opts.Type;
  }
}
export class ServiceException extends __BaseException {
  name = "ServiceException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ServiceException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, ServiceException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
export const ThrottleReason = {
  CallerRateLimitExceeded: "CallerRateLimitExceeded",
  ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded",
  ConcurrentSnapshotCreateLimitExceeded:
    "ConcurrentSnapshotCreateLimitExceeded",
  FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded",
  ReservedFunctionConcurrentInvocationLimitExceeded:
    "ReservedFunctionConcurrentInvocationLimitExceeded",
  ReservedFunctionInvocationRateLimitExceeded:
    "ReservedFunctionInvocationRateLimitExceeded",
};
export class TooManyRequestsException extends __BaseException {
  name = "TooManyRequestsException";
  $fault = "client";
  retryAfterSeconds;
  Type;
  Reason;
  constructor(opts) {
    super({
      name: "TooManyRequestsException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, TooManyRequestsException.prototype);
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.Type = opts.Type;
    this.Reason = opts.Reason;
  }
}
export const ContextFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const ContextSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
export const ExecutionStatus = {
  FAILED: "FAILED",
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
export const GetDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: SENSITIVE_STRING }),
  ...(obj.Result && { Result: SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export class ResourceNotFoundException extends __BaseException {
  name = "ResourceNotFoundException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ResourceNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
export const EventType = {
  CallbackFailed: "CallbackFailed",
  CallbackStarted: "CallbackStarted",
  CallbackSucceeded: "CallbackSucceeded",
  CallbackTimedOut: "CallbackTimedOut",
  ContextFailed: "ContextFailed",
  ContextStarted: "ContextStarted",
  ContextSucceeded: "ContextSucceeded",
  ExecutionFailed: "ExecutionFailed",
  ExecutionStarted: "ExecutionStarted",
  ExecutionStopped: "ExecutionStopped",
  ExecutionSucceeded: "ExecutionSucceeded",
  ExecutionTimedOut: "ExecutionTimedOut",
  InvokeCancelled: "InvokeCancelled",
  InvokeFailed: "InvokeFailed",
  InvokeStarted: "InvokeStarted",
  InvokeSucceeded: "InvokeSucceeded",
  InvokeTimedOut: "InvokeTimedOut",
  StepFailed: "StepFailed",
  StepStarted: "StepStarted",
  StepSucceeded: "StepSucceeded",
  WaitCancelled: "WaitCancelled",
  WaitStarted: "WaitStarted",
  WaitSucceeded: "WaitSucceeded",
};
export const ExecutionFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const ExecutionStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
});
export const ExecutionStoppedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const ExecutionSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
export const ExecutionTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const InvokeCancelledDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const InvokeFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const InvokeStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
});
export const InvokeSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
export const InvokeTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const StepFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const StepSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
export const WaitCancelledDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
export const EventFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionStartedDetails && {
    ExecutionStartedDetails: ExecutionStartedDetailsFilterSensitiveLog(
      obj.ExecutionStartedDetails,
    ),
  }),
  ...(obj.ExecutionSucceededDetails && {
    ExecutionSucceededDetails: ExecutionSucceededDetailsFilterSensitiveLog(
      obj.ExecutionSucceededDetails,
    ),
  }),
  ...(obj.ExecutionFailedDetails && {
    ExecutionFailedDetails: ExecutionFailedDetailsFilterSensitiveLog(
      obj.ExecutionFailedDetails,
    ),
  }),
  ...(obj.ExecutionTimedOutDetails && {
    ExecutionTimedOutDetails: ExecutionTimedOutDetailsFilterSensitiveLog(
      obj.ExecutionTimedOutDetails,
    ),
  }),
  ...(obj.ExecutionStoppedDetails && {
    ExecutionStoppedDetails: ExecutionStoppedDetailsFilterSensitiveLog(
      obj.ExecutionStoppedDetails,
    ),
  }),
  ...(obj.ContextSucceededDetails && {
    ContextSucceededDetails: ContextSucceededDetailsFilterSensitiveLog(
      obj.ContextSucceededDetails,
    ),
  }),
  ...(obj.ContextFailedDetails && {
    ContextFailedDetails: ContextFailedDetailsFilterSensitiveLog(
      obj.ContextFailedDetails,
    ),
  }),
  ...(obj.WaitCancelledDetails && {
    WaitCancelledDetails: WaitCancelledDetailsFilterSensitiveLog(
      obj.WaitCancelledDetails,
    ),
  }),
  ...(obj.StepSucceededDetails && {
    StepSucceededDetails: StepSucceededDetailsFilterSensitiveLog(
      obj.StepSucceededDetails,
    ),
  }),
  ...(obj.StepFailedDetails && {
    StepFailedDetails: StepFailedDetailsFilterSensitiveLog(
      obj.StepFailedDetails,
    ),
  }),
  ...(obj.InvokeStartedDetails && {
    InvokeStartedDetails: InvokeStartedDetailsFilterSensitiveLog(
      obj.InvokeStartedDetails,
    ),
  }),
  ...(obj.InvokeSucceededDetails && {
    InvokeSucceededDetails: InvokeSucceededDetailsFilterSensitiveLog(
      obj.InvokeSucceededDetails,
    ),
  }),
  ...(obj.InvokeFailedDetails && {
    InvokeFailedDetails: InvokeFailedDetailsFilterSensitiveLog(
      obj.InvokeFailedDetails,
    ),
  }),
  ...(obj.InvokeTimedOutDetails && {
    InvokeTimedOutDetails: InvokeTimedOutDetailsFilterSensitiveLog(
      obj.InvokeTimedOutDetails,
    ),
  }),
  ...(obj.InvokeCancelledDetails && {
    InvokeCancelledDetails: InvokeCancelledDetailsFilterSensitiveLog(
      obj.InvokeCancelledDetails,
    ),
  }),
  ...(obj.CallbackStartedDetails && {
    CallbackStartedDetails: CallbackStartedDetailsFilterSensitiveLog(
      obj.CallbackStartedDetails,
    ),
  }),
  ...(obj.CallbackSucceededDetails && {
    CallbackSucceededDetails: CallbackSucceededDetailsFilterSensitiveLog(
      obj.CallbackSucceededDetails,
    ),
  }),
  ...(obj.CallbackFailedDetails && {
    CallbackFailedDetails: CallbackFailedDetailsFilterSensitiveLog(
      obj.CallbackFailedDetails,
    ),
  }),
  ...(obj.CallbackTimedOutDetails && {
    CallbackTimedOutDetails: CallbackTimedOutDetailsFilterSensitiveLog(
      obj.CallbackTimedOutDetails,
    ),
  }),
});
export const GetDurableExecutionHistoryResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Events && {
    Events: obj.Events.map((item) => EventFilterSensitiveLog(item)),
  }),
});
export const GetDurableExecutionStateResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) => OperationFilterSensitiveLog(item)),
  }),
});
export const TimeFilter = {
  END: "END",
  START: "START",
};
export const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = (
  obj,
) => ({
  ...obj,
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
export const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (
  obj,
) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
});
export const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
