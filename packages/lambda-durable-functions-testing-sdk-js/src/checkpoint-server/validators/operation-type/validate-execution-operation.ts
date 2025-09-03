import {
  InvalidParameterValueException,
  OperationAction,
  OperationUpdate,
} from "@amzn/dex-internal-sdk";

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
        throw new InvalidParameterValueException({
          message: "Cannot provide an Error for SUCCEED action.",
          $metadata: {},
        });
      }
      break;
    case OperationAction.FAIL:
      if (update.Payload != null) {
        throw new InvalidParameterValueException({
          message: "Cannot provide a Payload for FAIL action.",
          $metadata: {},
        });
      }
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid EXECUTION action.",
        $metadata: {},
      });
  }
}
