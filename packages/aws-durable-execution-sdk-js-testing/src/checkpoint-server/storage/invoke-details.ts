import { EventType, OperationStatus, Event } from "@aws-sdk/client-lambda";
import { OperationHistoryEventDetails } from "./types";

export const invokeHistoryDetails = {
  [OperationStatus.CANCELLED]: {
    eventType: EventType.InvokeCancelled,
    detailPlace: "InvokeStoppedDetails",
  },
  [OperationStatus.FAILED]: {
    eventType: EventType.InvokeFailed,
    detailPlace: "InvokeFailedDetails",
  },
  [OperationStatus.SUCCEEDED]: {
    eventType: EventType.InvokeSucceeded,
    detailPlace: "InvokeSucceededDetails",
  },
  [OperationStatus.TIMED_OUT]: {
    eventType: EventType.InvokeTimedOut,
    detailPlace: "InvokeTimedOutDetails",
  },
  [OperationStatus.PENDING]: undefined,
  [OperationStatus.READY]: undefined,
  [OperationStatus.STARTED]: undefined,
  [OperationStatus.STOPPED]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
