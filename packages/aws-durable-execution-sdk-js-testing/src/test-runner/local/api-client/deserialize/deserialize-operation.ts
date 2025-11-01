import {
  _json,
  expectInt32,
  expectNonNull,
  expectNumber,
  expectString,
  parseEpochTimestamp,
  take,
} from "@smithy/smithy-client";
import { ConvertDatesToNumbers } from "../../../../types";
import { Operation } from "@aws-sdk/client-lambda";

export type SerializedOperation = ConvertDatesToNumbers<Operation>;

const deserializeStepDetails = (output: unknown) => {
  return take(output, {
    Attempt: expectInt32,
    Error: _json,
    NextAttemptTimestamp: (_) =>
      expectNonNull(parseEpochTimestamp(expectNumber(_))),
    Result: expectString,
  }) as unknown;
};

const deserializeWaitDetails = (output: unknown) => {
  return take(output, {
    ScheduledEndTimestamp: (_) =>
      expectNonNull(parseEpochTimestamp(expectNumber(_))),
  }) as unknown;
};

export const deserializeOperation = (output: SerializedOperation) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return take(output, {
    CallbackDetails: _json,
    ChainedInvokeDetails: _json,
    ContextDetails: _json,
    EndTimestamp: (_) => expectNonNull(parseEpochTimestamp(expectNumber(_))),
    ExecutionDetails: _json,
    Id: expectString,
    Name: expectString,
    ParentId: expectString,
    StartTimestamp: (_) => expectNonNull(parseEpochTimestamp(expectNumber(_))),
    Status: expectString,
    StepDetails: (_) => deserializeStepDetails(_),
    SubType: expectString,
    Type: expectString,
    WaitDetails: (_) => deserializeWaitDetails(_),
  }) as Operation;
};
