import { ExecutionContext, OperationSubType, StepConfig } from "../../types";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { DurablePromise } from "../../types/durable-promise";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { Serdes } from "../../utils/serdes/serdes";
import { durationToSeconds } from "../../utils/duration/duration";

export const createCentralizedStepHandler = <T>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  checkpointManager: CentralizedCheckpointManager,
  createStepId: () => string,
  serdes: Serdes<T>,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
): {
  <R>(
    name: string,
    fn: () => Promise<R>,
    options?: StepConfig<R>,
  ): DurablePromise<R>;
  <R>(fn: () => Promise<R>, options?: StepConfig<R>): DurablePromise<R>;
} => {
  function stepHandler<R>(
    name: string,
    fn: () => Promise<R>,
    options?: StepConfig<R>,
  ): DurablePromise<R>;
  function stepHandler<R>(
    fn: () => Promise<R>,
    options?: StepConfig<R>,
  ): DurablePromise<R>;
  function stepHandler<R>(
    nameOrFn: string | (() => Promise<R>),
    fnOrOptions?: (() => Promise<R>) | StepConfig<R>,
    options?: StepConfig<R>,
  ): DurablePromise<R> {
    const actualName = typeof nameOrFn === "string" ? nameOrFn : undefined;
    const actualFn =
      typeof nameOrFn === "string"
        ? (fnOrOptions as () => Promise<R>)
        : nameOrFn;
    const actualOptions =
      typeof nameOrFn === "string" ? options : (fnOrOptions as StepConfig<R>);
    const stepId = createStepId();
    const handlerId = `step-${stepId}`;

    return new DurablePromise(async (): Promise<R> => {
      log("🔄", "Centralized step handler executing:", {
        stepId,
        actualName,
        handlerId,
      });

      const stepData = context.getStepData(stepId);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("✅", "Step already completed:", { stepId });
        const result = await serdes.deserialize(
          (stepData as any).StepDetails?.Result,
          {
            entityId: stepId,
            durableExecutionArn: context.durableExecutionArn,
          },
        );
        checkAndUpdateReplayMode?.();
        return result as R;
      }

      if (!stepData) {
        // Checkpoint START for new step
        await checkpoint.checkpoint(stepId, {
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Action: OperationAction.START,
          Name: actualName,
          ParentId: parentId,
        });
        log("📝", "Step checkpointed as STARTED:", { stepId });
      } else {
        // Validate replay consistency
        validateReplayConsistency(
          stepId,
          {
            type: OperationType.STEP,
            name: actualName,
            subType: OperationSubType.STEP,
          },
          stepData,
          context,
        );

        // Handle retry logic
        if (stepData.Status === OperationStatus.FAILED) {
          const nextAttemptTime = (stepData as any).StepDetails
            ?.NextAttemptTimestamp;
          if (
            nextAttemptTime &&
            Date.now() < new Date(nextAttemptTime).getTime()
          ) {
            log("⏳", "Step retry scheduled, waiting:", {
              stepId,
              nextAttemptTime,
            });
            // Schedule with checkpoint manager and return promise
            return new Promise<R>((resolve, reject) => {
              checkpointManager.scheduleResume(
                handlerId,
                resolve,
                reject,
                new Date(nextAttemptTime).getTime(),
              );
            });
          }
        }
      }

      // Execute the step function
      try {
        log("▶️", "Executing step function:", { stepId });
        const result = await actualFn();

        // Serialize and checkpoint the result
        const serializedResult = await serdes.serialize(result as T, {
          entityId: stepId,
          durableExecutionArn: context.durableExecutionArn,
        });
        await checkpoint.checkpoint(stepId, {
          Type: OperationType.STEP,
          SubType: OperationSubType.STEP,
          Action: OperationAction.SUCCEED,
          Payload: await serializedResult,
        });

        log("✅", "Step completed successfully:", { stepId });
        checkAndUpdateReplayMode?.();
        return result;
      } catch (error) {
        log("❌", "Step failed:", { stepId, error: (error as Error).message });

        // Handle retry logic
        const retryStrategy = actualOptions?.retryStrategy;
        const currentAttempt =
          ((stepData as any)?.StepDetails?.Attempt || 0) + 1;

        const retryDecision = retryStrategy
          ? retryStrategy(error as Error, currentAttempt)
          : { shouldRetry: false };

        if (retryDecision.shouldRetry && currentAttempt < 3) {
          const retryDelay = retryDecision.delay
            ? durationToSeconds(retryDecision.delay) * 1000
            : 1000;
          const scheduledTime = Date.now() + retryDelay;

          await checkpoint.checkpoint(stepId, {
            Type: OperationType.STEP,
            SubType: OperationSubType.STEP,
            Action: OperationAction.RETRY,
            StepOptions: {
              NextAttemptDelaySeconds: Math.ceil(retryDelay / 1000),
            },
          });

          log("🔄", "Step retry scheduled:", {
            stepId,
            scheduledTime,
            attempt: currentAttempt,
          });
          return new Promise<R>((resolve, reject) => {
            checkpointManager.scheduleResume(
              handlerId,
              resolve,
              reject,
              scheduledTime,
            );
          });
        } else {
          // Max retries exceeded
          await checkpoint.checkpoint(stepId, {
            Type: OperationType.STEP,
            SubType: OperationSubType.STEP,
            Action: OperationAction.FAIL,
          });

          throw error;
        }
      }
    });
  }

  return stepHandler;
};

// Legacy export for backward compatibility
export const createStepHandler = createCentralizedStepHandler;
