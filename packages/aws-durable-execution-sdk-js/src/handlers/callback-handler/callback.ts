import {
  ExecutionContext,
  CreateCallbackConfig,
  CreateCallbackResult,
  OperationSubType,
  DurablePromise,
  OperationLifecycleState,
} from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { Serdes } from "../../utils/serdes/serdes";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { durationToSeconds } from "../../utils/duration/duration";
import { createCallbackPromise } from "./callback-promise";

export const createPassThroughSerdes = <T>(): Serdes<T> => ({
  serialize: async (value: T | undefined) => value as string | undefined,
  deserialize: async (data: string | undefined) => data as T | undefined,
});

export const createCallback = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  checkAndUpdateReplayMode: () => void,
  parentId?: string,
) => {
  return <T>(
    nameOrConfig?: string | undefined | CreateCallbackConfig<T>,
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

    // Phase 1: Setup and checkpoint
    let isCompleted = false;

    const phase1Promise = (async (): Promise<void> => {
      log("📞", "Callback phase 1:", { stepId, name });

      let stepData = context.getStepData(stepId);

      // Validate replay consistency
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

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Callback already completed:", { stepId });
        checkAndUpdateReplayMode();

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.CALLBACK,
              subType: OperationSubType.CALLBACK,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Check if already failed
      if (
        stepData?.Status === OperationStatus.FAILED ||
        stepData?.Status === OperationStatus.TIMED_OUT
      ) {
        log("❌", "Callback already failed:", { stepId });

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.CALLBACK,
              subType: OperationSubType.CALLBACK,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Start callback if not already started
      if (!stepData) {
        await checkpoint.checkpoint(stepId, {
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

        // Refresh stepData after checkpoint
        stepData = context.getStepData(stepId);
      }

      // Mark as IDLE_NOT_AWAITED
      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId,
            name,
            type: OperationType.CALLBACK,
            subType: OperationSubType.CALLBACK,
            parentId,
          },
        },
      );

      log("✅", "Callback phase 1 complete:", { stepId });
    })();

    phase1Promise.catch(() => {});

    // Phase 2: Handle results and create callback promise
    return new DurablePromise(async (): Promise<CreateCallbackResult<T>> => {
      await phase1Promise;

      if (isCompleted) {
        const stepData = context.getStepData(stepId);

        const callbackData = stepData?.CallbackDetails;
        if (!callbackData?.CallbackId) {
          throw new CallbackError(
            `No callback ID found for callback: ${stepId}`,
          );
        }

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
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

          return [resolvedPromise, callbackData.CallbackId];
        }

        // Handle failure
        const error = stepData?.CallbackDetails?.Error;
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

      log("📞", "Callback phase 2:", { stepId });

      const stepData = context.getStepData(stepId);
      const callbackData = stepData?.CallbackDetails;
      if (!callbackData?.CallbackId) {
        throw new CallbackError(
          `No callback ID found for started callback: ${stepId}`,
        );
      }

      const callbackId = callbackData.CallbackId;

      const callbackPromise = createCallbackPromise<T>(
        context,
        checkpoint,
        stepId,
        name,
        serdes,
        checkAndUpdateReplayMode,
      );

      log("✅", "Callback created:", { stepId, name, callbackId });

      return [callbackPromise, callbackId];
    });
  };
};
