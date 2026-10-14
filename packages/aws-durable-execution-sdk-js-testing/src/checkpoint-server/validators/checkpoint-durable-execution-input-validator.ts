import { invalidParameterValue } from "./invalid-parameter-value";
import {
  Operation,
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { validateCallbackOperation } from "./operation-type/validate-callback-operation";
import { validateContextOperation } from "./operation-type/validate-context-operation";
import { validateExecutionOperation } from "./operation-type/validate-execution-operation";
import { validateChainedInvokeOperation } from "./operation-type/validate-chained-invoke-operation";
import { validateStepOperation } from "./operation-type/validate-step-operation";
import { validateWaitOperation } from "./operation-type/validate-wait-operation";
import { validateValidActionsByOperationType } from "./valid-actions-by-operation-type-validator";
import { validateUpdateModel } from "./validate-update-model";
import { validateUpdateSerialization } from "./validate-update-serialization";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";

/**
 * The service's limit for the error object, and for STEP and CONTEXT output.
 * Production uses 256 KB.
 */
const MAX_CHECKPOINT_PAYLOAD_SIZE_BYTES = 262_144;

/** The service's limit for CHAINED_INVOKE input. */
const MAX_CHAINED_INVOKE_INPUT_PAYLOAD_SIZE_BYTES = 1_048_576;

/**
 * The service's limit for EXECUTION output of a synchronous invocation.
 * The local runner invokes the handler synchronously.
 */
const MAX_SYNC_EXECUTION_OUTPUT_PAYLOAD_SIZE_BYTES = 6_291_456;

const PAYLOAD_LIMITS: Partial<
  Record<OperationType, { maxBytes: number; description: string }>
> = {
  [OperationType.STEP]: {
    maxBytes: MAX_CHECKPOINT_PAYLOAD_SIZE_BYTES,
    description: "STEP output payload",
  },
  [OperationType.CONTEXT]: {
    maxBytes: MAX_CHECKPOINT_PAYLOAD_SIZE_BYTES,
    description: "CONTEXT output payload",
  },
  [OperationType.CHAINED_INVOKE]: {
    maxBytes: MAX_CHAINED_INVOKE_INPUT_PAYLOAD_SIZE_BYTES,
    description: "CHAINED_INVOKE input payload",
  },
  [OperationType.EXECUTION]: {
    maxBytes: MAX_SYNC_EXECUTION_OUTPUT_PAYLOAD_SIZE_BYTES,
    description: "Execution output payload",
  },
};

const INCONSISTENT_SUFFIX =
  " value in OperationUpdate is inconsistent with existing operation. Check for non-determinism.";

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

  // The service reads the request body first, and then checks the request
  // against its model. So a member of the wrong type, and then an invalid
  // member, rejects the request before any other check.
  validateUpdateSerialization(updates);
  validateUpdateModel(updates);
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
    throw invalidParameterValue(
      "Cannot checkpoint multiple EXECUTION updates.",
    );
  }

  if (
    executionUpdates.length === 1 &&
    updates[updates.length - 1].Type !== OperationType.EXECUTION
  ) {
    throw invalidParameterValue(
      "EXECUTION checkpoint must be the last update.",
    );
  }
}

/**
 * Validates an individual operation update including metadata consistency,
 * payload sizes, action validity, and status transitions.
 *
 * @param operationUpdate - The operation update to validate
 * @param checkpointOperations - Map of existing checkpoint operations by ID
 * @throws {InvalidParameterValueException} When validation fails
 */
function validateOperationUpdate(
  operationUpdate: OperationUpdate,
  checkpointOperations: ReadonlyMap<string, OperationEvents>,
): void {
  const existingOperation = operationUpdate.Id
    ? checkpointOperations.get(operationUpdate.Id)?.operation
    : undefined;

  // Validate that the update is consistent with the existing operation.
  validateInconsistentOperationMetadata(operationUpdate, existingOperation);

  // Validates that the operation payload sizes are not too large
  validatePayloadSizes(operationUpdate);

  // Validate that the action is a valid action for the operation type.
  validateValidActionsByOperationType(
    operationUpdate.Type,
    operationUpdate.Action,
  );

  // Validate that the action is valid for the current operation status.
  validateOperationStatusTransition(operationUpdate, existingOperation);
}

/**
 * Validates that the update does not change the Type, SubType, Name, or
 * ParentId of an existing operation. These fields can only be set when the
 * operation starts. A different value usually means that the handler is not
 * deterministic.
 *
 * @param update - The operation update to validate
 * @param operation - The current operation state (if it exists)
 * @throws {InvalidParameterValueException} When a field differs from the existing operation
 */
function validateInconsistentOperationMetadata(
  update: OperationUpdate,
  operation: Operation | undefined,
): void {
  if (!operation) {
    return;
  }

  const fields = [
    ["Type", update.Type, operation.Type],
    ["SubType", update.SubType, operation.SubType],
    ["Name", update.Name, operation.Name],
    ["ParentId", update.ParentId, operation.ParentId],
  ] as const;

  for (const [field, updateValue, operationValue] of fields) {
    if (updateValue != null && updateValue !== operationValue) {
      throw invalidParameterValue(`${field}${INCONSISTENT_SUFFIX}`);
    }
  }
}

function sizeErrorMessage(description: string, maxBytes: number): string {
  return `${description} size must be less than or equal to ${maxBytes} bytes.`;
}

/**
 * Validates that the error object and the payload of an update do not exceed
 * the service's limits. The error limit applies to the whole serialized
 * update. The payload limit depends on the operation type. WAIT and CALLBACK
 * updates have no payload limit here.
 *
 * @param operationUpdate - The operation update to validate payload sizes for
 * @throws {InvalidParameterValueException} When the error object or the payload is too large
 */
function validatePayloadSizes(operationUpdate: OperationUpdate): void {
  if (operationUpdate.Error != null) {
    const updateSizeBytes = Buffer.byteLength(
      JSON.stringify(operationUpdate),
      "utf8",
    );

    if (updateSizeBytes > MAX_CHECKPOINT_PAYLOAD_SIZE_BYTES) {
      throw invalidParameterValue(
        sizeErrorMessage("Error object", MAX_CHECKPOINT_PAYLOAD_SIZE_BYTES),
      );
    }
  }

  const limit = operationUpdate.Type && PAYLOAD_LIMITS[operationUpdate.Type];
  if (
    limit &&
    operationUpdate.Payload != null &&
    Buffer.byteLength(operationUpdate.Payload, "utf8") > limit.maxBytes
  ) {
    throw invalidParameterValue(
      sizeErrorMessage(limit.description, limit.maxBytes),
    );
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
    // validateUpdateModel has already rejected an update without an Id.
    const operationId = operationUpdate.Id as string;

    if (isInvalidDuplicateUpdate(operationUpdate, lastUpdatesSeen)) {
      throw invalidParameterValue(
        "Cannot update the same operation twice in a single request.",
      );
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
      throw invalidParameterValue("Invalid parent operation id.");
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
      throw invalidParameterValue("Invalid operation type.");
  }
}
