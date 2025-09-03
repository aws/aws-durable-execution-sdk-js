import {
  InvalidParameterValueException,
  OperationAction,
  OperationType,
} from "@amzn/dex-internal-sdk";

const VALID_ACTIONS_FOR_STEP = new Set([
  OperationAction.START,
  OperationAction.FAIL,
  OperationAction.RETRY,
  OperationAction.SUCCEED,
]);

const VALID_ACTIONS_FOR_CONTEXT = new Set([
  OperationAction.START,
  OperationAction.FAIL,
  OperationAction.SUCCEED,
]);

const VALID_ACTIONS_FOR_WAIT = new Set([
  OperationAction.START,
  OperationAction.CANCEL,
]);

const VALID_ACTIONS_FOR_CALLBACK = new Set([
  OperationAction.START,
  OperationAction.CANCEL,
]);

const VALID_ACTIONS_FOR_INVOKE = new Set([
  OperationAction.START,
  OperationAction.CANCEL,
]);

const VALID_ACTIONS_FOR_EXECUTION = new Set([
  OperationAction.SUCCEED,
  OperationAction.FAIL,
]);

/**
 * A validator to validate that the given action is valid for the given operation type.
 */
/**
 * Validates that the given action is valid for the given operation type.
 * This is a basic validation that doesn't consider the current operation status.
 *
 * @param operationType - The type of operation to validate against
 * @param action - The action to validate
 * @throws {InvalidParameterValueException} When the action is not valid for the operation type
 */
export function validateValidActionsByOperationType(
  operationType?: OperationType,
  action?: OperationAction
): void {
  let validActions: Set<OperationAction>;

  switch (operationType) {
    case OperationType.STEP:
      validActions = VALID_ACTIONS_FOR_STEP;
      break;
    case OperationType.CONTEXT:
      validActions = VALID_ACTIONS_FOR_CONTEXT;
      break;
    case OperationType.WAIT:
      validActions = VALID_ACTIONS_FOR_WAIT;
      break;
    case OperationType.CALLBACK:
      validActions = VALID_ACTIONS_FOR_CALLBACK;
      break;
    case OperationType.INVOKE:
      validActions = VALID_ACTIONS_FOR_INVOKE;
      break;
    case OperationType.EXECUTION:
      validActions = VALID_ACTIONS_FOR_EXECUTION;
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Unknown operation type.",
        $metadata: {},
      });
  }

  if (!action || !validActions.has(action)) {
    throw new InvalidParameterValueException({
      message: "Invalid action for the given operation type.",
      $metadata: {},
    });
  }
}
