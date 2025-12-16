import {
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { validateCallbackOperation } from "./operation-type/validate-callback-operation";
import { validateContextOperation } from "./operation-type/validate-context-operation";
import { validateExecutionOperation } from "./operation-type/validate-execution-operation";
import { validateChainedInvokeOperation } from "./operation-type/validate-chained-invoke-operation";
import { validateStepOperation } from "./operation-type/validate-step-operation";
import { validateWaitOperation } from "./operation-type/validate-wait-operation";
import { validateValidActionsByOperationType } from "./valid-actions-by-operation-type-validator";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";

const MAX_ERROR_PAYLOAD_SIZE_BYTES = 32768; // 32KB

/**
 * Performs comprehensive validation on checkpoint input updates.
 * Validates execution conflicts, parent-child relationships, duplicates, and individual operations.
 *
 * @param updates - Array of operation updates to validate
 * @param checkpointOperations - Map of existing checkpoint operations by ID
 * @throws {InvalidParameterValueException} When validation fails
 */
export function validateCheckpointUpdates(
  updates: OperationUpdate[] | undefined,
  checkpointOperations: ReadonlyMap<string, OperationEvents>,
): void {
  if (!updates?.length) {
    return;
  }

  validateConflictingExecutionUpdate(updates);
  validateParentIdAndDuplicateId(updates, checkpointOperations);

  for (const update of updates) {
    validateOperationUpdate(update, checkpointOperations);
  }
}

/**
 * Validates that there are no conflicting EXECUTION updates in the request.
 * Ensures only one EXECUTION update per request and that it's the last update.
 *
 * @param updates - Array of operation updates to validate
 * @throws {InvalidParameterValueException} When multiple EXECUTION updates exist or EXECUTION is not last
 */
function validateConflictingExecutionUpdate(updates: OperationUpdate[]): void {
  const executionUpdates = updates.filter(
    (update) => update.Type === OperationType.EXECUTION,
  );

  if (executionUpdates.length > 1) {
    throw new InvalidParameterValueException({
      message: "Cannot checkpoint multiple EXECUTION updates.",
      $metadata: {},
    });
  }

  if (
    executionUpdates.length === 1 &&
    updates[updates.length - 1].Type !== OperationType.EXECUTION
  ) {
    throw new InvalidParameterValueException({
      message: "EXECUTION checkpoint must be the last update.",
      $metadata: {},
    });
  }
}

/**
 * Validates an individual operation update including payload sizes, action validity, and status transitions.
 *
 * @param operationUpdate - The operation update to validate
 * @param checkpointOperations - Map of existing checkpoint operations by ID
 * @throws {InvalidParameterValueException} When validation fails
 */
function validateOperationUpdate(
  operationUpdate: OperationUpdate,
  checkpointOperations: ReadonlyMap<string, OperationEvents>,
): void {
  // Validates that the operation payload sizes are not too large
  validatePayloadSizes(operationUpdate);

  // Validate that the action is a valid action for the operation type.
  validateValidActionsByOperationType(
    operationUpdate.Type,
    operationUpdate.Action,
  );

  // Validate that the action is valid for the current operation status.
  validateOperationStatusTransition(
    operationUpdate,
    operationUpdate.Id
      ? checkpointOperations.get(operationUpdate.Id)?.operation
      : undefined,
  );
}

/**
 * Validates that operation error payloads don't exceed the maximum size limit.
 *
 * @param operationUpdate - The operation update to validate payload sizes for
 * @throws {InvalidParameterValueException} When error payload exceeds 32KB limit
 */
function validatePayloadSizes(operationUpdate: OperationUpdate): void {
  if (operationUpdate.Error != null) {
    const payload = JSON.stringify(operationUpdate);
    const payloadSizeBytes = new TextEncoder().encode(payload).length;

    if (payloadSizeBytes > MAX_ERROR_PAYLOAD_SIZE_BYTES) {
      throw new InvalidParameterValueException({
        message: `Error object size must be less than ${MAX_ERROR_PAYLOAD_SIZE_BYTES} bytes.`,
        $metadata: {},
      });
    }
  }
}

/**
 * Validates parent-child relationships and prevents duplicate operation updates in a single request.
 * Ensures that parent operations exist and are of type CONTEXT, and that no operation is updated twice.
 *
 * @param operationUpdates - Array of operation updates to validate
 * @param checkpointOperations - Map of existing checkpoint operations by ID
 * @throws {InvalidParameterValueException} When parent validation fails or duplicate operations exist
 */
function validateParentIdAndDuplicateId(
  operationUpdates: OperationUpdate[],
  checkpointOperations: ReadonlyMap<string, OperationEvents>,
): void {
  const operationsStarted = new Map<string, OperationUpdate>();
  const lastUpdatesSeen = new Map<string, OperationUpdate>();

  for (const operationUpdate of operationUpdates) {
    const operationId = operationUpdate.Id;
    if (!operationId) {
      throw new InvalidParameterValueException({
        message: "Operation update must have an Id.",
        $metadata: {},
      });
    }

    if (isInvalidDuplicateUpdate(operationUpdate, lastUpdatesSeen)) {
      throw new InvalidParameterValueException({
        message: "Cannot update the same operation twice in a single request.",
        $metadata: {},
      });
    }

    const validParent = isValidParentForUpdate(
      checkpointOperations,
      operationUpdate,
      operationsStarted,
    );

    if (validParent) {
      if (OperationAction.START === operationUpdate.Action) {
        operationsStarted.set(operationId, operationUpdate);
      }
      lastUpdatesSeen.set(operationId, operationUpdate);
    } else {
      // Invalid parent id.
      throw new InvalidParameterValueException({
        message: "Invalid parent operation id.",
        $metadata: {},
      });
    }
  }
}

function isInvalidDuplicateUpdate(
  operationUpdate: OperationUpdate,
  lastUpdatesSeen: Map<string, OperationUpdate>,
): boolean {
  if (!operationUpdate.Id) {
    throw new Error("Missing ID in operation update");
  }

  const lastUpdateSeen = lastUpdatesSeen.get(operationUpdate.Id);
  if (lastUpdateSeen) {
    switch (lastUpdateSeen.Type) {
      case OperationType.STEP:
      case OperationType.CONTEXT: {
        const allowDuplicate =
          OperationAction.START === lastUpdateSeen.Action &&
          OperationAction.START !== operationUpdate.Action;
        return !allowDuplicate;
      }
      default:
        return true;
    }
  }

  return false;
}

/**
 * Determines if an operation update has a valid parent operation.
 * Only CONTEXT operations can be parents, and parents must exist either in the current batch or existing operations.
 *
 * @param checkpointOperations - Map of existing checkpoint operations by ID
 * @param operationUpdate - The operation update to validate parent for
 * @param operationsStarted - Map of operations already seen in this batch
 * @returns true if parent is valid or no parent is specified, false otherwise
 */
function isValidParentForUpdate(
  checkpointOperations: ReadonlyMap<string, OperationEvents>,
  operationUpdate: OperationUpdate,
  operationsStarted: Map<string, OperationUpdate>,
): boolean {
  const parentId = operationUpdate.ParentId;

  // No parent
  if (!parentId) {
    return true;
  }

  // The parent START is part of the same update, and appears earlier in the list.
  const parentUpdate = operationsStarted.get(parentId);
  if (parentUpdate) {
    // Only CONTEXT can be a parent
    return parentUpdate.Type === OperationType.CONTEXT;
  }

  // The parent is an already existing operation in the state
  const parentOperation = checkpointOperations.get(parentId);
  if (parentOperation) {
    // Only CONTEXT can be a parent
    return parentOperation.operation.Type === OperationType.CONTEXT;
  }

  return false;
}

/**
 * Validates operation status transitions by delegating to the appropriate operation-specific validator.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When the operation status transition is invalid
 */
function validateOperationStatusTransition(
  update: OperationUpdate,
  operation?: Operation,
): void {
  switch (update.Type) {
    case OperationType.CALLBACK:
      validateCallbackOperation(update, operation);
      break;
    case OperationType.CONTEXT:
      validateContextOperation(update, operation);
      break;
    case OperationType.EXECUTION:
      validateExecutionOperation(update);
      break;
    case OperationType.CHAINED_INVOKE:
      validateChainedInvokeOperation(update, operation);
      break;
    case OperationType.STEP:
      validateStepOperation(update, operation);
      break;
    case OperationType.WAIT:
      validateWaitOperation(update, operation);
      break;
    default:
      throw new InvalidParameterValueException({
        message: "Invalid operation type.",
        $metadata: {},
      });
  }
}
