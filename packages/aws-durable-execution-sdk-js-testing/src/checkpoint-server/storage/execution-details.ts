import { EventType, OperationStatus, Event } from "@aws-sdk/client-lambda";
import { OperationHistoryEventDetails } from "./types";

export const executionDetails = {
  [OperationStatus.STOPPED]: {
    eventType: EventType.ExecutionStopped,
    detailPlace: "ExecutionStoppedDetails",
  },
  [OperationStatus.FAILED]: {
    eventType: EventType.ExecutionFailed,
    detailPlace: "ExecutionFailedDetails",
  },
  [OperationStatus.STARTED]: {
    eventType: EventType.ExecutionStarted,
    detailPlace: "ExecutionStartedDetails",
  },
  [OperationStatus.SUCCEEDED]: {
    eventType: EventType.ExecutionSucceeded,
    detailPlace: "ExecutionSucceededDetails",
  },
  [OperationStatus.TIMED_OUT]: {
    eventType: EventType.ExecutionTimedOut,
    detailPlace: "ExecutionTimedOutDetails",
  },
  [OperationStatus.READY]: undefined,
  [OperationStatus.CANCELLED]: undefined,
  [OperationStatus.PENDING]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
