import {
  ExecutionContext,
  StepFunc,
  StepConfig,
  StepSemantics,
  OperationSubType,
  StepContext,
  DurablePromise,
  DurableExecutionMode,
  OperationLifecycleState,
} from "../../types";
import { durationToSeconds } from "../../utils/duration/duration";
import { terminateForUnrecoverableError } from "../../utils/termination-helper/termination-helper";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { retryPresets } from "../../utils/retry/retry-presets/retry-presets";
import { StepInterruptedError } from "../../errors/step-errors/step-errors";
import {
  DurableOperationError,
  StepError,
} from "../../errors/durable-error/durable-error";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { isUnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { DurableLogger } from "../../types/durable-logger";

export const createStepHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  parentContext: Context,
  createStepId: () => string,
  logger: Logger,
  parentId?: string,
) => {
  return <T>(
    nameOrFn: string | undefined | StepFunc<T, Logger>,
    fnOrOptions?: StepFunc<T, Logger> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): DurablePromise<T> => {
    let name: string | undefined;
    let fn: StepFunc<T, Logger>;
    let options: StepConfig<T> | undefined;

    if (typeof nameOrFn === "string" || nameOrFn === undefined) {
      name = nameOrFn;
      fn = fnOrOptions as StepFunc<T, Logger>;
      options = maybeOptions;
    } else {
      fn = nameOrFn;
      options = fnOrOptions as StepConfig<T>;
    }

    const stepId = createStepId();
    const semantics = options?.semantics || StepSemantics.AtLeastOncePerRetry;
    const serdes = options?.serdes || defaultSerdes;

    // Phase 1: Execute step
    const phase1Promise = (async (): Promise<T> => {
      let stepData = context.getStepData(stepId);

      validateReplayConsistency(
        stepId,
        { type: OperationType.STEP, name, subType: OperationSubType.STEP },
        stepData,
        context,
      );

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Step already completed:", { stepId });
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
              parentId,
            },
          },
        );
        return await safeDeserialize(
          serdes,
          stepData.StepDetails?.Result,
          stepId,
          name,
          context.terminationManager,
          context.durableExecutionArn,
        );
      }

      // Check if already failed
      if (stepData?.Status === OperationStatus.FAILED) {
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
              parentId,
            },
          },
        );
        if (stepData.StepDetails?.Error) {
          throw DurableOperationError.fromErrorObject(
            stepData.StepDetails.Error,
          );
        }
        throw new StepError("Unknown error");
      }

      // Check if pending retry
      if (stepData?.Status === OperationStatus.PENDING) {
        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
              parentId,
            },
            endTimestamp: stepData.StepDetails?.NextAttemptTimestamp,
          },
        );
        return (async (): Promise<T> => {
          await checkpoint.waitForRetryTimer(stepId);
          stepData = context.getStepData(stepId);
          return await executeStepLogic();
        })();
      }

      // Check for interrupted step with AT_MOST_ONCE_PER_RETRY
      if (
        stepData?.Status === OperationStatus.STARTED &&
        semantics === StepSemantics.AtMostOncePerRetry
      ) {
        const error = new StepInterruptedError(stepId, name);
        const currentAttempt = (stepData.StepDetails?.Attempt || 0) + 1;
        const retryDecision =
          options?.retryStrategy?.(error, currentAttempt) ??
          retryPresets.default(error, currentAttempt);

        if (!retryDecision.shouldRetry) {
          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.FAIL,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Error: createErrorObjectFromError(error),
            Name: name,
          });
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.COMPLETED,
          );
          throw DurableOperationError.fromErrorObject(
            createErrorObjectFromError(error),
          );
        }

        await checkpoint.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.RETRY,
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Error: createErrorObjectFromError(error),
          Name: name,
          StepOptions: {
            NextAttemptDelaySeconds: retryDecision.delay
              ? durationToSeconds(retryDecision.delay)
              : 1,
          },
        });

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
              parentId,
            },
            endTimestamp:
              context.getStepData(stepId)?.StepDetails?.NextAttemptTimestamp,
          },
        );

        return (async (): Promise<T> => {
          await checkpoint.waitForRetryTimer(stepId);
          stepData = context.getStepData(stepId);
          return await executeStepLogic();
        })();
      }

      return await executeStepLogic();

      async function executeStepLogic(): Promise<T> {
        stepData = context.getStepData(stepId);
        if (stepData?.Status !== OperationStatus.STARTED) {
          if (semantics === StepSemantics.AtMostOncePerRetry) {
            await checkpoint.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.START,
              SubType: OperationSubType.STEP,
              Type: OperationType.STEP,
              Name: name,
            });
          } else {
            checkpoint.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.START,
              SubType: OperationSubType.STEP,
              Type: OperationType.STEP,
              Name: name,
            });
          }
        }

        try {
          stepData = context.getStepData(stepId);
          const currentAttempt = stepData?.StepDetails?.Attempt || 0;
          const stepContext: StepContext<Logger> = { logger };

          // Mark operation as EXECUTING
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.EXECUTING,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType: OperationSubType.STEP,
                parentId,
              },
            },
          );

          let result: T;
          result = await runWithContext(
            stepId,
            parentId,
            () => fn(stepContext),
            currentAttempt + 1,
            DurableExecutionMode.ExecutionMode,
          );

          const serializedResult = await safeSerialize(
            serdes,
            result,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );

          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.SUCCEED,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Payload: serializedResult,
            Name: name,
          });

          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.COMPLETED,
          );

          return await safeDeserialize(
            serdes,
            serializedResult,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );
        } catch (error) {
          if (isUnrecoverableError(error)) {
            return terminateForUnrecoverableError(
              context,
              error,
              name || stepId,
            );
          }

          stepData = context.getStepData(stepId);
          const currentAttempt = (stepData?.StepDetails?.Attempt || 0) + 1;
          const retryDecision =
            options?.retryStrategy?.(
              error instanceof Error ? error : new Error("Unknown Error"),
              currentAttempt,
            ) ??
            retryPresets.default(
              error instanceof Error ? error : new Error("Unknown Error"),
              currentAttempt,
            );

          if (!retryDecision.shouldRetry) {
            await checkpoint.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.FAIL,
              SubType: OperationSubType.STEP,
              Type: OperationType.STEP,
              Error: createErrorObjectFromError(error),
              Name: name,
            });
            checkpoint.markOperationState(
              stepId,
              OperationLifecycleState.COMPLETED,
            );
            throw DurableOperationError.fromErrorObject(
              createErrorObjectFromError(error),
            );
          }

          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.RETRY,
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Error: createErrorObjectFromError(error),
            Name: name,
            StepOptions: {
              NextAttemptDelaySeconds: retryDecision.delay
                ? durationToSeconds(retryDecision.delay)
                : 1,
            },
          });

          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.RETRY_WAITING,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType: OperationSubType.STEP,
                parentId,
              },
              endTimestamp:
                context.getStepData(stepId)?.StepDetails?.NextAttemptTimestamp,
            },
          );

          await checkpoint.waitForRetryTimer(stepId);
          return await executeStepLogic();
        }
      }
    })();

    phase1Promise.catch(() => {});

    return new DurablePromise(async () => {
      checkpoint.markOperationAwaited(stepId);
      return await phase1Promise;
    });
  };
};
