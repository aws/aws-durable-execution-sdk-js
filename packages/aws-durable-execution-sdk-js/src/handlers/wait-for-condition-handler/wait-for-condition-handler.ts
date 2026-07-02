import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  WaitForConditionDecision,
  OperationSubType,
  WaitForConditionContext,
  DurablePromise,
  DurableExecutionMode,
  OperationLifecycleState,
} from "../../types";
import { durationToSeconds } from "../../utils/duration/duration";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { defaultSerdes, AnySerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import {
  DurableOperationError,
  WaitForConditionError,
} from "../../errors/durable-error/durable-error";
import { DurableLogger } from "../../types/durable-logger";
import {
  DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
  PluginOperationStatus,
} from "../../types/plugin";
import {
  toAttemptInfo,
  toAttemptEndInfo,
  backfillOperationInfo,
  toOperationInfo,
} from "../../utils/operation/operation";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

export const createWaitForConditionHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  logger: Logger,
  parentId: string | undefined,

  getDefaultSerdes?: () => AnySerdes,
  plugin: DurableInstrumentationPlugin = {},
) => {
  return <T>(
    nameOrCheck: string | undefined | WaitForConditionCheckFunc<T, Logger>,
    checkOrConfig?:
      | WaitForConditionCheckFunc<T, Logger>
      | WaitForConditionConfig<T>,
    maybeConfig?: WaitForConditionConfig<T>,
  ): DurablePromise<T> => {
    let name: string | undefined;
    let check: WaitForConditionCheckFunc<T, Logger>;
    let config: WaitForConditionConfig<T>;

    if (typeof nameOrCheck === "string" || nameOrCheck === undefined) {
      name = nameOrCheck;
      check = checkOrConfig as WaitForConditionCheckFunc<T, Logger>;
      config = maybeConfig as WaitForConditionConfig<T>;
    } else {
      check = nameOrCheck;
      config = checkOrConfig as WaitForConditionConfig<T>;
    }

    if (!config?.waitStrategy || config.initialState === undefined) {
      throw new Error(
        "waitForCondition requires config with waitStrategy and initialState",
      );
    }

    const stepId = createStepId();
    const serdes =
      config.serdes || (getDefaultSerdes ? getDefaultSerdes() : defaultSerdes);

    const phase1Promise = (async (): Promise<T> => {
      let stepData = context.getStepData(stepId);

      const opInfo = {
        id: hashId(stepId),
        name: name,
        type: OperationType.STEP,
        subType: OperationSubType.WAIT_FOR_CONDITION,
        parentId: parentId ? hashId(parentId) : undefined,
      };

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "WaitForCondition already completed:", { stepId });

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.STEP,
              subType: OperationSubType.WAIT_FOR_CONDITION,
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
              subType: OperationSubType.WAIT_FOR_CONDITION,
              parentId,
            },
          },
        );

        if (stepData.StepDetails?.Error) {
          throw DurableOperationError.fromErrorObject(
            stepData.StepDetails.Error,
          );
        }
        throw new WaitForConditionError("waitForCondition failed");
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
              subType: OperationSubType.WAIT_FOR_CONDITION,
              parentId,
            },
            endTimestamp: stepData.StepDetails?.NextAttemptTimestamp,
          },
        );
        return (async (): Promise<T> => {
          await checkpoint.waitForRetryTimer(stepId);
          stepData = context.getStepData(stepId);
          return await executeCheckLogic();
        })();
      }

      return await executeCheckLogic();

      async function executeCheckLogic(): Promise<T> {
        stepData = context.getStepData(stepId);

        // Get current state
        let currentState: T;
        if (
          stepData?.Status === OperationStatus.STARTED ||
          stepData?.Status === OperationStatus.READY
        ) {
          const checkpointData = stepData.StepDetails?.Result;
          if (checkpointData) {
            try {
              const serdesContext = {
                entityId: stepId,
                durableExecutionArn: context.durableExecutionArn,
              };
              currentState = await serdes.deserialize(
                checkpointData,
                serdesContext,
              );
            } catch {
              currentState = config.initialState;
            }
          } else {
            currentState = config.initialState;
          }
        } else {
          currentState = config.initialState;
        }

        const currentAttempt = (stepData?.StepDetails?.Attempt ?? 0) + 1;

        // Checkpoint START if not already started
        if (stepData?.Status !== OperationStatus.STARTED) {
          const isRetryAttempt = (stepData?.StepDetails?.Attempt || 0) >= 1;
          checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.START,
            SubType: OperationSubType.WAIT_FOR_CONDITION,
            Type: OperationType.STEP,
            Name: name,
          });
          const operationInfo = toOperationInfo(stepData);
          backfillOperationInfo(operationInfo, opInfo);
          await plugin.onOperationStart?.({
            ...opInfo,
            status: PluginOperationStatus.STARTED,
            isReplay: isRetryAttempt,
          });
        } else {
          const operationInfo = toOperationInfo(stepData);
          backfillOperationInfo(operationInfo, opInfo);
          await plugin.onOperationStart?.({ ...operationInfo, isReplay: true });
        }

        try {
          const waitForConditionContext: WaitForConditionContext<Logger> = {
            logger,
          };

          // Mark operation as EXECUTING
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.EXECUTING,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType: OperationSubType.WAIT_FOR_CONDITION,
                parentId,
              },
            },
          );

          const attemptInfo = toAttemptInfo(stepData, currentAttempt);
          backfillOperationInfo(attemptInfo, opInfo);
          const checkFunc = () => check(currentState, waitForConditionContext);

          await plugin.onOperationAttemptStart?.(attemptInfo);

          const newState: T = (await runWithContext(
            stepId,
            parentId,
            plugin.wrapOperationAttemptFn
              ? () => plugin.wrapOperationAttemptFn!(attemptInfo, checkFunc)
              : checkFunc,
            currentAttempt,
            DurableExecutionMode.ExecutionMode,
          )) as T;

          const serializedState = await safeSerialize(
            serdes,
            newState,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );
          const deserializedState = await safeDeserialize(
            serdes,
            serializedState,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );

          const decision: WaitForConditionDecision = config.waitStrategy(
            deserializedState,
            currentAttempt,
          );

          if (!decision.shouldContinue) {
            await checkpoint.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.SUCCEED,
              SubType: OperationSubType.WAIT_FOR_CONDITION,
              Type: OperationType.STEP,
              Payload: serializedState,
              Name: name,
            });
            stepData = context.getStepData(stepId);
            const attemptEndInfo = toAttemptEndInfo(
              stepData,
              AttemptEndInfoOutcome.SUCCEEDED,
              {
                attempt: currentAttempt,
              },
            );
            backfillOperationInfo(attemptEndInfo, opInfo);
            await plugin.onOperationAttemptEnd?.({
              ...attemptEndInfo,
              startTimestamp: attemptEndInfo.endTimestamp,
            });
            await plugin.onOperationEnd?.({
              ...attemptEndInfo,
              isReplay: false,
            });
            checkpoint.markOperationState(
              stepId,
              OperationLifecycleState.COMPLETED,
            );
            return deserializedState;
          }

          const nextAttemptDelaySeconds = durationToSeconds(decision.delay);
          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.RETRY,
            SubType: OperationSubType.WAIT_FOR_CONDITION,
            Type: OperationType.STEP,
            Payload: serializedState,
            Name: name,
            StepOptions: {
              NextAttemptDelaySeconds: nextAttemptDelaySeconds,
            },
          });
          stepData = context.getStepData(stepId);
          const attemptEndInfo = toAttemptEndInfo(
            stepData,
            AttemptEndInfoOutcome.FAILED,
            {
              attempt: currentAttempt,
              nextAttemptDelaySeconds,
            },
          );
          backfillOperationInfo(attemptEndInfo, opInfo);
          await plugin.onOperationAttemptEnd?.({
            ...attemptEndInfo,
            startTimestamp: attemptEndInfo.endTimestamp,
          });

          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.RETRY_WAITING,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType: OperationSubType.WAIT_FOR_CONDITION,
                parentId,
              },
              endTimestamp:
                context.getStepData(stepId)?.StepDetails?.NextAttemptTimestamp,
            },
          );

          await checkpoint.waitForRetryTimer(stepId);
          return await executeCheckLogic();
        } catch (error) {
          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.FAIL,
            SubType: OperationSubType.WAIT_FOR_CONDITION,
            Type: OperationType.STEP,
            Error: createErrorObjectFromError(error),
            Name: name,
          });
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.COMPLETED,
          );
          stepData = context.getStepData(stepId);
          const attemptEndInfo = toAttemptEndInfo(
            stepData,
            AttemptEndInfoOutcome.FAILED,
            {
              attempt: currentAttempt,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          );
          backfillOperationInfo(attemptEndInfo, opInfo);
          await plugin.onOperationAttemptEnd?.({
            ...attemptEndInfo,
            startTimestamp: attemptEndInfo.endTimestamp,
          });
          await plugin.onOperationEnd?.({
            ...attemptEndInfo,
            isReplay: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
          throw DurableOperationError.fromErrorObject(
            createErrorObjectFromError(error),
          );
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
