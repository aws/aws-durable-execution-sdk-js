import { ExecutionContext, DurablePromise } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { PromiseResolver } from "../../types/promise-resolver";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { Serdes } from "../../utils/serdes/serdes";
import { log } from "../../utils/logger/logger";

export const createCentralizedCallbackPromise = <T>(
  context: ExecutionContext,
  checkpointManager: CentralizedCheckpointManager,
  stepId: string,
  stepName: string | undefined,
  serdes: Omit<Serdes<T>, "serialize">,
  terminationMessage: string,
  checkAndUpdateReplayMode: () => void,
): DurablePromise<T> => {
  return new DurablePromise(async (): Promise<T> => {
    log("🔄", "Centralized callback promise executing:", { stepId, stepName });

    // Check current callback status
    const stepData = context.getStepData(stepId);

    // Handle case where stepData doesn't exist yet
    if (!stepData) {
      log("⚠️", "Step data not found, waiting for callback creation:", {
        stepId,
      });

      // Give control to checkpoint manager to wait for callback creation
      return new Promise<T>((resolve, reject) => {
        const resolver: PromiseResolver<T> = {
          handlerId: `${stepId}-callback-wait`,
          resolve: () => {
            // Re-execute the callback promise logic
            createCentralizedCallbackPromise(
              context,
              checkpointManager,
              stepId,
              stepName,
              serdes,
              terminationMessage,
              checkAndUpdateReplayMode,
            )
              .then(resolve)
              .catch(reject);
          },
          reject,
          // No scheduled time - wait indefinitely for callback
          metadata: {
            stepId,
            stepName,
            reason: "waiting-for-callback-creation",
          },
        };

        checkpointManager.scheduleResume(resolver);
      });
    }

    // Handle completed callback
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

    // Handle failed callback
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

    // Handle pending callback
    if (stepData.Status === OperationStatus.STARTED) {
      log("⏳", "Callback still pending, waiting for completion");

      // Give control to checkpoint manager to wait for callback completion
      return new Promise<T>((resolve, reject) => {
        const resolver: PromiseResolver<T> = {
          handlerId: `${stepId}-callback-pending`,
          resolve: () => {
            // Re-execute the callback promise logic when status changes
            createCentralizedCallbackPromise(
              context,
              checkpointManager,
              stepId,
              stepName,
              serdes,
              terminationMessage,
              checkAndUpdateReplayMode,
            )
              .then(resolve)
              .catch(reject);
          },
          reject,
          // No scheduled time - wait indefinitely for callback completion
          metadata: {
            stepId,
            stepName,
            reason: "waiting-for-callback-completion",
          },
        };

        checkpointManager.scheduleResume(resolver);
      });
    }

    // Should not reach here, but handle unexpected status
    throw new CallbackError(`Unexpected callback status: ${stepData.Status}`);
  }, stepId);
};
