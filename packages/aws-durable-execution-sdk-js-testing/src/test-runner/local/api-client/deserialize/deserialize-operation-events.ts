import { OperationUpdate } from "@aws-sdk/client-lambda";
import { _json } from "@smithy/smithy-client";
import {
  SerializedCheckpointOperation,
  SerializedOperationEvents,
} from "../../../../checkpoint-server/types/operation-event";
import { deserializeEvent } from "./deserialize-event";
import { deserializeOperation } from "./deserialize-operation";

export const deserializeCheckpointOperation = ({
  update,
  operation,
  events,
}: SerializedCheckpointOperation) => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    update: _json(update) as OperationUpdate,
    operation: deserializeOperation(operation),
    events: events.map((event) => deserializeEvent(event)),
  };
};

export const deserializeOperationEvent = ({
  operation,
  events,
}: SerializedOperationEvents) => {
  return {
    operation: deserializeOperation(operation),
    events: events.map((event) => deserializeEvent(event)),
  };
};

export const deserializeOperationEvents = (
  operationEvents: SerializedOperationEvents[],
) => {
  return operationEvents.map((operationEvent) =>
    deserializeOperationEvent(operationEvent),
  );
};
