import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@amzn/dex-internal-sdk";

const allowedStatusToClose: (OperationStatus | undefined)[] = [
  OperationStatus.STARTED, // Closing an at-most-once step
  OperationStatus.READY, // Closing an at-least-once step on its non-initial attempt
];

const allowedStatusToStart: (OperationStatus | undefined)[] = [
  OperationStatus.READY, // Starting subsequent attempt of an at-most-once step after wait time has elapsed.
];

const allowedStatusToReattempt: (OperationStatus | undefined)[] = [
  OperationStatus.STARTED, // Retry for at-most-once step
  OperationStatus.READY, // Retry for at-least-once step on its non-initial attempt
];

/**
 * Validates a STEP operation update against the current operation state.
 * Supports at-least-once semantics allowing transitions from non-existent to any state.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation update is invalid
 */
export function validateStepOperation(
  update: OperationUpdate,
  operation: Operation | undefined
): void {
  if (!operation) {
    // Always allow a transition from non-existent -> any state (at-least-once semantics).
    return;
  }

  switch (update.Action) {
    case OperationAction.START:
      if (!allowedStatusToStart.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message: "Invalid current STEP state to start.",
          $metadata: {},
        });
      }
      break;
    case OperationAction.FAIL:
    case OperationAction.SUCCEED:
      if (!allowedStatusToClose.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message: "Invalid current STEP state to close.",
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
    case OperationAction.RETRY:
      if (!allowedStatusToReattempt.includes(operation.Status)) {
        throw new InvalidParameterValueException({
          message: "Invalid current STEP state to re-attempt.",
          $metadata: {},
        });
      }
      if (update.StepOptions == null) {
        throw new InvalidParameterValueException({
          message: "Invalid StepOptions for the given action.",
          $metadata: {},
        });
      }
      if (update.Error != null && update.Payload != null) {
        throw new InvalidParameterValueException({
          message: "Cannot provide both error and payload to RETRY a STEP.",
          $metadata: {},
        });
      }
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid STEP action.",
        $metadata: {},
      });
  }
}
