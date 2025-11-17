import { ExecutionContext, OperationSubType, Duration } from "../../types";
import { terminate } from "../../utils/termination-helper/termination-helper";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { EventEmitter } from "events";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { DurablePromise } from "../../types/durable-promise";

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
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

    // Shared wait logic for both phases
    const executeWaitLogic = async (canTerminate: boolean): Promise<void> => {
      log("⏲️", `Wait executing (${canTerminate ? "phase 2" : "phase 1"}):`, {
        stepId,
        name: actualName,
        duration: actualDuration,
        seconds: actualSeconds,
      });

      let stepData = context.getStepData(stepId);

      // Validate replay consistency once before loop
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

      // Main wait logic - can be re-executed if step data changes
      while (true) {
        stepData = context.getStepData(stepId);

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          log("⏭️", "Wait already completed:", { stepId });
          checkAndUpdateReplayMode?.();
          return;
        }

        // Only checkpoint START if we haven't started this wait before
        if (!stepData) {
          await checkpoint(stepId, {
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

        // Always refresh stepData to ensure it's up-to-date before proceeding
        stepData = context.getStepData(stepId);

        // Check if there are any ongoing operations
        if (!hasRunningOperations()) {
          // Phase 1: Just return without terminating
          // Phase 2: Terminate
          if (canTerminate) {
            return terminate(
              context,
              TerminationReason.WAIT_SCHEDULED,
              `Operation ${actualName || stepId} scheduled to wait`,
            );
          } else {
            log("⏸️", "Wait ready but not terminating (phase 1):", { stepId });
            return;
          }
        }

        // There are ongoing operations - wait before continuing
        await waitBeforeContinue({
          checkHasRunningOperations: true,
          checkStepStatus: true,
          checkTimer: true,
          scheduledEndTimestamp: stepData?.WaitDetails?.ScheduledEndTimestamp,
          stepId,
          context,
          hasRunningOperations,
          operationsEmitter: getOperationsEmitter(),
          checkpoint,
        });

        // Continue the loop to re-evaluate all conditions from the beginning
      }
    };

    // Create a promise that tracks phase 1 completion
    const phase1Promise = executeWaitLogic(false).then(() => {
      log("✅", "Wait phase 1 complete:", { stepId, name: actualName });
    });

    // Return DurablePromise that will execute phase 2 when awaited
    return new DurablePromise(async () => {
      // Wait for phase 1 to complete first
      await phase1Promise;
      // Then execute phase 2
      await executeWaitLogic(true);
    });
  }

  return waitHandler;
};
