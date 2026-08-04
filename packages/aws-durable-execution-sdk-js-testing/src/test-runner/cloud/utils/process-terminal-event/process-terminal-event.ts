import { Event, EventType } from "@aws-sdk/client-lambda";
import { OperationType } from "@aws/durable-execution-sdk-js";
import { historyEventTypes } from "../process-history-events/history-event-types";

type EventWithType = Event & {
  EventType: EventType;
};

export function isClosedExecution(
  lastEvent: Event | undefined,
): lastEvent is EventWithType {
  if (!lastEvent?.EventType) {
    return false;
  }

  const historyEventType = historyEventTypes[lastEvent.EventType];

  return (
    historyEventType.isEndEvent &&
    historyEventType.operationType === OperationType.EXECUTION
  );
}
