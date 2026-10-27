import { invalidParameterValue } from "../invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

const allowedStatusToClose: (OperationStatus | undefined)[] = [
  OperationStatus.STARTED,
];

/**
 * Validates a CONTEXT operation update against the current operation state.
 * Allows immediate checkpointing without starting, but if started, only allows FAIL/SUCCEED when status is STARTED.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateContextOperation(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw invalidParameterValue(
          "Cannot start a CONTEXT operation that already exists.",
        );
      }
      break;
    case OperationAction.FAIL:
    case OperationAction.SUCCEED:
      if (operation && !allowedStatusToClose.includes(operation.Status)) {
        throw invalidParameterValue("Invalid current CONTEXT state to close.");
      }
      if (update.Action === OperationAction.FAIL && update.Payload != null) {
        throw invalidParameterValue(
          "Cannot provide a Payload for FAIL action.",
        );
      }
      if (update.Action === OperationAction.SUCCEED && update.Error != null) {
        throw invalidParameterValue(
          "Cannot provide an Error for SUCCEED action.",
        );
      }
      break;
    default:
      throw invalidParameterValue("Invalid action for CONTEXT operation.");
  }
}
