import { Operation, WireOperation } from "../../types/wire";
import { toDate } from "../timestamp/timestamp";

/**
 * Normalizes an operation as it enters the SDK.
 *
 * Operations arrive from two transports that represent timestamps differently — ISO-8601
 * strings on the Lambda invocation event, `Date` instances on AWS SDK responses. This
 * function is applied at each of those boundaries so that everything downstream, including
 * `DurableContext` and the instrumentation plugin surface, sees a single normalized shape
 * with real `Date`s.
 *
 * Only the timestamp fields are converted; every other member is carried across
 * unchanged.
 *
 * @param operation - The operation as it appeared on the wire.
 * @returns The operation with its timestamps normalized to `Date`.
 */
export const normalizeOperation = (operation: WireOperation): Operation => {
  const { StartTimestamp, EndTimestamp, StepDetails, WaitDetails, ...rest } =
    operation;

  const normalized: Operation = {
    ...rest,
    StartTimestamp: toDate(StartTimestamp),
  };

  // Assign the optional members only when present, so a normalized operation
  // round-trips to the same key set as the wire operation it came from.
  if ("EndTimestamp" in operation) {
    normalized.EndTimestamp = toDate(EndTimestamp);
  }

  if (StepDetails !== undefined) {
    normalized.StepDetails = {
      ...StepDetails,
      NextAttemptTimestamp: toDate(StepDetails.NextAttemptTimestamp),
    };
  } else if ("StepDetails" in operation) {
    normalized.StepDetails = StepDetails;
  }

  if (WaitDetails !== undefined) {
    normalized.WaitDetails = {
      ...WaitDetails,
      ScheduledEndTimestamp: toDate(WaitDetails.ScheduledEndTimestamp),
    };
  } else if ("WaitDetails" in operation) {
    normalized.WaitDetails = WaitDetails;
  }

  return normalized;
};

/**
 * Normalizes a list of operations. See {@link normalizeOperation}.
 *
 * @param operations - The operations as they appeared on the wire.
 * @returns The operations with their timestamps normalized to `Date`.
 */
export const normalizeOperations = (
  operations: readonly WireOperation[],
): Operation[] => operations.map(normalizeOperation);
