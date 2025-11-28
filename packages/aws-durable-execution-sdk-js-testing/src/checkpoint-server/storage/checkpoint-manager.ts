import {
  CallbackDetails,
  ErrorObject,
  InvalidParameterValueException,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { randomUUID } from "node:crypto";
import { CallbackId, ExecutionId, InvocationId } from "../utils/tagged-strings";
import { CallbackManager, CompleteCallbackStatus } from "./callback-manager";
import { EventProcessor } from "./event-processor";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";
import { waitHistoryDetails } from "./wait-details";
import { chainedInvokeHistoryDetails } from "./chained-invoke-details";
import { executionDetails } from "./execution-details";

export interface CheckpointOperation extends OperationEvents {
  // required for test execution orchestrator to process retries
  // TODO: schedule the retries internally instead of polling for updates
  update: OperationUpdate | undefined;
}

/**
 * Used for managing the checkpoints of an execution.
 */
export class CheckpointManager {
  public readonly operationDataMap = new Map<string, OperationEvents>();
  private readonly pendingUpdates: CheckpointOperation[] = [];
  private resolvePendingUpdatePromise: (() => void) | undefined = undefined;
  private readonly callbackManager: CallbackManager;
  // TODO: add execution timeout
  readonly eventProcessor = new EventProcessor();
  private readonly invocationsMap = new Map<InvocationId, Date>();

  private _isExecutionCompleted = false;

  constructor(executionId: ExecutionId) {
    this.callbackManager = new CallbackManager(executionId, this);
  }

  isExecutionCompleted() {
    return this._isExecutionCompleted;
  }

  startInvocation(invocationId: InvocationId) {
    this.invocationsMap.set(invocationId, new Date());
  }

  completeInvocation(invocationId: InvocationId): {
    startTimestamp: Date;
    endTimestamp: Date;
  } {
    const startTimestamp = this.invocationsMap.get(invocationId);

    if (!startTimestamp) {
      throw new Error(`Invocation with ID ${invocationId} not found`);
    }

    this.invocationsMap.delete(invocationId);

    return {
      startTimestamp,
      endTimestamp: new Date(),
    };
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
      StartTimestamp: new Date(),
      ExecutionDetails: {
        InputPayload: payload,
      },
    };
    const update = {
      Id: initialId,
      Type: OperationType.EXECUTION,
      Action: OperationAction.START,
      Payload: payload,
    };

    const initialOperationEvents = {
      operation: initialOperation,
      events: [this.eventProcessor.processUpdate(update, initialOperation)],
    } satisfies OperationEvents;

    this.operationDataMap.set(initialId, initialOperationEvents);

    return initialOperationEvents;
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

  flushUpdate() {
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
    status: CompleteCallbackStatus,
  ): OperationEvents {
    const result = this.callbackManager.completeCallback(
      callbackDetails,
      status,
    );
    if (!result.operation.Id) {
      throw new Error("Could not find operation Id");
    }
    this.operationDataMap.set(result.operation.Id, result);
    return result;
  }

  markOperationCompleted(
    operation: Operation,
    status: OperationStatus,
  ): Operation {
    const result: Operation = {
      ...operation,
      Status: status,
      EndTimestamp: new Date(),
    };

    if (operation.Type === OperationType.STEP) {
      result.StepDetails = {
        ...result.StepDetails,
        Attempt: (result.StepDetails?.Attempt ?? 0) + 1,
      };
    }

    return result;
  }

  private processRetryOperation(
    operation: Operation,
    attempt: number,
    retryDelaySeconds = 0,
  ): void {
    const scheduledEndTimestamp = new Date();
    scheduledEndTimestamp.setSeconds(
      scheduledEndTimestamp.getSeconds() + retryDelaySeconds,
    );
    operation.Status = OperationStatus.PENDING;
    operation.StepDetails = {
      ...operation.StepDetails,
      Attempt: attempt,
      NextAttemptTimestamp: scheduledEndTimestamp,
    };
  }

  /**
   * Used for marking an operation as complete. Can be used for wait steps.
   * @returns the updated operation data
   */
  completeOperation(inputUpdate: OperationUpdate): OperationEvents {
    if (!inputUpdate.Id) {
      throw new Error("Missing Id in operation");
    }

    const operationData = this.operationDataMap.get(inputUpdate.Id);

    if (!operationData) {
      throw new Error("Could not find operation");
    }

    const { operation, events } = operationData;

    const copied: OperationEvents = {
      operation: {
        ...operation,
      },
      events: [
        ...events,
        this.eventProcessor.processUpdate(inputUpdate, operation),
      ],
    };

    switch (inputUpdate.Action) {
      case OperationAction.SUCCEED:
        copied.operation = this.markOperationCompleted(
          copied.operation,
          OperationStatus.SUCCEEDED,
        );
        break;
      case OperationAction.FAIL:
        copied.operation = this.markOperationCompleted(
          copied.operation,
          OperationStatus.FAILED,
        );
        break;
    }

    switch (operation.Type) {
      case OperationType.STEP:
        copied.operation.StepDetails = {
          ...copied.operation.StepDetails,
          Result: inputUpdate.Payload,
          Error: inputUpdate.Error,
        };
        if (inputUpdate.Action === OperationAction.RETRY) {
          this.processRetryOperation(
            copied.operation,
            (operation.StepDetails?.Attempt ?? 0) + 1,
            inputUpdate.StepOptions?.NextAttemptDelaySeconds,
          );
        }
        break;
      case OperationType.CONTEXT:
        copied.operation.ContextDetails = {
          ...copied.operation.ContextDetails,
          Result: inputUpdate.Payload,
          Error: inputUpdate.Error,
          // Preserve ReplayChildren from ContextOptions if provided
          ReplayChildren:
            inputUpdate.ContextOptions?.ReplayChildren ??
            copied.operation.ContextDetails?.ReplayChildren,
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
  registerUpdates(updates: OperationUpdate[]): OperationEvents[] {
    if (this._isExecutionCompleted) {
      // Checkpoint token is invalid once execution is completed
      throw new InvalidParameterValueException({
        message: "Invalid checkpoint token",
        $metadata: {},
      });
    }

    return updates.map((update) => this.registerUpdate(update));
  }

  /**
   * Updates an existing operation with new operation data.
   * This method merges the new operation properties with the existing operation
   * while preserving the original update information.
   *
   * @param id The operation ID to update
   * @param newOperation Partial operation data to merge with existing operation
   * @param payload Optional payload to update the operation with
   * @returns The updated checkpoint operation data
   * @throws {Error} When the operation with the given ID is not found
   */
  updateOperation(
    id: string,
    newOperation: Partial<Operation>,
    payload: string | undefined,
    error: ErrorObject | undefined,
  ): OperationEvents {
    const operationData = this.operationDataMap.get(id);
    if (!operationData) {
      throw new Error("Could not find operation");
    }

    if (!newOperation.Status) {
      throw new Error("Missing Status in operation");
    }

    const newOperationData: OperationEvents = {
      ...operationData,
      operation: {
        ...operationData.operation,
        ...newOperation,
      },
    };

    switch (newOperationData.operation.Type) {
      case OperationType.WAIT: {
        const historyEventType = waitHistoryDetails[newOperation.Status];
        if (!historyEventType) {
          throw new Error(
            `Invalid status update for ${OperationType.WAIT}: ${newOperation.Status}`,
          );
        }
        const historyEvent = this.eventProcessor.createHistoryEvent(
          historyEventType.eventType,
          newOperationData.operation,
          historyEventType.detailPlace,
          {
            Duration:
              newOperationData.events.at(0)?.WaitStartedDetails?.Duration,
            // TODO: populate error details from WaitCancelled event
          },
        );
        newOperationData.events.push(historyEvent);
        break;
      }
      case OperationType.CHAINED_INVOKE: {
        const historyEventType =
          chainedInvokeHistoryDetails[newOperation.Status];
        if (!historyEventType) {
          throw new Error(
            `Invalid status update for ${OperationType.CHAINED_INVOKE}: ${newOperation.Status}`,
          );
        }

        if (
          newOperationData.operation.ChainedInvokeDetails?.Result &&
          newOperationData.operation.ChainedInvokeDetails.Error
        ) {
          throw new Error(
            `Could not update operation with both Result and Error in details.`,
          );
        }

        const historyEvent = this.eventProcessor.createHistoryEvent(
          historyEventType.eventType,
          newOperationData.operation,
          historyEventType.detailPlace,
          {
            Result:
              newOperationData.operation.ChainedInvokeDetails?.Result !==
              undefined
                ? {
                    Payload:
                      newOperationData.operation.ChainedInvokeDetails.Result,
                  }
                : undefined,
            Error:
              newOperationData.operation.ChainedInvokeDetails?.Error !==
              undefined
                ? {
                    Payload:
                      newOperationData.operation.ChainedInvokeDetails.Error,
                  }
                : undefined,
          },
        );
        newOperationData.events.push(historyEvent);
        break;
      }
      case OperationType.EXECUTION: {
        const historyEventType = executionDetails[newOperation.Status];
        if (!historyEventType) {
          throw new Error(
            `Invalid status update for ${OperationType.EXECUTION}: ${newOperation.Status}`,
          );
        }

        const historyEvent = this.eventProcessor.createHistoryEvent(
          historyEventType.eventType,
          newOperationData.operation,
          historyEventType.detailPlace,
          {
            Result:
              payload !== undefined
                ? {
                    Payload: payload,
                  }
                : undefined,
            Error: error
              ? {
                  Payload: error,
                }
              : undefined,
          },
        );
        newOperationData.events.push(historyEvent);
        this._isExecutionCompleted = true;
      }
    }

    this.operationDataMap.set(id, newOperationData);

    this.addOperationUpdate({
      ...newOperationData,
      update: undefined,
    });
    return newOperationData;
  }

  /**
   * Register an operation update to be stored in the checkpoint manager.
   * This function does not schedule anything and is only used for storing the data.
   * `getPendingCheckpointUpdates` should be used for acting on the data after each update.
   * @returns the operation update along with the operation itself
   */
  registerUpdate(update: OperationUpdate): OperationEvents {
    if (!update.Id) {
      throw new Error("Missing Id in update");
    }

    const previousOperation = this.operationDataMap.get(update.Id);

    if (previousOperation) {
      if (previousOperation.operation.WaitDetails?.ScheduledEndTimestamp) {
        this.addOperationUpdate({
          ...previousOperation,
          update,
        });
        return previousOperation;
      }

      const completedOperation = this.completeOperation(update);
      this.addOperationUpdate({
        ...completedOperation,
        update,
      });
      return completedOperation;
    }

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
        const scheduledEndTimestamp = new Date();
        const waitSeconds = update.WaitOptions?.WaitSeconds ?? 0;
        scheduledEndTimestamp.setSeconds(
          scheduledEndTimestamp.getSeconds() + waitSeconds,
        );

        operation.WaitDetails = {
          ScheduledEndTimestamp: scheduledEndTimestamp,
        };
        break;
      }
      case OperationType.STEP: {
        if (update.Action === OperationAction.RETRY) {
          this.processRetryOperation(
            operation,
            1,
            update.StepOptions?.NextAttemptDelaySeconds,
          );
        }
        break;
      }
      case OperationType.CALLBACK: {
        const callbackId = this.callbackManager.createCallback(
          update.Id,
          update.CallbackOptions?.TimeoutSeconds,
          update.CallbackOptions?.HeartbeatTimeoutSeconds,
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

    const result: OperationEvents = {
      operation,
      events: [],
    };

    this.operationDataMap.set(update.Id, result);

    let updatedResult = result;
    if (
      update.Action === OperationAction.SUCCEED ||
      update.Action === OperationAction.FAIL
    ) {
      updatedResult = this.completeOperation(update);
    } else {
      result.events = [this.eventProcessor.processUpdate(update, operation)];
    }

    this.addOperationUpdate({
      ...updatedResult,
      update,
    });

    return updatedResult;
  }

  /**
   * Clears all callback timers.
   */
  cleanup(): void {
    this.callbackManager.cleanup();
  }
}
