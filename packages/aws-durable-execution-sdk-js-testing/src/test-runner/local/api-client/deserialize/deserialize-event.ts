import {
  _json,
  expectInt32,
  expectNonNull,
  expectNumber,
  expectString,
  parseEpochTimestamp,
  take,
} from "@smithy/smithy-client";
import { Event } from "@aws-sdk/client-lambda";
import { SerializedEvent } from "../../../../checkpoint-server/types/operation-event";

const deserializeInvocationCompletedDetails = (output: unknown) => {
  return take(output, {
    EndTimestamp: (_) => expectNonNull(parseEpochTimestamp(expectNumber(_))),
    Error: _json,
    RequestId: expectString,
    StartTimestamp: (_) => expectNonNull(parseEpochTimestamp(expectNumber(_))),
  }) as unknown;
};

const deserializeWaitStartedDetails = (output: unknown) => {
  return take(output, {
    Duration: expectInt32,
    ScheduledEndTimestamp: (_) =>
      expectNonNull(parseEpochTimestamp(expectNumber(_))),
  }) as unknown;
};

export const deserializeEvent = (output: SerializedEvent) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return take(output, {
    CallbackFailedDetails: _json,
    CallbackStartedDetails: _json,
    CallbackSucceededDetails: _json,
    CallbackTimedOutDetails: _json,
    ChainedInvokeFailedDetails: _json,
    ChainedInvokeStartedDetails: _json,
    ChainedInvokeStoppedDetails: _json,
    ChainedInvokeSucceededDetails: _json,
    ChainedInvokeTimedOutDetails: _json,
    ContextFailedDetails: _json,
    ContextStartedDetails: _json,
    ContextSucceededDetails: _json,
    EventId: expectInt32,
    EventTimestamp: (_) => expectNonNull(parseEpochTimestamp(expectNumber(_))),
    EventType: expectString,
    ExecutionFailedDetails: _json,
    ExecutionStartedDetails: _json,
    ExecutionStoppedDetails: _json,
    ExecutionSucceededDetails: _json,
    ExecutionTimedOutDetails: _json,
    Id: expectString,
    InvocationCompletedDetails: (_) => deserializeInvocationCompletedDetails(_),
    Name: expectString,
    ParentId: expectString,
    StepFailedDetails: _json,
    StepStartedDetails: _json,
    StepSucceededDetails: _json,
    SubType: expectString,
    WaitCancelledDetails: _json,
    WaitStartedDetails: (_) => deserializeWaitStartedDetails(_),
    WaitSucceededDetails: _json,
  }) as Event;
};
