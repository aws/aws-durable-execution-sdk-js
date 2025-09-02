import {
  CallbackDetails,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@amzn/dex-internal-sdk";
import { randomUUID } from "node:crypto";
import { CallbackId, ExecutionId, InvocationId } from "../utils/tagged-strings";
import { CallbackManager } from "./callback-manager";

export interface CheckpointOperation {
  operation: Operation;
  update: OperationUpdate;
}

export type OperationInvocationIdMap = Record<string, InvocationId[]>;

/**
 * Used for managing the checkpoints of an execution.
 */
export class CheckpointManager {
  public readonly operationDataMap = new Map<string, CheckpointOperation>();
  private readonly pendingUpdates: CheckpointOperation[] = [];
  private resolvePendingUpdatePromise: (() => void) | undefined = undefined;
  private readonly callbackManager: CallbackManager;
  private readonly operationInvocationIdMap: Record<string, Set<InvocationId>> =
    {};

  constructor(executionId: ExecutionId) {
    this.callbackManager = new CallbackManager(executionId, this);
  }

  getState(): Operation[] {
    const excludedOperations = new Set<string>();
    const operations: Operation[] = [];
    for (const [id, { operation }] of this.operationDataMap.entries()) {
      const parentId = operation.ParentId;
      if (!parentId) {
        operations.push(operation);
        continue;
      }

      const parent = this.operationDataMap.get(parentId);
      if (
        // Parent type is valid
        parent?.operation.Type === OperationType.CONTEXT &&
        // Parent is completed
        (parent.operation.Status === OperationStatus.SUCCEEDED ||
          parent.operation.Status === OperationStatus.FAILED) &&
        // The parent is set to not replay children
        (!parent.operation.ContextDetails?.ReplayChildren ||
          // If the parent was excluded, then ReplayChildren must be false for an ancestor,
          // so this operation should also be excluded.
          excludedOperations.has(parentId))
      ) {
        excludedOperations.add(id);
        continue;
      }

      operations.push(operation);
    }

    return operations;
  }

  /**
   * Initialize the checkpoint manager with the first operation
   * @returns the initial operation for an execution
   */
  initialize(payload = "{}") {
    const initialId: string = randomUUID();
    const initialOperation = {
      Id: initialId,
      Type: OperationType.EXECUTION,
      Status: OperationStatus.STARTED,
      ExecutionDetails: {
        InputPayload: payload,
      },
    };
    this.operationDataMap.set(initialId, {
      operation: initialOperation,
      update: {},
    });

    return initialOperation;
  }

  getOperationInvocationIdMap(): OperationInvocationIdMap {
    return Object.keys(this.operationInvocationIdMap).reduce(
      (acc: OperationInvocationIdMap, key: string) => {
        const invocationIds = this.operationInvocationIdMap[key];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        acc[key] = invocationIds ? Array.from(invocationIds) : [];
        return acc;
      },
      {}
    );
  }

  /**
   * Waits for pending checkpoint updates and immediately resolves when checkpoints are added.
   * @returns A list of checkpoint updates since this was last resolved.
   */
  async getPendingCheckpointUpdates(): Promise<CheckpointOperation[]> {
    // Immediately resolve if there are pending updates already
    if (this.pendingUpdates.length) {
      this.resolvePendingUpdatePromise = undefined;
      const copied = Array.from(this.pendingUpdates);
      this.pendingUpdates.length = 0;
      return copied;
    }

    // Wait for updates if they don't exist yet
    await new Promise<void>((resolve) => {
      this.resolvePendingUpdatePromise = resolve;
    });

    this.resolvePendingUpdatePromise = undefined;
    const copied = Array.from(this.pendingUpdates);
    this.pendingUpdates.length = 0;
    return copied;
  }

  addOperationUpdate(operationData: CheckpointOperation) {
    this.pendingUpdates.push(operationData);
    this.resolvePendingUpdatePromise?.();
  }

  hasOperation(id?: string): boolean {
    return id ? this.operationDataMap.has(id) : false;
  }

  /**
   * Delegates callback completion to the CallbackManager
   */
  completeCallback(
    callbackDetails: CallbackDetails,
    status: OperationStatus
  ): CheckpointOperation {
    const result = this.callbackManager.completeCallback(
      callbackDetails,
      status
    );
    if (!result.operation.Id) {
      throw new Error("Could not find operation Id");
    }
    this.operationDataMap.set(result.operation.Id, result);
    return result;
  }

  markOperationCompleted(
    operation: Operation,
    status: OperationStatus
  ): Operation {
    return {
      ...operation,
      Status: status,
      EndTimestamp: new Date(),
    };
  }

  /**
   * Used for marking an operation as complete. Can be used for wait steps.
   * @returns the updated operation data
   */
  completeOperation(inputUpdate: OperationUpdate): CheckpointOperation {
    if (!inputUpdate.Id) {
      throw new Error("Missing Id in operation");
    }

    const operationData = this.operationDataMap.get(inputUpdate.Id);

    if (!operationData) {
      throw new Error("Could not find operation");
    }

    const { operation, update } = operationData;

    const copied: CheckpointOperation = {
      operation: {
        ...operation,
      },
      update: {
        ...update,
        ...inputUpdate,
      },
    };

    switch (inputUpdate.Action) {
      case OperationAction.SUCCEED:
        copied.operation = this.markOperationCompleted(
          copied.operation,
          OperationStatus.SUCCEEDED
        );
        break;
      case OperationAction.FAIL:
        copied.operation = this.markOperationCompleted(
          copied.operation,
          OperationStatus.FAILED
        );
        break;
      case OperationAction.RETRY:
        copied.operation.Status = OperationStatus.PENDING;
        break;
    }

    switch (operation.Type) {
      case OperationType.STEP:
        copied.operation.StepDetails = {
          Result: inputUpdate.Payload,
          Error: inputUpdate.Error,
          Attempt:
            inputUpdate.Action === OperationAction.RETRY
              ? (operation.StepDetails?.Attempt ?? 0) + 1
              : operation.StepDetails?.Attempt,
        };
        break;
      case OperationType.CONTEXT:
        copied.operation.ContextDetails = {
          ...copied.operation.ContextDetails,
          Result: inputUpdate.Payload,
          Error: inputUpdate.Error,
        };
        break;
    }

    this.operationDataMap.set(inputUpdate.Id, copied);

    return copied;
  }

  /**
   * Delegates callback heartbeat to the CallbackManager
   */
  heartbeatCallback(callbackId: CallbackId): void {
    this.callbackManager.heartbeatCallback(callbackId);
  }

  /**
   * Registers multiple operation updates at once for a given invocation.
   * This is a batch operation that calls registerUpdate for each update.
   *
   * @param updates Array of operation updates to register
   * @param invocationId The invocation ID these updates belong to
   * @returns Array of checkpoint operations with their associated updates
   */
  registerUpdates(
    updates: OperationUpdate[],
    invocationId: InvocationId
  ): CheckpointOperation[] {
    return updates.map((update) => this.registerUpdate(update, invocationId));
  }

  /**
   * Updates an existing operation with new operation data.
   * This method merges the new operation properties with the existing operation
   * while preserving the original update information.
   *
   * @param id The operation ID to update
   * @param newOperation Partial operation data to merge with existing operation
   * @returns The updated checkpoint operation data
   * @throws {Error} When the operation with the given ID is not found
   */
  updateOperation(id: string, newOperation: Operation): CheckpointOperation {
    const operationData = this.operationDataMap.get(id);
    if (!operationData) {
      throw new Error("Could not find operation");
    }
    const newOperationData = {
      ...operationData,
      operation: {
        ...operationData.operation,
        ...newOperation,
      },
    };
    this.operationDataMap.set(id, newOperationData);
    return newOperationData;
  }

  /**
   * Register an operation update to be stored in the checkpoint manager.
   * This function does not schedule anything and is only used for storing the data.
   * `getPendingCheckpointUpdates` should be used for acting on the data after each update.
   * @returns the operation update along with the operation itself
   */
  registerUpdate(
    update: OperationUpdate,
    invocationId: InvocationId
  ): CheckpointOperation {
    if (!update.Id) {
      throw new Error("Missing Id in update");
    }

    const previousOperation = this.operationDataMap.get(update.Id);

    if (previousOperation) {
      const operationInvocations = this.operationInvocationIdMap[update.Id];

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!operationInvocations) {
        throw new Error(`Could not find invocations list for ${update.Id}`);
      }

      operationInvocations.add(invocationId);

      if (previousOperation.operation.WaitDetails?.ScheduledTimestamp) {
        this.addOperationUpdate(previousOperation);
        return previousOperation;
      }

      const completedOperation = this.completeOperation(update);
      this.addOperationUpdate(completedOperation);
      return completedOperation;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.operationInvocationIdMap[update.Id]) {
      throw new Error(
        "Operation invocations list should not exist for new operation."
      );
    }

    this.operationInvocationIdMap[update.Id] = new Set([invocationId]);

    const operation: Operation = {
      Id: update.Id,
      ParentId: update.ParentId,
      Name: update.Name,
      Type: update.Type,
      StartTimestamp: new Date(),
      Status: OperationStatus.STARTED,
      SubType: update.SubType,
    };

    switch (update.Type) {
      case OperationType.WAIT: {
        const scheduledTimestamp = new Date();
        const waitSeconds = update.WaitOptions?.WaitSeconds ?? 0;
        scheduledTimestamp.setSeconds(
          scheduledTimestamp.getSeconds() + waitSeconds
        );

        operation.WaitDetails = {
          ScheduledTimestamp: scheduledTimestamp,
        };
        break;
      }
      case OperationType.STEP: {
        if (update.Action === OperationAction.RETRY) {
          operation.Status = OperationStatus.PENDING;
          operation.StepDetails = {
            Attempt: operation.StepDetails?.Attempt ?? 1,
          };
        }
        break;
      }
      case OperationType.CALLBACK: {
        const callbackId = this.callbackManager.createCallback(
          update.Id,
          update.CallbackOptions?.TimeoutSeconds,
          update.CallbackOptions?.HeartbeatTimeoutSeconds
        );
        operation.CallbackDetails = {
          CallbackId: callbackId,
        };
        break;
      }
      case OperationType.CONTEXT: {
        operation.ContextDetails = {
          ReplayChildren: update.ContextOptions?.ReplayChildren,
        };
        break;
      }
    }

    const result: CheckpointOperation = {
      operation,
      update,
    };

    this.operationDataMap.set(update.Id, result);

    let updatedResult = result;
    if (
      update.Action === OperationAction.SUCCEED ||
      update.Action === OperationAction.FAIL
    ) {
      updatedResult = this.completeOperation(update);
    }

    this.addOperationUpdate(updatedResult);
    return updatedResult;
  }

  /**
   * Clears all callback timers.
   */
  cleanup(): void {
    this.callbackManager.cleanup();
  }
}
