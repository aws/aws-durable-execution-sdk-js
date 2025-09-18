import { randomUUID } from "node:crypto";
import { CheckpointManager } from "./checkpoint-manager";
import { Operation } from "@aws-sdk/client-lambda";
import {
  encodeCheckpointToken,
  decodeCheckpointToken,
  CheckpointTokenData,
} from "../utils/checkpoint-token";
import { CallbackId, CheckpointToken } from "../utils/tagged-strings";
import {
  ExecutionId,
  InvocationId,
  createInvocationId,
} from "../utils/tagged-strings";
import { decodeCallbackId } from "../utils/callback-id";

export interface InvocationResult {
  checkpointToken: CheckpointToken;
  executionId: ExecutionId;
  invocationId: InvocationId;
  operations: Operation[];
}

export interface StartExecutionParams {
  payload?: string;
  executionId: ExecutionId;
}

/**
 * Used for managing the state of all executions. Each execution has a checkpoint manager
 * associated with it which is used for managing its own checkpoints.
 */
export class ExecutionManager {
  private executions = new Map<ExecutionId, CheckpointManager>();

  /**
   * Starts an execution and generates the initial checkpoint token, execution ID and initial operation.
   *
   * @returns the necessary initial parameters that must be passed to the execution invocation event.
   */
  startExecution(params: StartExecutionParams): InvocationResult {
    const invocationId = createInvocationId();
    const executionId = params.executionId;
    const storage = new CheckpointManager(executionId);

    this.executions.set(executionId, storage);

    const checkpointToken = encodeCheckpointToken({
      executionId,
      token: randomUUID(),
      invocationId,
    });

    const initialOperation = storage.initialize(params.payload);

    return {
      checkpointToken,
      executionId,
      invocationId,
      operations: [initialOperation],
    };
  }

  /**
   * Start an individual invocation of an execution, while passing the previous operations.
   *
   * @returns The list of operations for this execution and other data for the invocation event.
   */
  startInvocation(executionId: ExecutionId): InvocationResult | undefined {
    const invocationId = createInvocationId();
    const checkpointStorage = this.executions.get(executionId);

    if (!checkpointStorage) {
      return undefined;
    }

    const checkpointToken = encodeCheckpointToken({
      executionId,
      token: randomUUID(),
      invocationId,
    });

    return {
      checkpointToken,
      executionId,
      invocationId,
      operations: Array.from(checkpointStorage.operationDataMap.values()).map(
        (operationData) => operationData.operation
      ),
    };
  }

  /**
   * Get a checkpoint manager by the execution id.
   */
  getCheckpointsByExecution(
    executionId: ExecutionId
  ): CheckpointManager | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get a checkpoint manager by the encoded checkpoint token.
   * If the execution is not found or cannot be parsed, this will return undefined.
   */
  getCheckpointsByToken(
    checkpointToken: CheckpointToken
  ): { storage: CheckpointManager; data: CheckpointTokenData } | undefined {
    try {
      const checkpointData = decodeCheckpointToken(checkpointToken);
      const storage = this.executions.get(checkpointData.executionId);
      if (!storage) {
        return undefined;
      }

      return {
        storage,
        data: checkpointData,
      };
    } catch {
      return undefined;
    }
  }

  getCheckpointsByCallbackId(
    callbackId: CallbackId
  ): CheckpointManager | undefined {
    try {
      const checkpointData = decodeCallbackId(callbackId);
      const storage = this.executions.get(checkpointData.executionId);
      if (!storage) {
        return undefined;
      }

      return storage;
    } catch {
      return undefined;
    }
  }

  cleanup(): void {
    for (const execution of this.executions.values()) {
      execution.cleanup();
    }
  }
}
