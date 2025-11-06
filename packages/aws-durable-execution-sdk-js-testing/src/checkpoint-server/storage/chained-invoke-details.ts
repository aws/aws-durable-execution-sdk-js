import { EventType, OperationStatus, Event } from "@aws-sdk/client-lambda";
import { OperationHistoryEventDetails } from "./types";

export const chainedInvokeHistoryDetails = {
  [OperationStatus.STOPPED]: {
    eventType: EventType.ChainedInvokeStopped,
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
  [OperationStatus.CANCELLED]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
