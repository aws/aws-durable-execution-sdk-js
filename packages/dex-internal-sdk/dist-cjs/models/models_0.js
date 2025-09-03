"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendDurableExecutionCallbackFailureRequestFilterSensitiveLog =
  exports.TimeFilter =
  exports.GetDurableExecutionStateResponseFilterSensitiveLog =
  exports.GetDurableExecutionHistoryResponseFilterSensitiveLog =
  exports.EventFilterSensitiveLog =
  exports.WaitCancelledDetailsFilterSensitiveLog =
  exports.StepSucceededDetailsFilterSensitiveLog =
  exports.StepFailedDetailsFilterSensitiveLog =
  exports.InvokeTimedOutDetailsFilterSensitiveLog =
  exports.InvokeSucceededDetailsFilterSensitiveLog =
  exports.InvokeStartedDetailsFilterSensitiveLog =
  exports.InvokeFailedDetailsFilterSensitiveLog =
  exports.InvokeCancelledDetailsFilterSensitiveLog =
  exports.ExecutionTimedOutDetailsFilterSensitiveLog =
  exports.ExecutionSucceededDetailsFilterSensitiveLog =
  exports.ExecutionStoppedDetailsFilterSensitiveLog =
  exports.ExecutionStartedDetailsFilterSensitiveLog =
  exports.ExecutionFailedDetailsFilterSensitiveLog =
  exports.EventType =
  exports.ResourceNotFoundException =
  exports.GetDurableExecutionResponseFilterSensitiveLog =
  exports.ExecutionStatus =
  exports.ContextSucceededDetailsFilterSensitiveLog =
  exports.ContextFailedDetailsFilterSensitiveLog =
  exports.TooManyRequestsException =
  exports.ThrottleReason =
  exports.ServiceException =
  exports.InvalidParameterValueException =
  exports.CheckpointDurableExecutionResponseFilterSensitiveLog =
  exports.CheckpointUpdatedExecutionStateFilterSensitiveLog =
  exports.OperationFilterSensitiveLog =
  exports.StepDetailsFilterSensitiveLog =
  exports.OperationStatus =
  exports.InvokeDetailsFilterSensitiveLog =
  exports.ExecutionDetailsFilterSensitiveLog =
  exports.ContextDetailsFilterSensitiveLog =
  exports.CheckpointDurableExecutionRequestFilterSensitiveLog =
  exports.OperationUpdateFilterSensitiveLog =
  exports.OperationType =
  exports.OperationAction =
  exports.CallbackTimeoutException =
  exports.CallbackTimedOutDetailsFilterSensitiveLog =
  exports.CallbackSucceededDetailsFilterSensitiveLog =
  exports.EventResultFilterSensitiveLog =
  exports.CallbackStartedDetailsFilterSensitiveLog =
  exports.EventInputFilterSensitiveLog =
  exports.CallbackFailedDetailsFilterSensitiveLog =
  exports.EventErrorFilterSensitiveLog =
  exports.CallbackDetailsFilterSensitiveLog =
  exports.ErrorObjectFilterSensitiveLog =
    void 0;
exports.StopDurableExecutionRequestFilterSensitiveLog =
  exports.SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = void 0;
const LambdaServiceException_1 = require("./LambdaServiceException");
const smithy_client_1 = require("@smithy/smithy-client");
const ErrorObjectFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ErrorMessage && { ErrorMessage: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.ErrorType && { ErrorType: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.ErrorData && { ErrorData: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.StackTrace && { StackTrace: smithy_client_1.SENSITIVE_STRING }),
});
exports.ErrorObjectFilterSensitiveLog = ErrorObjectFilterSensitiveLog;
const CallbackDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.CallbackDetailsFilterSensitiveLog = CallbackDetailsFilterSensitiveLog;
const EventErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && {
    Payload: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Payload),
  }),
});
exports.EventErrorFilterSensitiveLog = EventErrorFilterSensitiveLog;
const CallbackFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.CallbackFailedDetailsFilterSensitiveLog =
  CallbackFailedDetailsFilterSensitiveLog;
const EventInputFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING }),
});
exports.EventInputFilterSensitiveLog = EventInputFilterSensitiveLog;
const CallbackStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && {
    Input: (0, exports.EventInputFilterSensitiveLog)(obj.Input),
  }),
});
exports.CallbackStartedDetailsFilterSensitiveLog =
  CallbackStartedDetailsFilterSensitiveLog;
const EventResultFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING }),
});
exports.EventResultFilterSensitiveLog = EventResultFilterSensitiveLog;
const CallbackSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && {
    Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result),
  }),
});
exports.CallbackSucceededDetailsFilterSensitiveLog =
  CallbackSucceededDetailsFilterSensitiveLog;
const CallbackTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.CallbackTimedOutDetailsFilterSensitiveLog =
  CallbackTimedOutDetailsFilterSensitiveLog;
class CallbackTimeoutException extends LambdaServiceException_1.LambdaServiceException {
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
exports.CallbackTimeoutException = CallbackTimeoutException;
exports.OperationAction = {
  CANCEL: "CANCEL",
  FAIL: "FAIL",
  RETRY: "RETRY",
  START: "START",
  SUCCEED: "SUCCEED",
};
exports.OperationType = {
  CALLBACK: "CALLBACK",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  INVOKE: "INVOKE",
  STEP: "STEP",
  WAIT: "WAIT",
};
const OperationUpdateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.OperationUpdateFilterSensitiveLog = OperationUpdateFilterSensitiveLog;
const CheckpointDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Updates && {
    Updates: obj.Updates.map((item) =>
      (0, exports.OperationUpdateFilterSensitiveLog)(item),
    ),
  }),
});
exports.CheckpointDurableExecutionRequestFilterSensitiveLog =
  CheckpointDurableExecutionRequestFilterSensitiveLog;
const ContextDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.ContextDetailsFilterSensitiveLog = ContextDetailsFilterSensitiveLog;
const ExecutionDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: smithy_client_1.SENSITIVE_STRING }),
});
exports.ExecutionDetailsFilterSensitiveLog = ExecutionDetailsFilterSensitiveLog;
const InvokeDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.InvokeDetailsFilterSensitiveLog = InvokeDetailsFilterSensitiveLog;
exports.OperationStatus = {
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  READY: "READY",
  STARTED: "STARTED",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
const StepDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.StepDetailsFilterSensitiveLog = StepDetailsFilterSensitiveLog;
const OperationFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionDetails && {
    ExecutionDetails: (0, exports.ExecutionDetailsFilterSensitiveLog)(
      obj.ExecutionDetails,
    ),
  }),
  ...(obj.ContextDetails && {
    ContextDetails: (0, exports.ContextDetailsFilterSensitiveLog)(
      obj.ContextDetails,
    ),
  }),
  ...(obj.StepDetails && {
    StepDetails: (0, exports.StepDetailsFilterSensitiveLog)(obj.StepDetails),
  }),
  ...(obj.CallbackDetails && {
    CallbackDetails: (0, exports.CallbackDetailsFilterSensitiveLog)(
      obj.CallbackDetails,
    ),
  }),
  ...(obj.InvokeDetails && {
    InvokeDetails: (0, exports.InvokeDetailsFilterSensitiveLog)(
      obj.InvokeDetails,
    ),
  }),
});
exports.OperationFilterSensitiveLog = OperationFilterSensitiveLog;
const CheckpointUpdatedExecutionStateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) =>
      (0, exports.OperationFilterSensitiveLog)(item),
    ),
  }),
});
exports.CheckpointUpdatedExecutionStateFilterSensitiveLog =
  CheckpointUpdatedExecutionStateFilterSensitiveLog;
const CheckpointDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.NewExecutionState && {
    NewExecutionState: (0,
    exports.CheckpointUpdatedExecutionStateFilterSensitiveLog)(
      obj.NewExecutionState,
    ),
  }),
});
exports.CheckpointDurableExecutionResponseFilterSensitiveLog =
  CheckpointDurableExecutionResponseFilterSensitiveLog;
