import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws-sdk/client-lambda";

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
  operation: Operation | undefined
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation) {
        throw new InvalidParameterValueException({
          message: "Cannot start a CONTEXT that already exists.",
          $metadata: {},
        });
      }
      break;
    case OperationAction.FAIL:
    case OperationAction.SUCCEED:
      if (operation && !allowedStatusToClose.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message: "Invalid current CONTEXT state to close.",
          $metadata: {},
        });
      }
      if (update.Action === OperationAction.FAIL && update.Payload != null) {
        throw new InvalidParameterValueException({
          message: "Cannot provide a Payload for FAIL action.",
          $metadata: {},
        });
      }
      if (update.Action === OperationAction.SUCCEED && update.Error != null) {
        throw new InvalidParameterValueException({
          message: "Cannot provide an Error for SUCCEED action.",
          $metadata: {},
        });
      }
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid CONTEXT action.",
        $metadata: {},
      });
  }
}
