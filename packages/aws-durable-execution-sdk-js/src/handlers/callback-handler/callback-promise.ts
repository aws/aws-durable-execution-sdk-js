import { ExecutionContext, DurablePromise } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { Serdes } from "../../utils/serdes/serdes";
import { log } from "../../utils/logger/logger";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";

export const createCentralizedCallbackPromise = <T>(
  context: ExecutionContext,
  checkpointManager: CentralizedCheckpointManager,
  stepId: string,
  stepName: string | undefined,
  serdes: Omit<Serdes<T>, "serialize">,
  checkAndUpdateReplayMode: () => void,
): DurablePromise<T> => {
  const handlerId = `callback-${stepId}`;

  return new DurablePromise(async (): Promise<T> => {
    log("🔄", "Centralized callback promise executing:", {
      stepId,
      stepName,
      handlerId,
    });

    const stepData = context.getStepData(stepId);

    if (!stepData) {
      log("⚠️", "Step data not found for callback:", { stepId });
      throw new CallbackError(`No step data found for callback: ${stepId}`);
    }

    if (stepData.Status === OperationStatus.SUCCEEDED) {
      const callbackData = stepData.CallbackDetails;
      if (!callbackData?.CallbackId) {
        throw new CallbackError(
          `No callback ID found for completed callback: ${stepId}`,
        );
      }

      const result = await safeDeserialize(
        serdes,
        callbackData.Result,
        stepId,
        stepName,
        context.terminationManager,
        context.durableExecutionArn,
      );

      checkAndUpdateReplayMode();
      return result as T;
    }

    if (
      stepData.Status === OperationStatus.FAILED ||
      stepData.Status === OperationStatus.TIMED_OUT
    ) {
      const callbackData = stepData.CallbackDetails;
      const error = callbackData?.Error;

      if (error) {
        const cause = new Error(error.ErrorMessage);
        cause.name = error.ErrorType || "Error";
        cause.stack = error.StackTrace?.join("\n");
        throw new CallbackError(
          error.ErrorMessage || "Callback failed",
          cause,
          error.ErrorData,
        );
      }

      throw new CallbackError("Callback failed");
    }

    if (stepData.Status === OperationStatus.STARTED) {
      // Callback is pending - schedule with checkpoint manager
      log("⏳", "Callback pending, scheduling with checkpoint manager:", {
        handlerId,
      });

      return new Promise<T>((resolve, reject) => {
        checkpointManager.scheduleResume(
          handlerId,
          resolve,
          reject,
          Date.now(), // Immediate scheduling for callback checks
        );
      });
    }

    throw new CallbackError(`Unexpected callback status: ${stepData.Status}`);
  });
};

// Legacy export for backward compatibility
export const createCallbackPromise = createCentralizedCallbackPromise;
