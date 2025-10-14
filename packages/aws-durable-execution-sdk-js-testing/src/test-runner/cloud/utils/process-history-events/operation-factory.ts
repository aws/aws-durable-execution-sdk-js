import { Operation, Event } from "@aws-sdk/client-lambda";
import { OperationEvents } from "../../../common/operations/operation-with-data";
import { HistoryEventType } from "./history-event-types";
import { HistoryEventTypes } from "./operation-types";
import { addOperationDetails } from "./operation-details";
import {
  getErrorFromEvent,
  getPayloadFromEvent,
} from "./event-data-extractors";

/**
 * Creates an Operation object from an event and its history event type configuration.
 * This function builds the base operation structure, merging with any previous operation data
 * and setting appropriate timestamps based on whether the event marks the start or end of an operation.
 *
 * @param previousOperationEvents - Previously processed operation events for the same operation ID, if any
 * @param event - The current event being processed
 * @param historyEventType - Configuration object defining how this event type should be processed
 * @returns A new Operation object with basic properties populated
 */
export function createOperation(
  previousOperationEvents: OperationEvents | undefined,
  event: Event,
  historyEventType: HistoryEventType,
): Operation {
  const operation: Operation = {
    // Most fields are immutable, so they should get overwritten by previous events.
    // Later events may return undefined which shouldn't overwrite the previous data.
    Name: event.Name,
    ParentId: event.ParentId,
    Id: event.Id,
    Type: historyEventType.operationType,
    SubType: event.SubType,
    StartTimestamp: new Date(),
    ...previousOperationEvents?.operation,
    // Only the status can be overwritten from the previous operation
    Status: historyEventType.operationStatus,
  };

  if (historyEventType.isStartEvent) {
    operation.StartTimestamp = event.EventTimestamp;
  }

  if (historyEventType.isEndEvent) {
    operation.EndTimestamp = event.EventTimestamp;
  }

  return operation;
}

/**
 * Populates operation-specific details based on the event type and extracted data.
 * This function handles the complex logic of extracting payloads, errors, and operation-specific
 * information from events and adding them to the appropriate operation detail fields.
 *
 * The function processes different operation types with their specific requirements:
 * - EXECUTION: Adds input payload information
 * - CALLBACK: Adds callback ID from callback events
 * - STEP: Adds retry attempt information and next attempt timestamps
 * - WAIT: Adds scheduled timestamp information
 *
 * @param event - The event containing the data to extract
 * @param historyEventType - Configuration defining how to process this event type
 * @param operation - The operation object to populate with details (modified in place)
 * @throws {Error} When EventTimestamp is missing from the event
 *
 */
export function populateOperationDetails(
  event: Event,
  historyEventType: HistoryEventTypes,
  operation: Operation,
) {
  if (!event.EventTimestamp) {
    throw new Error("Missing required fields in event");
  }

  const payload = getPayloadFromEvent(event, historyEventType.detailPlace);
  const error = getErrorFromEvent(event, historyEventType.detailPlace);

  if (historyEventType.hasResult) {
    addOperationDetails(operation, historyEventType.operationDetailPlace, {
      Result: payload,
      Error: error,
    });
  }

  switch (historyEventType.operationType) {
    case "CALLBACK":
      addOperationDetails(operation, historyEventType.operationDetailPlace, {
        CallbackId: event.CallbackStartedDetails?.CallbackId,
      });
      break;
    case "STEP":
      addOperationDetails(operation, historyEventType.operationDetailPlace, {
        Attempt: event.StepFailedDetails?.RetryDetails?.CurrentAttempt,
        NextAttemptTimestamp:
          event.StepFailedDetails?.RetryDetails?.NextAttemptDelaySeconds !==
          undefined
            ? new Date(
                event.EventTimestamp.getTime() +
                  event.StepFailedDetails.RetryDetails.NextAttemptDelaySeconds *
                    1000,
              )
            : undefined,
      });
      break;
    case "WAIT":
      addOperationDetails(operation, historyEventType.operationDetailPlace, {
        ScheduledEndTimestamp: event.WaitStartedDetails?.ScheduledEndTimestamp,
      });
      break;
    case "EXECUTION":
      addOperationDetails(operation, historyEventType.operationDetailPlace, {
        InputPayload: event.ExecutionStartedDetails?.Input?.Payload,
      });
      break;
    default:
      break;
  }
}
