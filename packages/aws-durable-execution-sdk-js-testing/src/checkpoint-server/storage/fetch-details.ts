import { Event } from "@aws-sdk/client-lambda";
import { OperationStatus } from "@aws/durable-execution-sdk-js";
import { OperationHistoryEventDetails } from "./types";
import { FetchEventType, pendingFetchEventType } from "../pending-fetch-events";

/**
 * Maps the terminal status the backend records against a fetch to the history event that
 * status produces.
 *
 * `SUCCEEDED` covers every completed HTTP exchange, including 4xx and 5xx responses — the
 * status code lives in the event details, not in the operation status. `FAILED` and
 * `TIMED_OUT` mean no response was received at all.
 *
 * The non-terminal statuses map to `undefined`, matching `chainedInvokeHistoryDetails`:
 * reaching `updateOperation` with one of them is a bug, and the caller turns the
 * `undefined` into a thrown error naming the status.
 */
export const fetchHistoryDetails = {
  [OperationStatus.STOPPED]: {
    eventType: pendingFetchEventType(FetchEventType.FetchStopped),
    detailPlace: "FetchStoppedDetails",
  },
  [OperationStatus.FAILED]: {
    eventType: pendingFetchEventType(FetchEventType.FetchFailed),
    detailPlace: "FetchFailedDetails",
  },
  [OperationStatus.SUCCEEDED]: {
    eventType: pendingFetchEventType(FetchEventType.FetchSucceeded),
    detailPlace: "FetchSucceededDetails",
  },
  [OperationStatus.TIMED_OUT]: {
    eventType: pendingFetchEventType(FetchEventType.FetchTimedOut),
    detailPlace: "FetchTimedOutDetails",
  },
  [OperationStatus.PENDING]: undefined,
  [OperationStatus.READY]: undefined,
  [OperationStatus.STARTED]: undefined,
  [OperationStatus.CANCELLED]: undefined,
} satisfies Record<
  OperationStatus,
  OperationHistoryEventDetails<keyof Event> | undefined
>;
