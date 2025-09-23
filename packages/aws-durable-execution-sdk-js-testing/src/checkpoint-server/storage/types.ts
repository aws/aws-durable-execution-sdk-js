import { EventType, Operation, Event } from "@aws-sdk/client-lambda";

export interface OperationHistoryEventDetails<T extends keyof Event> {
  eventType: EventType;
  detailPlace: T;
  getDetails?: (operation: Operation) => Event[T];
}
