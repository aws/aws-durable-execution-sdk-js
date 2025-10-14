import { ExecutionContext, OperationSubType } from "../../types";
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

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  parentId?: string,
): {
  (name: string, seconds: number): Promise<void>;
  (seconds: number): Promise<void>;
} => {
  function waitHandler(name: string, seconds: number): Promise<void>;
  function waitHandler(seconds: number): Promise<void>;
  async function waitHandler(
    nameOrSeconds: string | number,
    seconds?: number,
  ): Promise<void> {
    const isNameFirst = typeof nameOrSeconds === "string";
    const actualName = isNameFirst ? nameOrSeconds : undefined;
    const actualSeconds = isNameFirst ? seconds! : nameOrSeconds;
    const stepId = createStepId();

    log("⏲️", "Wait requested:", {
      stepId,
      name: actualName,
      seconds: actualSeconds,
    });

    // Main wait logic - can be re-executed if step data changes
    while (true) {
      let stepData = context.getStepData(stepId);
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
        checkpoint,
      });

      // Continue the loop to re-evaluate all conditions from the beginning
    }
  }

  return waitHandler;
};
