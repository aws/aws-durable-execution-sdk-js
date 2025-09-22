import { ErrorObject, Event } from "@aws-sdk/client-lambda";
import { HistoryEventTypes } from "./operation-types";

/**
 * Extracts error information from an event's detail section.
 * Looks for error payload data in the specified detail place of the event.
 *
 * @param event - The event object to extract error information from
 * @param detailPlace - The property name where event details are stored
 * @returns The error object if found, undefined otherwise
 */
export function getErrorFromEvent(
  event: Event,
  detailPlace: HistoryEventTypes["detailPlace"]
): ErrorObject | undefined {
  const details = event[detailPlace];
  if (!details) {
    return undefined;
  }

  if ("Error" in details) {
    return details.Error?.Payload;
  }

  return undefined;
}

/**
 * Extracts payload data from an event's detail section.
 * Looks for either input or result payload data in the specified detail place of the event.
 *
 * @param event - The event object to extract payload information from
 * @param detailPlace - The property name where event details are stored
 * @returns The payload string if found (either from Input or Result), undefined otherwise
 */
export function getPayloadFromEvent(
  event: Event,
  detailPlace: HistoryEventTypes["detailPlace"]
): string | undefined {
  const details = event[detailPlace];
  if (!details) {
    return undefined;
  }

  if ("Input" in details && "Result" in details) {
    throw new Error("Event contains both Input and Result");
  }

  if ("Input" in details) {
    return details.Input?.Payload;
  }

  if ("Result" in details) {
    return details.Result?.Payload;
  }

  return undefined;
}
