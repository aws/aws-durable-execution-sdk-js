import { invalidParameterValue } from "../invalid-parameter-value";
import {
  OperationAction,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

/**
 * Validates an EXECUTION operation update. Only allows SUCCEED and FAIL actions.
 *
 * @param update - The operation update to validate
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateExecutionOperation(update: OperationUpdate): void {
  switch (update.Action) {
    case OperationAction.SUCCEED:
      if (update.Error != null) {
        throw invalidParameterValue(
          "Cannot provide an Error for SUCCEED action.",
        );
      }
      break;
    case OperationAction.FAIL:
      if (update.Payload != null) {
        throw invalidParameterValue(
          "Cannot provide a Payload for FAIL action.",
        );
      }
      break;
    default:
      throw invalidParameterValue("Invalid action for EXECUTION operation.");
  }
}
