import { Operation, Event } from "@aws-sdk/client-lambda";
import { ConvertDatesToNumbers } from "../../types";
import { CheckpointOperation } from "../storage/checkpoint-manager";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";

export type SerializedOperation = ConvertDatesToNumbers<Operation>;
export type SerializedEvent = ConvertDatesToNumbers<Event>;

export interface SerializedOperationEvents {
  operation: SerializedOperation;
  events: SerializedEvent[];
}

export type SerializedCheckpointOperation = Omit<
  CheckpointOperation,
  keyof OperationEvents
> &
  SerializedOperationEvents;
