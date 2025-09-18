import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws-sdk/client-lambda";

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
  operation: Operation | undefined
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw new InvalidParameterValueException({
          message: "Cannot start a WAIT that already exists.",
          $metadata: {},
        });
      }
      break;
    case OperationAction.CANCEL:
      if (!operation || !allowedStatusToCancel.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message:
            "Cannot cancel a WAIT that does not exist or has already completed.",
          $metadata: {},
        });
      }
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid WAIT action.",
        $metadata: {},
      });
  }
}
