import {
  ExecutionContext,
  StepFunc,
  StepConfig,
  StepSemantics,
  OperationSubType,
} from "../../types";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { PromiseResolver } from "../../types/promise-resolver";
import { DurablePromise } from "../../types/durable-promise";
import { log } from "../../utils/logger/logger";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { defaultSerdes } from "../../utils/serdes/serdes";
import { retryPresets } from "../../utils/retry/retry-presets/retry-presets";
import { durationToSeconds } from "../../utils/duration/duration";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import {
  OperationStatus,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import { Context } from "aws-lambda";
import { DurableLogger } from "../../types/durable-logger";

export const createCentralizedStepHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpointManager: CentralizedCheckpointManager,
  parentContext: Context,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
) => {
  return <T>(
    name: string,
    func: StepFunc<T>,
    options?: StepConfig<T>,
  ): DurablePromise<T> => {
    const stepId = createStepId();
    const semantics = options?.semantics || StepSemantics.AtMostOncePerRetry;
    const serdes = options?.serdes || defaultSerdes;
    const retryStrategy = options?.retryStrategy || retryPresets.default;

    log("🔧", `Creating centralized step handler:`, {
      stepId,
      name,
      semantics,
    });

    return new DurablePromise(async (): Promise<T> => {
      // Check if step already completed
      let stepData = context.getStepData(stepId);

      // Validate replay consistency
      validateReplayConsistency(
        stepId,
        {
          type: OperationType.STEP,
          name,
          subType: OperationSubType.STEP,
        },
        stepData,
        context,
      );

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Step already completed:", { stepId, name });
        checkAndUpdateReplayMode?.();
        return serdes.deserialize((stepData as any).StepDetails?.Result, {
          entityId: stepId,
          durableExecutionArn: context.durableExecutionArn,
        });
      }

      // Checkpoint START if not already started
      if (stepData?.Status !== OperationStatus.STARTED) {
        if (semantics === StepSemantics.AtMostOncePerRetry) {
          // Wait for checkpoint to complete
          await checkpointManager.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.START,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Name: name,
          });
        } else {
          // Fire and forget for AtLeastOncePerRetry
          checkpointManager.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.START,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Name: name,
          });
        }
      }

      // Execute step with retry logic
      let attempt = 0;
      const maxAttempts = 3; // Default max attempts

      while (attempt < maxAttempts) {
        attempt++;

        try {
          log(
            "🚀",
            `Executing step ${name} (attempt ${attempt}/${maxAttempts})`,
          );

          // Create mock step context for function call
          const stepContext = {} as any;
          const result = await func(stepContext);
          const serializedResult = await serdes.serialize(result, {
            entityId: stepId,
            durableExecutionArn: context.durableExecutionArn,
          });

          // Always checkpoint on completion
          await checkpointManager.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.SUCCEED,
            Payload: serializedResult,
          });

          log("✅", `Step ${name} completed successfully`);
          checkAndUpdateReplayMode?.();
          return result;
        } catch (error) {
          log(
            "❌",
            `Step ${name} failed (attempt ${attempt}/${maxAttempts}):`,
            error,
          );

          const retryDecision = retryStrategy
            ? retryStrategy(error as Error, attempt)
            : { shouldRetry: false };

          if (!retryDecision.shouldRetry || attempt >= maxAttempts) {
            // No retry, mark as failed
            await checkpointManager.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.FAIL,
              Error: createErrorObjectFromError(error as Error),
            });

            throw error;
          } else {
            // Retry with delay - use centralized scheduling
            const retryDelay = retryDecision.delay
              ? durationToSeconds(retryDecision.delay) * 1000
              : 1000;
            const scheduledTime = Date.now() + retryDelay;

            log("🔄", `Scheduling retry for step ${name} in ${retryDelay}ms`);

            // Checkpoint retry attempt
            await checkpointManager.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.RETRY,
              StepOptions: {
                NextAttemptDelaySeconds: Math.ceil(retryDelay / 1000),
              },
            });

            // Give control to checkpoint manager for retry scheduling
            await new Promise<void>((resolve, reject) => {
              const resolver: PromiseResolver<void> = {
                handlerId: `${stepId}-retry-${attempt}`,
                resolve: () => {
                  log("🔄", `Retry timer fired for step ${name}`);
                  resolve();
                },
                reject,
                scheduledTime,
                metadata: {
                  stepId,
                  name,
                  attempt,
                  retryDelay,
                },
              };

              checkpointManager.scheduleResume(resolver);
            });

            // Continue to next retry attempt
            continue;
          }
        }
      }

      // Should not reach here, but just in case
      throw new Error(`Step ${name} failed after ${maxAttempts} attempts`);
    }, stepId);
  };
};
