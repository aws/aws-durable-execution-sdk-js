"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.de_StopDurableExecutionCommand =
  exports.de_SendDurableExecutionCallbackSuccessCommand =
  exports.de_SendDurableExecutionCallbackHeartbeatCommand =
  exports.de_SendDurableExecutionCallbackFailureCommand =
  exports.de_ListDurableExecutionsCommand =
  exports.de_GetDurableExecutionStateCommand =
  exports.de_GetDurableExecutionHistoryCommand =
  exports.de_GetDurableExecutionCommand =
  exports.de_CheckpointDurableExecutionCommand =
  exports.se_StopDurableExecutionCommand =
  exports.se_SendDurableExecutionCallbackSuccessCommand =
  exports.se_SendDurableExecutionCallbackHeartbeatCommand =
  exports.se_SendDurableExecutionCallbackFailureCommand =
  exports.se_ListDurableExecutionsCommand =
  exports.se_GetDurableExecutionStateCommand =
  exports.se_GetDurableExecutionHistoryCommand =
  exports.se_GetDurableExecutionCommand =
  exports.se_CheckpointDurableExecutionCommand =
    void 0;
const LambdaServiceException_1 = require("../models/LambdaServiceException");
const models_0_1 = require("../models/models_0");
const core_1 = require("@aws-sdk/core");
const core_2 = require("@smithy/core");
const smithy_client_1 = require("@smithy/smithy-client");
const se_CheckpointDurableExecutionCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-execution-state/{CheckpointToken}/checkpoint");
  b.p(
    "CheckpointToken",
    () => input.CheckpointToken,
    "{CheckpointToken}",
    false,
  );
  let body;
  body = JSON.stringify(
    (0, smithy_client_1.take)(input, {
      ClientToken: [],
      Updates: (_) => (0, smithy_client_1._json)(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
exports.se_CheckpointDurableExecutionCommand =
  se_CheckpointDurableExecutionCommand;
const se_GetDurableExecutionCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
exports.se_GetDurableExecutionCommand = se_GetDurableExecutionCommand;
const se_GetDurableExecutionHistoryCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  const query = (0, smithy_client_1.map)({
    [_IED]: [
      () => input.IncludeExecutionData !== void 0,
      () => input[_IED].toString(),
    ],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    [_M]: [, input[_M]],
    [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
exports.se_GetDurableExecutionHistoryCommand =
  se_GetDurableExecutionHistoryCommand;
const se_GetDurableExecutionStateCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-execution-state/{CheckpointToken}/getState");
  b.p(
    "CheckpointToken",
    () => input.CheckpointToken,
    "{CheckpointToken}",
    false,
  );
  const query = (0, smithy_client_1.map)({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
exports.se_GetDurableExecutionStateCommand = se_GetDurableExecutionStateCommand;
const se_ListDurableExecutionsCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions");
  const query = (0, smithy_client_1.map)({
    [_FN]: [, input[_FN]],
    [_FV]: [, input[_FV]],
    [_DEN]: [, input[_DEN]],
    [_SF]: [, input[_SF]],
    [_TF]: [, input[_TF]],
    [_TA]: [
      () => input.TimeAfter !== void 0,
      () => (0, smithy_client_1.serializeDateTime)(input[_TA]).toString(),
    ],
    [_TB]: [
      () => input.TimeBefore !== void 0,
      () => (0, smithy_client_1.serializeDateTime)(input[_TB]).toString(),
    ],
    [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
exports.se_ListDurableExecutionsCommand = se_ListDurableExecutionsCommand;
const se_SendDurableExecutionCallbackFailureCommand = async (
  input,
  context,
) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  if (input.Error !== undefined) {
    body = (0, smithy_client_1._json)(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
exports.se_SendDurableExecutionCallbackFailureCommand =
  se_SendDurableExecutionCallbackFailureCommand;
const se_SendDurableExecutionCallbackHeartbeatCommand = async (
  input,
  context,
) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  b.m("POST").h(headers).b(body);
  return b.build();
};
exports.se_SendDurableExecutionCallbackHeartbeatCommand =
  se_SendDurableExecutionCallbackHeartbeatCommand;
const se_SendDurableExecutionCallbackSuccessCommand = async (
  input,
  context,
) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/octet-stream",
  };
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/succeed");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  if (input.Result !== undefined) {
    body = input.Result;
  }
  b.m("POST").h(headers).b(body);
  return b.build();
};
exports.se_SendDurableExecutionCallbackSuccessCommand =
  se_SendDurableExecutionCallbackSuccessCommand;
const se_StopDurableExecutionCommand = async (input, context) => {
  const b = (0, core_2.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/stop");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  let body;
  if (input.Error !== undefined) {
    body = (0, smithy_client_1._json)(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
exports.se_StopDurableExecutionCommand = se_StopDurableExecutionCommand;
const de_CheckpointDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    CheckpointToken: smithy_client_1.expectString,
    NewExecutionState: (_) => de_CheckpointUpdatedExecutionState(_, context),
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_CheckpointDurableExecutionCommand =
  de_CheckpointDurableExecutionCommand;
const de_GetDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    DurableExecutionArn: smithy_client_1.expectString,
    DurableExecutionName: smithy_client_1.expectString,
    Error: smithy_client_1._json,
    FunctionArn: smithy_client_1.expectString,
    InputPayload: smithy_client_1.expectString,
    Result: smithy_client_1.expectString,
    StartDate: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    Status: smithy_client_1.expectString,
    StopDate: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    Version: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_GetDurableExecutionCommand = de_GetDurableExecutionCommand;
const de_GetDurableExecutionHistoryCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    Events: (_) => de_Events(_, context),
    NextMarker: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_GetDurableExecutionHistoryCommand =
  de_GetDurableExecutionHistoryCommand;
const de_GetDurableExecutionStateCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    NextMarker: smithy_client_1.expectString,
    Operations: (_) => de_Operations(_, context),
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_GetDurableExecutionStateCommand = de_GetDurableExecutionStateCommand;
const de_ListDurableExecutionsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    DurableExecutions: (_) => de_DurableExecutions(_, context),
    NextMarker: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_ListDurableExecutionsCommand = de_ListDurableExecutionsCommand;
const de_SendDurableExecutionCallbackFailureCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  await (0, smithy_client_1.collectBody)(output.body, context);
  return contents;
};
exports.de_SendDurableExecutionCallbackFailureCommand =
  de_SendDurableExecutionCallbackFailureCommand;
const de_SendDurableExecutionCallbackHeartbeatCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  await (0, smithy_client_1.collectBody)(output.body, context);
  return contents;
};
exports.de_SendDurableExecutionCallbackHeartbeatCommand =
  de_SendDurableExecutionCallbackHeartbeatCommand;
const de_SendDurableExecutionCallbackSuccessCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  await (0, smithy_client_1.collectBody)(output.body, context);
  return contents;
};
exports.de_SendDurableExecutionCallbackSuccessCommand =
  de_SendDurableExecutionCallbackSuccessCommand;
const de_StopDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, smithy_client_1.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, smithy_client_1.expectNonNull)(
    (0, smithy_client_1.expectObject)(
      await (0, core_1.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, smithy_client_1.take)(data, {
    StopDate: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
  });
  Object.assign(contents, doc);
  return contents;
};
exports.de_StopDurableExecutionCommand = de_StopDurableExecutionCommand;
const de_CommandError = async (output, context) => {
  const parsedOutput = {
    ...output,
    body: await (0, core_1.parseJsonErrorBody)(output.body, context),
  };
  const errorCode = (0, core_1.loadRestJsonErrorCode)(
    output,
    parsedOutput.body,
  );
  switch (errorCode) {
    case "InvalidParameterValueException":
    case "com.amazonaws.awsgirapi#InvalidParameterValueException":
      throw await de_InvalidParameterValueExceptionRes(parsedOutput, context);
    case "ServiceException":
    case "com.amazonaws.awsgirapi#ServiceException":
      throw await de_ServiceExceptionRes(parsedOutput, context);
    case "TooManyRequestsException":
    case "com.amazonaws.awsgirapi#TooManyRequestsException":
      throw await de_TooManyRequestsExceptionRes(parsedOutput, context);
    case "ResourceNotFoundException":
    case "com.amazonaws.awsgirapi#ResourceNotFoundException":
      throw await de_ResourceNotFoundExceptionRes(parsedOutput, context);
    case "CallbackTimeoutException":
    case "com.amazonaws.awsgirapi#CallbackTimeoutException":
      throw await de_CallbackTimeoutExceptionRes(parsedOutput, context);
    default:
      const parsedBody = parsedOutput.body;
      return throwDefaultError({
        output,
        parsedBody,
        errorCode,
      });
  }
};
const throwDefaultError = (0, smithy_client_1.withBaseException)(
  LambdaServiceException_1.LambdaServiceException,
);
const de_CallbackTimeoutExceptionRes = async (parsedOutput, context) => {
  const contents = (0, smithy_client_1.map)({});
  const data = parsedOutput.body;
  const doc = (0, smithy_client_1.take)(data, {
    message: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  const exception = new models_0_1.CallbackTimeoutException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return (0, smithy_client_1.decorateServiceException)(
    exception,
    parsedOutput.body,
  );
};
const de_InvalidParameterValueExceptionRes = async (parsedOutput, context) => {
  const contents = (0, smithy_client_1.map)({});
  const data = parsedOutput.body;
  const doc = (0, smithy_client_1.take)(data, {
    Type: smithy_client_1.expectString,
    message: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  const exception = new models_0_1.InvalidParameterValueException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return (0, smithy_client_1.decorateServiceException)(
    exception,
    parsedOutput.body,
  );
};
const de_ResourceNotFoundExceptionRes = async (parsedOutput, context) => {
  const contents = (0, smithy_client_1.map)({});
  const data = parsedOutput.body;
  const doc = (0, smithy_client_1.take)(data, {
    Message: smithy_client_1.expectString,
    Type: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  const exception = new models_0_1.ResourceNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return (0, smithy_client_1.decorateServiceException)(
    exception,
    parsedOutput.body,
  );
};
const de_ServiceExceptionRes = async (parsedOutput, context) => {
  const contents = (0, smithy_client_1.map)({});
  const data = parsedOutput.body;
  const doc = (0, smithy_client_1.take)(data, {
    Message: smithy_client_1.expectString,
    Type: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  const exception = new models_0_1.ServiceException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return (0, smithy_client_1.decorateServiceException)(
    exception,
    parsedOutput.body,
  );
};
const de_TooManyRequestsExceptionRes = async (parsedOutput, context) => {
  const contents = (0, smithy_client_1.map)({
    [_rAS]: [, parsedOutput.headers[_ra]],
  });
  const data = parsedOutput.body;
  const doc = (0, smithy_client_1.take)(data, {
    Reason: smithy_client_1.expectString,
    Type: smithy_client_1.expectString,
    message: smithy_client_1.expectString,
  });
  Object.assign(contents, doc);
  const exception = new models_0_1.TooManyRequestsException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return (0, smithy_client_1.decorateServiceException)(
    exception,
    parsedOutput.body,
  );
};
const de_CheckpointUpdatedExecutionState = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    NextMarker: smithy_client_1.expectString,
    Operations: (_) => de_Operations(_, context),
  });
};
const de_DurableExecutions = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Execution(entry, context);
    });
  return retVal;
};
const de_Event = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    CallbackFailedDetails: smithy_client_1._json,
    CallbackStartedDetails: smithy_client_1._json,
    CallbackSucceededDetails: smithy_client_1._json,
    CallbackTimedOutDetails: smithy_client_1._json,
    ContextFailedDetails: smithy_client_1._json,
    ContextStartedDetails: smithy_client_1._json,
    ContextSucceededDetails: smithy_client_1._json,
    EventId: smithy_client_1.expectInt32,
    EventTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    EventType: smithy_client_1.expectString,
    ExecutionFailedDetails: smithy_client_1._json,
    ExecutionStartedDetails: smithy_client_1._json,
    ExecutionStoppedDetails: smithy_client_1._json,
    ExecutionSucceededDetails: smithy_client_1._json,
    ExecutionTimedOutDetails: smithy_client_1._json,
    Id: smithy_client_1.expectString,
    InvokeCancelledDetails: smithy_client_1._json,
    InvokeFailedDetails: smithy_client_1._json,
    InvokeStartedDetails: smithy_client_1._json,
    InvokeSucceededDetails: smithy_client_1._json,
    InvokeTimedOutDetails: smithy_client_1._json,
    Name: smithy_client_1.expectString,
    ParentId: smithy_client_1.expectString,
    StepFailedDetails: smithy_client_1._json,
    StepStartedDetails: smithy_client_1._json,
    StepSucceededDetails: smithy_client_1._json,
    SubType: smithy_client_1.expectString,
    WaitCancelledDetails: smithy_client_1._json,
    WaitStartedDetails: (_) => de_WaitStartedDetails(_, context),
    WaitSucceededDetails: smithy_client_1._json,
  });
};
const de_Events = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Event(entry, context);
    });
  return retVal;
};
const de_Execution = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    DurableExecutionArn: smithy_client_1.expectString,
    DurableExecutionName: smithy_client_1.expectString,
    FunctionArn: smithy_client_1.expectString,
    StartDate: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    Status: smithy_client_1.expectString,
    StopDate: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
  });
};
const de_Operation = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    CallbackDetails: smithy_client_1._json,
    ContextDetails: smithy_client_1._json,
    EndTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    ExecutionDetails: smithy_client_1._json,
    Id: smithy_client_1.expectString,
    InvokeDetails: smithy_client_1._json,
    Name: smithy_client_1.expectString,
    ParentId: smithy_client_1.expectString,
    StartTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    Status: smithy_client_1.expectString,
    StepDetails: (_) => de_StepDetails(_, context),
    SubType: smithy_client_1.expectString,
    Type: smithy_client_1.expectString,
    WaitDetails: (_) => de_WaitDetails(_, context),
  });
};
const de_Operations = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Operation(entry, context);
    });
  return retVal;
};
const de_StepDetails = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    Attempt: smithy_client_1.expectInt32,
    Error: smithy_client_1._json,
    NextAttemptTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
    Result: smithy_client_1.expectString,
  });
};
const de_WaitDetails = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    ScheduledTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
  });
};
const de_WaitStartedDetails = (output, context) => {
  return (0, smithy_client_1.take)(output, {
    Duration: smithy_client_1.expectInt32,
    ScheduledEndTimestamp: (_) =>
      (0, smithy_client_1.expectNonNull)(
        (0, smithy_client_1.parseEpochTimestamp)(
          (0, smithy_client_1.expectNumber)(_),
        ),
      ),
  });
};
const deserializeMetadata = (output) => ({
  httpStatusCode: output.statusCode,
  requestId:
    output.headers["x-amzn-requestid"] ??
    output.headers["x-amzn-request-id"] ??
    output.headers["x-amz-request-id"],
  extendedRequestId: output.headers["x-amz-id-2"],
  cfId: output.headers["x-amz-cf-id"],
});
const collectBodyString = (streamBody, context) =>
  (0, smithy_client_1.collectBody)(streamBody, context).then((body) =>
    context.utf8Encoder(body),
  );
const _DEN = "DurableExecutionName";
const _FN = "FunctionName";
const _FV = "FunctionVersion";
const _IED = "IncludeExecutionData";
const _M = "Marker";
const _MI = "MaxItems";
const _RO = "ReverseOrder";
const _SF = "StatusFilter";
const _TA = "TimeAfter";
const _TB = "TimeBefore";
const _TF = "TimeFilter";
const _rAS = "retryAfterSeconds";
const _ra = "retry-after";
