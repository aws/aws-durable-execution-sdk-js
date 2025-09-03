import { LambdaServiceException as __BaseException } from "../models/LambdaServiceException";
import {
  CallbackTimeoutException,
  InvalidParameterValueException,
  ResourceNotFoundException,
  ServiceException,
  TooManyRequestsException,
} from "../models/models_0";
import {
  loadRestJsonErrorCode,
  parseJsonBody as parseBody,
  parseJsonErrorBody as parseErrorBody,
} from "@aws-sdk/core";
import { requestBuilder as rb } from "@smithy/core";
import {
  decorateServiceException as __decorateServiceException,
  expectInt32 as __expectInt32,
  expectNonNull as __expectNonNull,
  expectNumber as __expectNumber,
  expectObject as __expectObject,
  expectString as __expectString,
  parseEpochTimestamp as __parseEpochTimestamp,
  serializeDateTime as __serializeDateTime,
  _json,
  collectBody,
  map,
  take,
  withBaseException,
} from "@smithy/smithy-client";
export const se_CheckpointDurableExecutionCommand = async (input, context) => {
  const b = rb(input, context);
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
    take(input, {
      ClientToken: [],
      Updates: (_) => _json(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
export const se_GetDurableExecutionCommand = async (input, context) => {
  const b = rb(input, context);
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
export const se_GetDurableExecutionHistoryCommand = async (input, context) => {
  const b = rb(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  const query = map({
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
export const se_GetDurableExecutionStateCommand = async (input, context) => {
  const b = rb(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-execution-state/{CheckpointToken}/getState");
  b.p(
    "CheckpointToken",
    () => input.CheckpointToken,
    "{CheckpointToken}",
    false,
  );
  const query = map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
export const se_ListDurableExecutionsCommand = async (input, context) => {
  const b = rb(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions");
  const query = map({
    [_FN]: [, input[_FN]],
    [_FV]: [, input[_FV]],
    [_DEN]: [, input[_DEN]],
    [_SF]: [, input[_SF]],
    [_TF]: [, input[_TF]],
    [_TA]: [
      () => input.TimeAfter !== void 0,
      () => __serializeDateTime(input[_TA]).toString(),
    ],
    [_TB]: [
      () => input.TimeBefore !== void 0,
      () => __serializeDateTime(input[_TB]).toString(),
    ],
    [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
export const se_SendDurableExecutionCallbackFailureCommand = async (
  input,
  context,
) => {
  const b = rb(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  if (input.Error !== undefined) {
    body = _json(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
export const se_SendDurableExecutionCallbackHeartbeatCommand = async (
  input,
  context,
) => {
  const b = rb(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  b.m("POST").h(headers).b(body);
  return b.build();
};
export const se_SendDurableExecutionCallbackSuccessCommand = async (
  input,
  context,
) => {
  const b = rb(input, context);
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
export const se_StopDurableExecutionCommand = async (input, context) => {
  const b = rb(input, context);
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
    body = _json(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
export const de_CheckpointDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    CheckpointToken: __expectString,
    NewExecutionState: (_) => de_CheckpointUpdatedExecutionState(_, context),
  });
  Object.assign(contents, doc);
  return contents;
};
export const de_GetDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    DurableExecutionArn: __expectString,
    DurableExecutionName: __expectString,
    Error: _json,
    FunctionArn: __expectString,
    InputPayload: __expectString,
    Result: __expectString,
    StartDate: (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    Status: __expectString,
    StopDate: (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    Version: __expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
export const de_GetDurableExecutionHistoryCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    Events: (_) => de_Events(_, context),
    NextMarker: __expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
export const de_GetDurableExecutionStateCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    NextMarker: __expectString,
    Operations: (_) => de_Operations(_, context),
  });
  Object.assign(contents, doc);
  return contents;
};
export const de_ListDurableExecutionsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    DurableExecutions: (_) => de_DurableExecutions(_, context),
    NextMarker: __expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
export const de_SendDurableExecutionCallbackFailureCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  await collectBody(output.body, context);
  return contents;
};
export const de_SendDurableExecutionCallbackHeartbeatCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  await collectBody(output.body, context);
  return contents;
};
export const de_SendDurableExecutionCallbackSuccessCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  await collectBody(output.body, context);
  return contents;
};
export const de_StopDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = map({
    $metadata: deserializeMetadata(output),
  });
  const data = __expectNonNull(
    __expectObject(await parseBody(output.body, context)),
    "body",
  );
  const doc = take(data, {
    StopDate: (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CommandError = async (output, context) => {
  const parsedOutput = {
    ...output,
    body: await parseErrorBody(output.body, context),
  };
  const errorCode = loadRestJsonErrorCode(output, parsedOutput.body);
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
const throwDefaultError = withBaseException(__BaseException);
const de_CallbackTimeoutExceptionRes = async (parsedOutput, context) => {
  const contents = map({});
  const data = parsedOutput.body;
  const doc = take(data, {
    message: __expectString,
  });
  Object.assign(contents, doc);
  const exception = new CallbackTimeoutException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidParameterValueExceptionRes = async (parsedOutput, context) => {
  const contents = map({});
  const data = parsedOutput.body;
  const doc = take(data, {
    Type: __expectString,
    message: __expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidParameterValueException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return __decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceNotFoundExceptionRes = async (parsedOutput, context) => {
  const contents = map({});
  const data = parsedOutput.body;
  const doc = take(data, {
    Message: __expectString,
    Type: __expectString,
  });
  Object.assign(contents, doc);
  const exception = new ResourceNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return __decorateServiceException(exception, parsedOutput.body);
};
const de_ServiceExceptionRes = async (parsedOutput, context) => {
  const contents = map({});
  const data = parsedOutput.body;
  const doc = take(data, {
    Message: __expectString,
    Type: __expectString,
  });
  Object.assign(contents, doc);
  const exception = new ServiceException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return __decorateServiceException(exception, parsedOutput.body);
};
const de_TooManyRequestsExceptionRes = async (parsedOutput, context) => {
  const contents = map({
    [_rAS]: [, parsedOutput.headers[_ra]],
  });
  const data = parsedOutput.body;
  const doc = take(data, {
    Reason: __expectString,
    Type: __expectString,
    message: __expectString,
  });
  Object.assign(contents, doc);
  const exception = new TooManyRequestsException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return __decorateServiceException(exception, parsedOutput.body);
};
const de_CheckpointUpdatedExecutionState = (output, context) => {
  return take(output, {
    NextMarker: __expectString,
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
  return take(output, {
    CallbackFailedDetails: _json,
    CallbackStartedDetails: _json,
    CallbackSucceededDetails: _json,
    CallbackTimedOutDetails: _json,
    ContextFailedDetails: _json,
    ContextStartedDetails: _json,
    ContextSucceededDetails: _json,
    EventId: __expectInt32,
    EventTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    EventType: __expectString,
    ExecutionFailedDetails: _json,
    ExecutionStartedDetails: _json,
    ExecutionStoppedDetails: _json,
    ExecutionSucceededDetails: _json,
    ExecutionTimedOutDetails: _json,
    Id: __expectString,
    InvokeCancelledDetails: _json,
    InvokeFailedDetails: _json,
    InvokeStartedDetails: _json,
    InvokeSucceededDetails: _json,
    InvokeTimedOutDetails: _json,
    Name: __expectString,
    ParentId: __expectString,
    StepFailedDetails: _json,
    StepStartedDetails: _json,
    StepSucceededDetails: _json,
    SubType: __expectString,
    WaitCancelledDetails: _json,
    WaitStartedDetails: (_) => de_WaitStartedDetails(_, context),
    WaitSucceededDetails: _json,
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
  return take(output, {
    DurableExecutionArn: __expectString,
    DurableExecutionName: __expectString,
    FunctionArn: __expectString,
    StartDate: (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    Status: __expectString,
    StopDate: (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
  });
};
const de_Operation = (output, context) => {
  return take(output, {
    CallbackDetails: _json,
    ContextDetails: _json,
    EndTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    ExecutionDetails: _json,
    Id: __expectString,
    InvokeDetails: _json,
    Name: __expectString,
    ParentId: __expectString,
    StartTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    Status: __expectString,
    StepDetails: (_) => de_StepDetails(_, context),
    SubType: __expectString,
    Type: __expectString,
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
  return take(output, {
    Attempt: __expectInt32,
    Error: _json,
    NextAttemptTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    Result: __expectString,
  });
};
const de_WaitDetails = (output, context) => {
  return take(output, {
    ScheduledTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
  });
};
const de_WaitStartedDetails = (output, context) => {
  return take(output, {
    Duration: __expectInt32,
    ScheduledEndTimestamp: (_) =>
      __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
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
  collectBody(streamBody, context).then((body) => context.utf8Encoder(body));
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