class InvalidParameterValueException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidParameterValueException = InvalidParameterValueException;
class ServiceException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ServiceException = ServiceException;
exports.ThrottleReason = {
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
class TooManyRequestsException extends LambdaServiceException_1.LambdaServiceException {
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
exports.TooManyRequestsException = TooManyRequestsException;
const ContextFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.ContextFailedDetailsFilterSensitiveLog =
  ContextFailedDetailsFilterSensitiveLog;
const ContextSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && {
    Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result),
  }),
});
exports.ContextSucceededDetailsFilterSensitiveLog =
  ContextSucceededDetailsFilterSensitiveLog;
exports.ExecutionStatus = {
  FAILED: "FAILED",
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
const GetDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.GetDurableExecutionResponseFilterSensitiveLog =
  GetDurableExecutionResponseFilterSensitiveLog;
class ResourceNotFoundException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ResourceNotFoundException = ResourceNotFoundException;
exports.EventType = {
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
const ExecutionFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.ExecutionFailedDetailsFilterSensitiveLog =
  ExecutionFailedDetailsFilterSensitiveLog;
const ExecutionStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && {
    Input: (0, exports.EventInputFilterSensitiveLog)(obj.Input),
  }),
});
exports.ExecutionStartedDetailsFilterSensitiveLog =
  ExecutionStartedDetailsFilterSensitiveLog;
const ExecutionStoppedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.ExecutionStoppedDetailsFilterSensitiveLog =
  ExecutionStoppedDetailsFilterSensitiveLog;
const ExecutionSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && {
    Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result),
  }),
});
exports.ExecutionSucceededDetailsFilterSensitiveLog =
  ExecutionSucceededDetailsFilterSensitiveLog;
const ExecutionTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.ExecutionTimedOutDetailsFilterSensitiveLog =
  ExecutionTimedOutDetailsFilterSensitiveLog;
const InvokeCancelledDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.InvokeCancelledDetailsFilterSensitiveLog =
  InvokeCancelledDetailsFilterSensitiveLog;
const InvokeFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.InvokeFailedDetailsFilterSensitiveLog =
  InvokeFailedDetailsFilterSensitiveLog;
const InvokeStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && {
    Input: (0, exports.EventInputFilterSensitiveLog)(obj.Input),
  }),
});
exports.InvokeStartedDetailsFilterSensitiveLog =
  InvokeStartedDetailsFilterSensitiveLog;
const InvokeSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && {
    Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result),
  }),
});
exports.InvokeSucceededDetailsFilterSensitiveLog =
  InvokeSucceededDetailsFilterSensitiveLog;
const InvokeTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.InvokeTimedOutDetailsFilterSensitiveLog =
  InvokeTimedOutDetailsFilterSensitiveLog;
const StepFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.StepFailedDetailsFilterSensitiveLog =
  StepFailedDetailsFilterSensitiveLog;
const StepSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && {
    Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result),
  }),
});
exports.StepSucceededDetailsFilterSensitiveLog =
  StepSucceededDetailsFilterSensitiveLog;
const WaitCancelledDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error),
  }),
});
exports.WaitCancelledDetailsFilterSensitiveLog =
  WaitCancelledDetailsFilterSensitiveLog;
const EventFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionStartedDetails && {
    ExecutionStartedDetails: (0,
    exports.ExecutionStartedDetailsFilterSensitiveLog)(
      obj.ExecutionStartedDetails,
    ),
  }),
  ...(obj.ExecutionSucceededDetails && {
    ExecutionSucceededDetails: (0,
    exports.ExecutionSucceededDetailsFilterSensitiveLog)(
      obj.ExecutionSucceededDetails,
    ),
  }),
  ...(obj.ExecutionFailedDetails && {
    ExecutionFailedDetails: (0,
    exports.ExecutionFailedDetailsFilterSensitiveLog)(
      obj.ExecutionFailedDetails,
    ),
  }),
  ...(obj.ExecutionTimedOutDetails && {
    ExecutionTimedOutDetails: (0,
    exports.ExecutionTimedOutDetailsFilterSensitiveLog)(
      obj.ExecutionTimedOutDetails,
    ),
  }),
  ...(obj.ExecutionStoppedDetails && {
    ExecutionStoppedDetails: (0,
    exports.ExecutionStoppedDetailsFilterSensitiveLog)(
      obj.ExecutionStoppedDetails,
    ),
  }),
  ...(obj.ContextSucceededDetails && {
    ContextSucceededDetails: (0,
    exports.ContextSucceededDetailsFilterSensitiveLog)(
      obj.ContextSucceededDetails,
    ),
  }),
  ...(obj.ContextFailedDetails && {
    ContextFailedDetails: (0, exports.ContextFailedDetailsFilterSensitiveLog)(
      obj.ContextFailedDetails,
    ),
  }),
  ...(obj.WaitCancelledDetails && {
    WaitCancelledDetails: (0, exports.WaitCancelledDetailsFilterSensitiveLog)(
      obj.WaitCancelledDetails,
    ),
  }),
  ...(obj.StepSucceededDetails && {
    StepSucceededDetails: (0, exports.StepSucceededDetailsFilterSensitiveLog)(
      obj.StepSucceededDetails,
    ),
  }),
  ...(obj.StepFailedDetails && {
    StepFailedDetails: (0, exports.StepFailedDetailsFilterSensitiveLog)(
      obj.StepFailedDetails,
    ),
  }),
  ...(obj.InvokeStartedDetails && {
    InvokeStartedDetails: (0, exports.InvokeStartedDetailsFilterSensitiveLog)(
      obj.InvokeStartedDetails,
    ),
  }),
  ...(obj.InvokeSucceededDetails && {
    InvokeSucceededDetails: (0,
    exports.InvokeSucceededDetailsFilterSensitiveLog)(
      obj.InvokeSucceededDetails,
    ),
  }),
  ...(obj.InvokeFailedDetails && {
    InvokeFailedDetails: (0, exports.InvokeFailedDetailsFilterSensitiveLog)(
      obj.InvokeFailedDetails,
    ),
  }),
  ...(obj.InvokeTimedOutDetails && {
    InvokeTimedOutDetails: (0, exports.InvokeTimedOutDetailsFilterSensitiveLog)(
      obj.InvokeTimedOutDetails,
    ),
  }),
  ...(obj.InvokeCancelledDetails && {
    InvokeCancelledDetails: (0,
    exports.InvokeCancelledDetailsFilterSensitiveLog)(
      obj.InvokeCancelledDetails,
    ),
  }),
  ...(obj.CallbackStartedDetails && {
    CallbackStartedDetails: (0,
    exports.CallbackStartedDetailsFilterSensitiveLog)(
      obj.CallbackStartedDetails,
    ),
  }),
  ...(obj.CallbackSucceededDetails && {
    CallbackSucceededDetails: (0,
    exports.CallbackSucceededDetailsFilterSensitiveLog)(
      obj.CallbackSucceededDetails,
    ),
  }),
  ...(obj.CallbackFailedDetails && {
    CallbackFailedDetails: (0, exports.CallbackFailedDetailsFilterSensitiveLog)(
      obj.CallbackFailedDetails,
    ),
  }),
  ...(obj.CallbackTimedOutDetails && {
    CallbackTimedOutDetails: (0,
    exports.CallbackTimedOutDetailsFilterSensitiveLog)(
      obj.CallbackTimedOutDetails,
    ),
  }),
});
exports.EventFilterSensitiveLog = EventFilterSensitiveLog;
const GetDurableExecutionHistoryResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Events && {
    Events: obj.Events.map((item) =>
      (0, exports.EventFilterSensitiveLog)(item),
    ),
  }),
});
exports.GetDurableExecutionHistoryResponseFilterSensitiveLog =
  GetDurableExecutionHistoryResponseFilterSensitiveLog;
const GetDurableExecutionStateResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) =>
      (0, exports.OperationFilterSensitiveLog)(item),
    ),
  }),
});
exports.GetDurableExecutionStateResponseFilterSensitiveLog =
  GetDurableExecutionStateResponseFilterSensitiveLog;
exports.TimeFilter = {
  END: "END",
  START: "START",
};
const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.SendDurableExecutionCallbackFailureRequestFilterSensitiveLog =
  SendDurableExecutionCallbackFailureRequestFilterSensitiveLog;
const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING }),
});
exports.SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog =
  SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog;
const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && {
    Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error),
  }),
});
exports.StopDurableExecutionRequestFilterSensitiveLog =
  StopDurableExecutionRequestFilterSensitiveLog;
