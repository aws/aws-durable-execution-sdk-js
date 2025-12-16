import {
  CallbackDetails,
  InvalidParameterValueException,
  Event,
  EventType,
  Operation,
} from "@aws-sdk/client-lambda";
import {
  CallbackId,
  createCallbackId,
  ExecutionId,
} from "../utils/tagged-strings";
import { decodeCallbackId, encodeCallbackId } from "../utils/callback-id";
import { CheckpointManager } from "./checkpoint-manager";
import { OperationEvents } from "../../test-runner/common/operations/operation-with-data";
import { OperationHistoryEventDetails } from "./types";

export enum CompleteCallbackStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  TIMED_OUT = "TIMED_OUT",
}

export const callbackHistoryDetails = {
  [CompleteCallbackStatus.SUCCEEDED]: {
    eventType: EventType.CallbackSucceeded,
    detailPlace: "CallbackSucceededDetails",
    getDetails: (operation: Operation) => ({
      Result: {
        Payload: operation.CallbackDetails?.Result,
      },
    }),
  },
  [CompleteCallbackStatus.FAILED]: {
    eventType: EventType.CallbackFailed,
    detailPlace: "CallbackFailedDetails",
    getDetails: (operation: Operation) => ({
      Error: {
        Payload: operation.CallbackDetails?.Error,
      },
    }),
  },
  [CompleteCallbackStatus.TIMED_OUT]: {
    eventType: EventType.CallbackTimedOut,
    detailPlace: "CallbackTimedOutDetails",
    getDetails: (operation: Operation) => ({
      Error: {
        Payload: operation.CallbackDetails?.Error,
      },
    }),
  },
} satisfies Record<
  CompleteCallbackStatus,
  OperationHistoryEventDetails<keyof Event>
>;

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
    private readonly checkpointManager: CheckpointManager,
  ) {}

  /**
   * Creates a callback ID for an operation and sets up associated timers
   */
  createCallback(
    operationId: string,
    timeoutSeconds?: number,
    heartbeatTimeoutSeconds?: number,
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
              Error: {
                ErrorMessage: "Callback timed out",
              },
            },
            CompleteCallbackStatus.TIMED_OUT,
          );
        }, timeoutSeconds * 1000),
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
              Error: {
                ErrorMessage: "Callback timed out on heartbeat",
              },
            },
            CompleteCallbackStatus.TIMED_OUT,
          );
        }, heartbeatTimeoutSeconds * 1000),
      );
    }

    return callbackId;
  }

  /**
   * Completes a callback operation and cleans up associated timers
   */
  completeCallback(
    callbackDetails: CallbackDetails,
    status: CompleteCallbackStatus,
  ): OperationEvents {
    if (!callbackDetails.CallbackId) {
      throw new InvalidParameterValueException({
        message: "Missing callback Id",
        $metadata: {},
      });
    }

    const callbackId = createCallbackId(callbackDetails.CallbackId);
    const { operationId } = decodeCallbackId(callbackId);

    const operationData = this.checkpointManager.getOperationData(operationId);
    if (!operationData) {
      throw new InvalidParameterValueException({
        message: "Could not find operation",
        $metadata: {},
      });
    }

    const { operation, events } = operationData;

    const newOperation = {
      ...this.checkpointManager.markOperationCompleted(operation, status),
      CallbackDetails: callbackDetails,
    };

    const historyDetails = callbackHistoryDetails[status];

    const copied: OperationEvents = {
      operation: newOperation,
      events: [
        ...events,
        this.checkpointManager.eventProcessor.createHistoryEvent(
          historyDetails.eventType,
          newOperation,
          historyDetails.detailPlace,
          historyDetails.getDetails(newOperation),
        ),
      ],
    };

    this.callbackIdMap.delete(callbackId);

    // Clear timeout timers
    this.clearCallbackTimers(callbackId);

    // Notify CheckpointManager about the completed callback
    this.checkpointManager.addOperationUpdate({
      ...copied,
      update: undefined,
    });

    return copied;
  }

  /**
   * Handles callback heartbeat to reset the heartbeat timeout
   */
  heartbeatCallback(callbackId: CallbackId): void {
    const { operationId } = decodeCallbackId(callbackId);
    const operationData = this.checkpointManager.getOperationData(operationId);

    if (!operationData) {
      throw new Error("Could not find operation");
    }

    const heartbeatTimeoutSeconds = operationData.events.find((event) => {
      return !!event.CallbackStartedDetails?.HeartbeatTimeout;
    })?.CallbackStartedDetails?.HeartbeatTimeout;
    if (heartbeatTimeoutSeconds === undefined) {
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
            Error: {
              ErrorMessage: "Callback timed out on heartbeat",
            },
          },
          CompleteCallbackStatus.TIMED_OUT,
        );
      }, heartbeatTimeoutSeconds * 1000),
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
