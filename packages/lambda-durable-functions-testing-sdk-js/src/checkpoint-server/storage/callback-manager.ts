import {
  CallbackDetails,
  InvalidParameterValueException,
  OperationStatus,
} from "@amzn/dex-internal-sdk";
import {
  CallbackId,
  createCallbackId,
  ExecutionId,
} from "../utils/tagged-strings";
import { decodeCallbackId, encodeCallbackId } from "../utils/callback-id";
import { CheckpointManager, CheckpointOperation } from "./checkpoint-manager";

/**
 * Manages callback operations, timers, and lifecycle for an execution.
 */
export class CallbackManager {
  private readonly callbackIdMap = new Map<CallbackId, string>();
  private readonly heartbeatCallbackTimers = new Map<
    CallbackId,
    NodeJS.Timeout
  >();
  private readonly callbackTimers = new Map<CallbackId, NodeJS.Timeout>();

  constructor(
    private readonly executionId: ExecutionId,
    private readonly checkpointManager: CheckpointManager
  ) {}

  /**
   * Creates a callback ID for an operation and sets up associated timers
   */
  createCallback(
    operationId: string,
    timeoutSeconds?: number,
    heartbeatTimeoutSeconds?: number
  ): CallbackId {
    const callbackId = encodeCallbackId({
      executionId: this.executionId,
      operationId,
    });

    this.callbackIdMap.set(callbackId, operationId);

    // Set up timeout timer if specified
    if (timeoutSeconds !== undefined) {
      this.callbackTimers.set(
        callbackId,
        setTimeout(() => {
          this.completeCallback(
            {
              CallbackId: callbackId,
            },
            OperationStatus.TIMED_OUT
          );
        }, timeoutSeconds * 1000)
      );
    }

    // Set up heartbeat timeout timer if specified
    if (heartbeatTimeoutSeconds !== undefined) {
      this.heartbeatCallbackTimers.set(
        callbackId,
        setTimeout(() => {
          this.completeCallback(
            {
              CallbackId: callbackId,
            },
            OperationStatus.TIMED_OUT
          );
        }, heartbeatTimeoutSeconds * 1000)
      );
    }

    return callbackId;
  }

  /**
   * Completes a callback operation and cleans up associated timers
   */
  completeCallback(
    callbackDetails: CallbackDetails,
    status: OperationStatus
  ): CheckpointOperation {
    if (!callbackDetails.CallbackId) {
      throw new InvalidParameterValueException({
        message: "Missing callback Id",
        $metadata: {},
      });
    }

    const callbackId = createCallbackId(callbackDetails.CallbackId);
    const { operationId } = decodeCallbackId(callbackId);

    const operationData =
      this.checkpointManager.operationDataMap.get(operationId);
    if (!operationData) {
      throw new InvalidParameterValueException({
        message: "Could not find operation",
        $metadata: {},
      });
    }

    const { operation, update } = operationData;

    const copied: CheckpointOperation = {
      operation: {
        ...this.checkpointManager.markOperationCompleted(operation, status),
        CallbackDetails: callbackDetails,
      },
      update: {
        ...update,
      },
    };

    this.checkpointManager.operationDataMap.set(operationId, copied);
    this.callbackIdMap.delete(callbackId);

    // Clear timeout timers
    this.clearCallbackTimers(callbackId);

    // Notify CheckpointManager about the completed callback
    this.checkpointManager.addOperationUpdate(copied);

    return copied;
  }

  /**
   * Handles callback heartbeat to reset the heartbeat timeout
   */
  heartbeatCallback(callbackId: CallbackId): void {
    const { operationId } = decodeCallbackId(callbackId);
    const operationData =
      this.checkpointManager.operationDataMap.get(operationId);

    if (!operationData) {
      throw new Error("Could not find operation");
    }

    if (!operationData.update.CallbackOptions?.HeartbeatTimeoutSeconds) {
      throw new Error("Could not find callback that requires heartbeat");
    }

    const timer = this.heartbeatCallbackTimers.get(callbackId);
    clearTimeout(timer);

    this.heartbeatCallbackTimers.set(
      callbackId,
      setTimeout(() => {
        this.completeCallback(
          {
            CallbackId: callbackId,
          },
          OperationStatus.TIMED_OUT
        );
      }, operationData.update.CallbackOptions.HeartbeatTimeoutSeconds * 1000)
    );
  }

  /**
   * Clears all timers associated with a callback ID
   */
  private clearCallbackTimers(callbackId: CallbackId): void {
    const heartbeatTimeoutTimer = this.heartbeatCallbackTimers.get(callbackId);
    clearTimeout(heartbeatTimeoutTimer);
    this.heartbeatCallbackTimers.delete(callbackId);

    const timeoutTimer = this.callbackTimers.get(callbackId);
    clearTimeout(timeoutTimer);
    this.callbackTimers.delete(callbackId);
  }

  /**
   * Cleans up all callback timers - useful for disposal
   */
  cleanup(): void {
    // Clear all heartbeat timers
    for (const timer of this.heartbeatCallbackTimers.values()) {
      clearTimeout(timer);
    }
    this.heartbeatCallbackTimers.clear();

    // Clear all callback timers
    for (const timer of this.callbackTimers.values()) {
      clearTimeout(timer);
    }
    this.callbackTimers.clear();

    // Clear callback ID map
    this.callbackIdMap.clear();
  }
}
