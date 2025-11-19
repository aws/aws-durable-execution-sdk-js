import { ExecutionContext, DurablePromise } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { terminate } from "../../utils/termination-helper/termination-helper";
import { TerminationReason } from "../../termination-manager/types";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { Serdes } from "../../utils/serdes/serdes";
import { EventEmitter } from "events";
import { log } from "../../utils/logger/logger";

export const createCallbackPromise = <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes: Serdes<T>,
  hasRunningOperations: () => boolean,
  operationsEmitter: EventEmitter,
  terminationMessage: string,
  checkAndUpdateReplayMode: () => void,
): DurablePromise<T> => {
  return new DurablePromise(async (): Promise<T> => {
    log("🔄", "Callback promise phase 2 executing:", { stepId, stepName });

    // Main callback logic - can be re-executed if step status changes
    while (true) {
      const stepData = context.getStepData(stepId);

      // Handle case where stepData doesn't exist yet
      // While Phase 1 should create stepData via checkpoint before Phase 2 starts,
      // this can be undefined in test scenarios
      if (!stepData) {
        log("⚠️", "Step data not found, waiting for callback creation:", {
          stepId,
        });
        if (hasRunningOperations()) {
          await waitBeforeContinue({
            checkHasRunningOperations: true,
            checkStepStatus: true,
            checkTimer: false,
            stepId,
            context,
            hasRunningOperations,
            operationsEmitter,
          });
          continue; // Re-evaluate after waiting
        }

        // No other operations and no step data - terminate gracefully
        log("⏳", "No step data found and no running operations, terminating");
        return terminate(
          context,
          TerminationReason.CALLBACK_PENDING,
          terminationMessage,
        );
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

        // Check and update replay mode after callback completion
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
        // Callback is still pending
        if (hasRunningOperations()) {
          // Wait for other operations or callback completion
          log("⏳", "Callback still pending, waiting for other operations");
          await waitBeforeContinue({
            checkHasRunningOperations: true,
            checkStepStatus: true,
            checkTimer: false,
            stepId,
            context,
            hasRunningOperations,
            operationsEmitter,
          });
          continue; // Re-evaluate status after waiting
        }

        // No other operations running - terminate
        log("⏳", "Callback still pending, terminating");
        return terminate(
          context,
          TerminationReason.CALLBACK_PENDING,
          terminationMessage,
        );
      }

      // Should not reach here, but handle unexpected status
      throw new CallbackError(`Unexpected callback status: ${stepData.Status}`);
    }
  });
};
