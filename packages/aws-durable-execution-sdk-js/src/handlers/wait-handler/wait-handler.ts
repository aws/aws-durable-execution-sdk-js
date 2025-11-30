import {
  ExecutionContext,
  OperationSubType,
  Duration,
  OperationLifecycleState,
} from "../../types";
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

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
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

    // Phase 1: Start wait operation
    let isCompleted = false;

    const phase1Promise = (async (): Promise<void> => {
      log("⏲️", "Wait phase 1:", {
        stepId,
        name: actualName,
        seconds: actualSeconds,
      });

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

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Wait already completed:", { stepId });
        checkAndUpdateReplayMode?.();

        // Mark as completed
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name: actualName,
              type: OperationType.WAIT,
              subType: OperationSubType.WAIT,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Start wait if not already started
      if (!stepData) {
        await checkpoint.checkpoint(stepId, {
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

      // Refresh stepData after checkpoint
      stepData = context.getStepData(stepId);

      // Mark as IDLE_NOT_AWAITED (phase 1 complete, not awaited yet)
      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId,
            name: actualName,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
            parentId,
          },
          endTimestamp: stepData?.WaitDetails?.ScheduledEndTimestamp,
        },
      );

      log("✅", "Wait phase 1 complete:", { stepId });
    })();

    // Prevent unhandled rejection
    phase1Promise.catch(() => {});

    // Phase 2: Wait for completion
    return new DurablePromise(async () => {
      // Wait for phase 1
      await phase1Promise;

      // If already completed in phase 1, skip phase 2
      if (isCompleted) {
        return;
      }

      log("⏲️", "Wait phase 2:", { stepId });

      // Mark as awaited
      checkpoint.markOperationAwaited(stepId);

      // Wait for status change
      await checkpoint.waitForStatusChange(stepId);

      // Check final status
      const stepData = context.getStepData(stepId);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("✅", "Wait completed:", { stepId });
        checkAndUpdateReplayMode?.();

        // Mark as completed
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
        );
        return;
      }

      // Should not reach here, but handle gracefully
      log("⚠️", "Wait ended with unexpected status:", {
        stepId,
        status: stepData?.Status,
      });
    });
  }

  return waitHandler;
};
