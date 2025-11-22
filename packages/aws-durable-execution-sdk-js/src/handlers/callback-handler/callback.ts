import {
  ExecutionContext,
  CreateCallbackConfig,
  CreateCallbackResult,
  OperationSubType,
  DurablePromise,
} from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { Serdes } from "../../utils/serdes/serdes";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { EventEmitter } from "events";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { createCallbackPromise } from "./callback-promise";

const createPassThroughSerdes = <T>(): Serdes<T> => ({
  serialize: async (value: T | undefined) => value as string | undefined,
  deserialize: async (data: string | undefined) => data as T | undefined,
});

export const createCallback = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  checkAndUpdateReplayMode: () => void,
  parentId?: string,
) => {
  return <T>(
    nameOrConfig?: string | CreateCallbackConfig<T>,
    maybeConfig?: CreateCallbackConfig<T>,
  ): DurablePromise<CreateCallbackResult<T>> => {
    let name: string | undefined;
    let config: CreateCallbackConfig<T> | undefined;

    if (typeof nameOrConfig === "string" || nameOrConfig === undefined) {
      name = nameOrConfig;
      config = maybeConfig;
    } else {
      config = nameOrConfig;
    }

    const stepId = createStepId();
    const serdes = config?.serdes || createPassThroughSerdes<T>();

    // Validate replay consistency first
    const stepData = context.getStepData(stepId);
    validateReplayConsistency(
      stepId,
      {
        type: OperationType.CALLBACK,
        name,
        subType: OperationSubType.CALLBACK,
      },
      stepData,
      context,
    );

    // Phase 1: Setup and checkpoint (immediate execution)
    const setupPromise = (async (): Promise<{ wasNewCallback: boolean }> => {
      log("📞", "Creating callback phase 1:", { stepId, name, config });

      // Handle already completed callbacks
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Callback already completed in phase 1:", { stepId });
        return { wasNewCallback: false };
      }

      if (
        stepData?.Status === OperationStatus.FAILED ||
        stepData?.Status === OperationStatus.TIMED_OUT
      ) {
        log("❌", "Callback already failed in phase 1:", { stepId });
        return { wasNewCallback: false };
      }

      // Handle already started callbacks
      if (stepData?.Status === OperationStatus.STARTED) {
        log("⏳", "Callback already started in phase 1:", { stepId });
        return { wasNewCallback: false };
      }

      // Create new callback - checkpoint START operation
      log("🆕", "Creating new callback in phase 1:", { stepId, name });
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: parentId,
        Action: "START",
        SubType: OperationSubType.CALLBACK,
        Type: OperationType.CALLBACK,
        Name: name,
        CallbackOptions: {
          TimeoutSeconds: config?.timeout
            ? durationToSeconds(config.timeout)
            : undefined,
          HeartbeatTimeoutSeconds: config?.heartbeatTimeout
            ? durationToSeconds(config.heartbeatTimeout)
            : undefined,
        },
      });

      log("✅", "Callback checkpoint completed in phase 1:", { stepId });
      return { wasNewCallback: true };
    })().catch((error) => {
      log("❌", "Callback phase 1 error:", { stepId, error: error.message });
      throw error;
    });

    // Return DurablePromise that executes phase 2 when awaited
    return new DurablePromise(async (): Promise<CreateCallbackResult<T>> => {
      // Wait for phase 1 to complete
      const { wasNewCallback } = await setupPromise;

      // Phase 2: Handle results and create callback promise
      log("🔄", "Callback phase 2 executing:", { stepId, name });

      const stepData = context.getStepData(stepId);

      // Handle completed callbacks
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        const callbackData = stepData.CallbackDetails;
        if (!callbackData?.CallbackId) {
          throw new CallbackError(
            `No callback ID found for completed callback: ${stepId}`,
          );
        }

        const deserializedResult = await safeDeserialize(
          serdes,
          callbackData.Result,
          stepId,
          name,
          context.terminationManager,
          context.durableExecutionArn,
        );

        const resolvedPromise = new DurablePromise(
          async (): Promise<T> => deserializedResult as T,
        );

        // Check and update replay mode after callback completion
        checkAndUpdateReplayMode();

        return [resolvedPromise, callbackData.CallbackId];
      }

      // Handle failed callbacks
      if (
        stepData?.Status === OperationStatus.FAILED ||
        stepData?.Status === OperationStatus.TIMED_OUT
      ) {
        const callbackData = stepData.CallbackDetails;
        if (!callbackData?.CallbackId) {
          throw new CallbackError(
            `No callback ID found for failed callback: ${stepId}`,
          );
        }

        const error = stepData.CallbackDetails?.Error;
        const callbackError = error
          ? ((): CallbackError => {
              const cause = new Error(error.ErrorMessage);
              cause.name = error.ErrorType || "Error";
              cause.stack = error.StackTrace?.join("\n");
              return new CallbackError(
                error.ErrorMessage || "Callback failed",
                cause,
                error.ErrorData,
              );
            })()
          : new CallbackError("Callback failed");

        const rejectedPromise = new DurablePromise(async (): Promise<T> => {
          throw callbackError;
        });
        return [rejectedPromise, callbackData.CallbackId];
      }

      // Handle started or new callbacks
      const callbackData = stepData?.CallbackDetails;
      if (!callbackData?.CallbackId) {
        const errorMessage = wasNewCallback
          ? `Callback ID not found in stepData after checkpoint: ${stepId}`
          : `No callback ID found for started callback: ${stepId}`;
        throw new CallbackError(errorMessage);
      }

      const callbackId = callbackData.CallbackId;

      // Create callback promise that handles completion
      const terminationMessage = wasNewCallback
        ? `Callback ${name || stepId} created and pending external completion`
        : `Callback ${name || stepId} is pending external completion`;

      const callbackPromise = createCallbackPromise<T>(
        context,
        stepId,
        name,
        serdes,
        hasRunningOperations,
        getOperationsEmitter(),
        terminationMessage,
        checkAndUpdateReplayMode,
      );

      log("✅", "Callback created successfully in phase 2:", {
        stepId,
        name,
        callbackId,
      });

      return [callbackPromise, callbackId];
    });
  };
};
