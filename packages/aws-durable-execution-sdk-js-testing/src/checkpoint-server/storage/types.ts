import { EventType, Event } from "@aws-sdk/client-lambda";
import { Operation } from "@aws/durable-execution-sdk-js";

export interface OperationHistoryEventDetails<T extends keyof Event> {
  eventType: EventType;
  detailPlace: T;
  getDetails?: (operation: Operation) => Event[T];
}
