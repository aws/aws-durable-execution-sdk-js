import { WireTimestamp } from "../../types/wire";

/**
 * Normalizes a timestamp from the durable execution wire protocol into a `Date`.
 *
 * Timestamps reach the SDK in two representations depending on transport: as ISO-8601
 * strings when they arrive on the Lambda invocation event, and as `Date` instances when
 * they are deserialized from an API response. See {@link WireTimestamp}. Internal code and
 * the instrumentation plugin surface work exclusively with `Date`, so every wire timestamp
 * is passed through this function on the way in.
 *
 * @param timestamp - The timestamp as it appeared on the wire.
 * @returns The equivalent `Date`, or `undefined` if the timestamp was absent or could not
 *          be parsed. An unparseable timestamp is treated as absent rather than surfaced
 *          as an `Invalid Date`, so that a malformed value from the service degrades
 *          observability instead of corrupting it.
 */
export const toDate = (
  timestamp: WireTimestamp | undefined,
): Date | undefined => {
  if (timestamp === undefined) {
    return undefined;
  }

  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
