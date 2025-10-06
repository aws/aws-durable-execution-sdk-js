import { EventType, OperationStatus, Event } from "@aws-sdk/client-lambda";
import { OperationHistoryEventDetails } from "./types";

export const chainedInvokeHistoryDetails = {
  [OperationStatus.CANCELLED]: {
    eventType: EventType.ChainedInvokeCancelled,
    detailPlace: "ChainedInvokeStoppedDetails",
  },
  [OperationStatus.FAILED]: {
    eventType: EventType.ChainedInvokeFailed,
    detailPlace: "ChainedInvokeFailedDetails",
  },
  [OperationStatus.SUCCEEDED]: {
    eventType: EventType.ChainedInvokeSucceeded,
    detailPlace: "ChainedInvokeSucceededDetails",
  },
  [OperationStatus.TIMED_OUT]: {
    eventType: EventType.ChainedInvokeTimedOut,
    detailPlace: "ChainedInvokeTimedOutDetails",
  },
  [OperationStatus.PENDING]: undefined,
  [OperationStatus.READY]: undefined,
  [OperationStatus.STARTED]: undefined,
  [OperationStatus.STOPPED]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
