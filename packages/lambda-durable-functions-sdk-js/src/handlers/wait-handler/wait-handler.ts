import { ExecutionContext, OperationSubType } from "../../types";
import { OperationStatus, OperationType } from "@amzn/dex-internal-sdk";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { CheckpointFailedError } from "../../errors/checkpoint-errors/checkpoint-errors";

export const createWaitHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
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

    if (context.getStepData(stepId)?.Status === OperationStatus.SUCCEEDED) {
      log(context.isVerbose, "⏭️", "Wait already completed:", { stepId });
      return;
    }

    const wouldBeMocked = OperationInterceptor.forExecution(
      context.durableExecutionArn,
    ).recordOnly(actualName);
    if (wouldBeMocked) {
      throw new CheckpointFailedError("Wait step cannot be mocked");
    }

    await checkpoint(stepId, {
      Id: stepId,
      ParentId: context.parentId,
      Action: "START",
      SubType: OperationSubType.WAIT,
      Type: OperationType.WAIT,
      Name: actualName,
      WaitOptions: {
        WaitSeconds: actualMillis / 1000,
      },
    });

    context.terminationManager.terminate({
      reason: TerminationReason.WAIT_SCHEDULED,
      message: `Operation ${actualName || stepId} scheduled to wait`,
    });

    return new Promise(() => {});
  }

  return waitHandler;
};
