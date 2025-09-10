import { ExecutionContext, OperationSubType } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@amzn/dex-internal-sdk";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { CheckpointFailedError } from "../../errors/checkpoint-errors/checkpoint-errors";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
) => {
  function waitHandler(name: string, millis: number): Promise<void>;
  function waitHandler(millis: number): Promise<void>;
  async function waitHandler(
    nameOrMillis: string | number,
    millis?: number,
  ): Promise<void> {
    const isNameFirst = typeof nameOrMillis === "string";
    const actualName = isNameFirst ? nameOrMillis : undefined;
    const actualMillis = isNameFirst ? millis! : nameOrMillis;
    const stepId = createStepId();

    log(context.isVerbose, "⏲️", "Wait requested:", {
      stepId,
      name: actualName,
      millis: actualMillis,
    });

    // Main wait logic - can be re-executed if step data changes
    while (true) {
      const stepData = context.getStepData(stepId);
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log(context.isVerbose, "⏭️", "Wait already completed:", { stepId });
        return;
      }

      const wouldBeMocked = OperationInterceptor.forExecution(
        context.durableExecutionArn,
      ).recordOnly(actualName);
      if (wouldBeMocked) {
        throw new CheckpointFailedError("Wait step cannot be mocked");
      }

      // Only checkpoint START if we haven't started this wait before
      if (!stepData) {
        await checkpoint(stepId, {
          Id: stepId,
          ParentId: context.parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.WAIT,
          Type: OperationType.WAIT,
          Name: actualName,
          WaitOptions: {
            WaitSeconds: actualMillis / 1000,
          },
        });
      }

      // Check if there are any ongoing operations
      if (!hasRunningOperations()) {
        // A.1: No ongoing operations - safe to terminate
        context.terminationManager.terminate({
          reason: TerminationReason.WAIT_SCHEDULED,
          message: `Operation ${actualName || stepId} scheduled to wait`,
        });
        return new Promise(() => {});
      }

      // There are ongoing operations - wait before continuing
      await waitBeforeContinue({
        checkHasRunningOperations: true,
        checkStepStatus: true,
        checkTimer: true,
        scheduledTimestamp: stepData?.WaitDetails?.ScheduledTimestamp,
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
