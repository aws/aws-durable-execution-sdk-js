import {
  EventType,
  OperationStatus,
  Event,
} from "@aws-sdk/client-lambda";
import { OperationHistoryEventDetails } from "./types";

export const waitHistoryDetails = {
  [OperationStatus.CANCELLED]: {
    eventType: EventType.WaitCancelled,
    detailPlace: "WaitCancelledDetails",
  },
  [OperationStatus.SUCCEEDED]: {
    eventType: EventType.WaitSucceeded,
    detailPlace: "WaitSucceededDetails",
  },
  [OperationStatus.FAILED]: undefined,
  [OperationStatus.PENDING]: undefined,
  [OperationStatus.READY]: undefined,
  [OperationStatus.STARTED]: undefined,
  [OperationStatus.STOPPED]: undefined,
  [OperationStatus.TIMED_OUT]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
