import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  InvalidParameterValueException,
  Operation,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import {
  createExecutionId,
  createCheckpointToken,
} from "../utils/tagged-strings";
import {
  decodeCheckpointToken,
  encodeCheckpointToken,
} from "../utils/checkpoint-token";
import { validateCheckpointUpdates } from "../validators/checkpoint-durable-execution-input-validator";
import { randomUUID } from "crypto";
import { ExecutionManager } from "../storage/execution-manager";
import { CheckpointOperation } from "../storage/checkpoint-manager";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";

/**
 * Long polls for checkpoint data for an execution. The API will return data once checkpoint data
 * is available. It will store data until the next API call for this execution ID.
 */
export async function processPollCheckpointData(
  executionIdParam: string,
  executionManager: ExecutionManager,
): Promise<{ operations: CheckpointOperation[] }> {
  const executionId = createExecutionId(executionIdParam);

  const checkpointStorage =
    executionManager.getCheckpointsByExecution(executionId);

  if (!checkpointStorage) {
    throw new Error("Execution not found");
  }

  const operations = await checkpointStorage.getPendingCheckpointUpdates();

  return {
    operations,
  };
}

/**
 * Updates the checkpoint data for a particular execution and operation ID with the intended status.
 *
 * Used for resolving operations like wait steps, retries, and status transitions, and also for resolving the execution itself.
 */
export function processUpdateCheckpointData(
  executionIdParam: string,
  operationId: string,
  operationData: Partial<Operation>,
  payload: string | undefined,
  error: ErrorObject | undefined,
  executionManager: ExecutionManager,
): OperationEvents {
  const executionId = createExecutionId(executionIdParam);

  const checkpointStorage =
    executionManager.getCheckpointsByExecution(executionId);

  if (!checkpointStorage) {
    throw new Error("Execution not found");
  }

  if (!checkpointStorage.hasOperation(operationId)) {
    throw new Error("Operation not found");
  }

  return checkpointStorage.updateOperation(
    operationId,
    operationData,
    payload,
    error,
  );
}

/**
 * The API for CheckpointDurableExecution used by the Language SDK and DEX service model.
 */
export function processCheckpointDurableExecution(
  durableExecutionArn: string | undefined,
  input: CheckpointDurableExecutionRequest,
  executionManager: ExecutionManager,
): CheckpointDurableExecutionResponse {
  const storage = executionManager.getCheckpointsByExecution(
    createExecutionId(durableExecutionArn),
  );
  if (!storage) {
    throw new Error("Execution not found");
  }

  const updates = input.Updates ?? [];

  if (!input.CheckpointToken) {
    throw new InvalidParameterValueException({
      message: "Checkpoint token is required",
      $metadata: {},
    });
  }

  const data = decodeCheckpointToken(
    createCheckpointToken(input.CheckpointToken),
  );

  validateCheckpointUpdates(updates, storage.getAllOperationData());
  storage.registerUpdates(updates);

  const output: CheckpointDurableExecutionResponse = {
    CheckpointToken: encodeCheckpointToken({
      executionId: data.executionId,
      invocationId: data.invocationId,
      token: randomUUID(),
    }),
    NewExecutionState: {
      Operations: storage.getDirtyOperations(),
      NextMarker: undefined,
    },
  };

  return output;
}
