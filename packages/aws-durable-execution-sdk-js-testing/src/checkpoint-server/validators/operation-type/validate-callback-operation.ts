import { invalidParameterValue } from "../invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

/**
 * Validates a CALLBACK operation update against the current operation state.
 * A checkpoint can only start a CALLBACK. The service completes it.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateCallbackOperation(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw invalidParameterValue(
          "Cannot start a CALLBACK operation that already exists.",
        );
      }
      break;
    default:
      throw invalidParameterValue("Invalid action for CALLBACK operation.");
  }
}
