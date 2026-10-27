import { invalidParameterValue } from "../invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";

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
  operation: Operation | undefined,
): void {
  switch (update.Action) {
    case OperationAction.START:
      if (operation && !allowedStatusToStart.includes(operation.Status)) {
        throw invalidParameterValue("Invalid current STEP state to start.");
      }
      break;
    case OperationAction.FAIL:
    case OperationAction.SUCCEED:
      if (operation && !allowedStatusToClose.includes(operation.Status)) {
        throw invalidParameterValue("Invalid current STEP state to close.");
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
    case OperationAction.RETRY:
      if (operation && !allowedStatusToReattempt.includes(operation.Status)) {
        throw invalidParameterValue("Invalid current STEP state to retry.");
      }
      if (update.StepOptions == null) {
        throw invalidParameterValue(
          "RETRY action for STEP operation requires StepOptions.",
        );
      }
      if (update.Error != null && update.Payload != null) {
        throw invalidParameterValue(
          "Cannot provide both an Error and Payload for RETRY action.",
        );
      }
      break;
    default:
      throw invalidParameterValue("Invalid action for STEP operation.");
  }
}
