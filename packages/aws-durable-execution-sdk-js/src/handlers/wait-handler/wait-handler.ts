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

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId?: string,
): {
  (name: string, duration: Duration): Promise<void>;
  (duration: Duration): Promise<void>;
} => {
  function waitHandler(name: string, duration: Duration): Promise<void>;
  function waitHandler(duration: Duration): Promise<void>;
  async function waitHandler(
    nameOrDuration: string | Duration,
    duration?: Duration,
  ): Promise<void> {
    const isNameFirst = typeof nameOrDuration === "string";
    const actualName = isNameFirst ? nameOrDuration : undefined;
    const actualDuration = isNameFirst ? duration! : nameOrDuration;
    const actualSeconds = durationToSeconds(actualDuration);
    const stepId = createStepId();

    log("⏲️", "Wait requested:", {
      stepId,
      name: actualName,
      duration: actualDuration,
      seconds: actualSeconds,
    });

    // Main wait logic - can be re-executed if step data changes
    while (true) {
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

      // Check if there are any ongoing operations
      if (!hasRunningOperations()) {
        // A.1: No ongoing operations - safe to terminate
        return terminate(
          context,
          TerminationReason.WAIT_SCHEDULED,
          `Operation ${actualName || stepId} scheduled to wait`,
        );
      }

      // There are ongoing operations - wait before continuing
      // Refresh stepData after checkpoint to get ScheduledEndTimestamp
      stepData = context.getStepData(stepId);
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
  }

  return waitHandler;
};
