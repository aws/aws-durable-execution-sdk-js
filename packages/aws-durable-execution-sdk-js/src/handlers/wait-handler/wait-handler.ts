import { ExecutionContext, OperationSubType, Duration } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { DurablePromise } from "../../types/durable-promise";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";

export const createCentralizedWaitHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  checkpointManager: CentralizedCheckpointManager,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
): {
  (name: string, duration: Duration): DurablePromise<void>;
  (duration: Duration): DurablePromise<void>;
} => {
  function waitHandler(name: string, duration: Duration): DurablePromise<void>;
  function waitHandler(duration: Duration): DurablePromise<void>;
  function waitHandler(
    nameOrDuration: string | Duration,
    duration?: Duration,
  ): DurablePromise<void> {
    const actualName =
      typeof nameOrDuration === "string" ? nameOrDuration : undefined;
    const actualDuration =
      typeof nameOrDuration === "string" ? duration! : nameOrDuration;
    const stepId = createStepId();
    const handlerId = `wait-${stepId}`;

    return new DurablePromise(async (): Promise<void> => {
      log("⏳", "Centralized wait handler executing:", {
        stepId,
        actualName,
        handlerId,
        duration: actualDuration,
      });

      const stepData = context.getStepData(stepId);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("✅", "Wait already completed:", { stepId });
        checkAndUpdateReplayMode?.();
        return;
      }

      if (!stepData) {
        // Checkpoint START for new wait
        await checkpoint.checkpoint(stepId, {
          Type: OperationType.WAIT,
          SubType: OperationSubType.WAIT,
          Action: OperationAction.START,
          Name: actualName,
          ParentId: parentId,
          WaitOptions: {
            WaitSeconds: durationToSeconds(actualDuration),
          },
        });
        log("📝", "Wait checkpointed as STARTED:", { stepId });
      } else {
        // Validate replay consistency
        validateReplayConsistency(
          stepId,
          {
            type: OperationType.WAIT,
            name: actualName,
            subType: OperationSubType.WAIT,
          },
          stepData,
          context,
        );
      }

      // Calculate scheduled time
      const waitDurationMs = durationToSeconds(actualDuration) * 1000;
      const startTime = stepData?.StartTimestamp
        ? new Date(stepData.StartTimestamp).getTime()
        : Date.now();
      const scheduledTime = startTime + waitDurationMs;

      // If wait time has already passed, complete immediately
      if (Date.now() >= scheduledTime) {
        log("✅", "Wait time already passed, completing:", { stepId });
        await checkpoint.checkpoint(stepId, {
          Type: OperationType.WAIT,
          SubType: OperationSubType.WAIT,
          Action: OperationAction.SUCCEED,
        });
        checkAndUpdateReplayMode?.();
        return;
      }

      // Schedule with checkpoint manager
      log("⏰", "Scheduling wait with checkpoint manager:", {
        handlerId,
        scheduledTime,
      });
      return new Promise<void>((resolve, reject) => {
        checkpointManager.scheduleResume(
          handlerId,
          resolve,
          reject,
          scheduledTime,
        );
      });
    });
  }

  return waitHandler;
};

// Legacy export for backward compatibility
export const createWaitHandler = createCentralizedWaitHandler;
