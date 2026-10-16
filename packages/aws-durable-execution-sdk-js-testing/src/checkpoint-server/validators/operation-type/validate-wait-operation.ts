import { invalidParameterValue } from "../invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

const allowedStatusToCancel: (OperationStatus | undefined)[] = [
  OperationStatus.STARTED,
];

/**
 * Validates a WAIT operation update against the current operation state.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateWaitOperation(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw invalidParameterValue(
          "Cannot start a WAIT operation that already exists.",
        );
      }
      if (update.WaitOptions == null) {
        throw invalidParameterValue(
          "Update for WAIT operation requires WaitOptions.",
        );
      }
      break;
    case OperationAction.CANCEL:
      // CANCEL is only allowed for a WAIT that exists and has not completed.
      if (!operation || !allowedStatusToCancel.includes(operation.Status)) {
        throw invalidParameterValue(
          "Cannot cancel a WAIT operation that does not exist or has already completed.",
        );
      }
      break;
    default:
      throw invalidParameterValue("Invalid action for WAIT operation.");
  }
}
