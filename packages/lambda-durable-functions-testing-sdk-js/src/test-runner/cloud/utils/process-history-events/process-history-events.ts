import { Event, OperationType } from "@amzn/dex-internal-sdk";
import { OperationEvents } from "../../../common/operations/operation-with-data";
import { historyEventTypes } from "./history-event-types";
import { createOperation, populateOperationDetails } from "./operation-factory";

/**
 * Converts an array of history events into structured operation events.
 * This function processes raw history events and groups them by operation ID, creating
 * comprehensive operation objects with associated events and detailed information.
 *
 * The function handles various event types (execution, callback, context, invoke, step, wait)
 * and their different statuses (started, succeeded, failed, timed out, etc.), extracting
 * relevant data such as payloads, errors, timestamps, and operation-specific details.
 *
 * @param events - Array of history events to process
 * @returns Array of operation events, each containing an operation object and its associated events
 * @throws {Error} When required fields (EventType, Id, EventTimestamp) are missing from an event
 */
export function historyEventsToOperationEvents(
  events: Event[]
): OperationEvents[] {
  const operationEvents = new Map<string, OperationEvents>();
  for (const event of events) {
    if (!event.EventType || !event.Id) {
      throw new Error("Missing required fields in event");
    }

    const historyEventType = historyEventTypes[event.EventType];

    if (historyEventType.operationType === OperationType.EXECUTION) {
      // Skip populating the EXECUTION operation type
      continue;
    }

    const previousOperationEvents = operationEvents.get(event.Id);

    const operation = createOperation(
      previousOperationEvents,
      event,
      historyEventType
    );

    populateOperationDetails(event, historyEventType, operation);

    operationEvents.set(event.Id, {
      operation,
      events: [...(previousOperationEvents?.events ?? []), event],
    });
  }

  return Array.from(operationEvents.values());
}
