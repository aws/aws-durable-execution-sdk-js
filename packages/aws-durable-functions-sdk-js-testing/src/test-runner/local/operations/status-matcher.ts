import { OperationStatus } from "@amzn/dex-internal-sdk";
import { WaitingOperationStatus } from "../../durable-test-runner";

const STARTED_STATUSES: OperationStatus[] = Object.values(OperationStatus);
const COMPLETED_STATUSES: OperationStatus[] = [
  OperationStatus.CANCELLED,
  OperationStatus.FAILED,
  OperationStatus.STOPPED,
  OperationStatus.SUCCEEDED,
  OperationStatus.TIMED_OUT,
];

/**
 * Checks if the current operation status matches the expected waiting status.
 * @param status The current operation status
 * @param expectedStatus The expected waiting status to check against
 * @returns true if the current status matches the expected waiting status
 */
export function doesStatusMatch(
  status: OperationStatus | undefined,
  expectedStatus: WaitingOperationStatus
): boolean {
  if (!status) {
    return false;
  }

  const hasStartedStatus =
    expectedStatus === WaitingOperationStatus.STARTED &&
    STARTED_STATUSES.includes(status);

  const hasCompletedStatus =
    expectedStatus === WaitingOperationStatus.COMPLETED &&
    COMPLETED_STATUSES.includes(status);

  return hasStartedStatus || hasCompletedStatus;
}
