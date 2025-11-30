import { ExecutionContext, OperationSubType, Duration } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { DurablePromise } from "../../types/durable-promise";
import { PromiseResolver } from "../../types/promise-resolver";

export const createCentralizedWaitHandler = (
  context: ExecutionContext,
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
    const isNameFirst = typeof nameOrDuration === "string";
    const actualName = isNameFirst ? nameOrDuration : undefined;
    const actualDuration = isNameFirst ? duration! : nameOrDuration;
    const actualSeconds = durationToSeconds(actualDuration);
    const stepId = createStepId();

    log("⏲️", `Creating centralized wait handler:`, {
      stepId,
      name: actualName,
      duration: actualDuration,
      seconds: actualSeconds,
    });

    return new DurablePromise(async (): Promise<void> => {
      // Check if wait already completed
      let stepData = context.getStepData(stepId);

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

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Wait already completed:", { stepId });
        checkAndUpdateReplayMode?.();
        return;
      }

      // Checkpoint START if not already started
      if (!stepData) {
        await checkpointManager.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.WAIT,
          Type: OperationType.WAIT,
          Name: actualName,
          WaitOptions: {
            WaitSeconds: actualSeconds,
          },
        });
      }

      // Calculate scheduled time
      const scheduledTime = Date.now() + actualSeconds * 1000;

      // Give control to checkpoint manager
      return new Promise<void>((resolve, reject) => {
        const resolver: PromiseResolver<void> = {
          handlerId: stepId,
          resolve: () => {
            log("✅", `Wait completed for ${actualName || stepId}`);

            // Checkpoint completion
            checkpointManager
              .checkpoint(stepId, {
                Id: stepId,
                ParentId: parentId,
                Action: OperationAction.SUCCEED,
              })
              .then(() => {
                checkAndUpdateReplayMode?.();
                resolve();
              })
              .catch(reject);
          },
          reject,
          scheduledTime,
          metadata: {
            name: actualName,
            duration: actualDuration,
            seconds: actualSeconds,
          },
        };

        log("📋", `Scheduling wait with checkpoint manager:`, {
          stepId,
          scheduledTime: new Date(scheduledTime).toISOString(),
        });

        checkpointManager.scheduleResume(resolver);
      });
    }, stepId);
  }

  return waitHandler;
};
