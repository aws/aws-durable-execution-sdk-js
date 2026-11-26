import { createHash } from "crypto";
import {
  type ExecutionContext,
  type StepFunc,
  type StepConfig,
  StepSemantics,
  OperationSubType,
  type StepContext,
  DurablePromise,
  DurableExecutionMode,
  OperationLifecycleState,
} from "../../types";
import { durationToSeconds } from "../../utils/duration/duration";
import { terminateForUnrecoverableError } from "../../utils/termination-helper/termination-helper";
import type { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "../../types/wire";
import { log } from "../../utils/logger/logger";
import type { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { completeAfter } from "../../utils/checkpoint/complete-after";
import { retryPresets } from "../../utils/retry/retry-presets/retry-presets";
import { StepInterruptedError } from "../../errors/step-errors/step-errors";
import {
  DurableOperationError,
  StepError,
} from "../../errors/durable-error/durable-error";
import { defaultSerdes, type AnySerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { isUnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import type { DurableLogger } from "../../types/durable-logger";
import {
  type DurableInstrumentationPlugin,
  AttemptEndInfoOutcome,
  type CustomerFnResult,
  PluginOperationStatus,
} from "../../types/plugin";
import {
  toAttemptEndInfo,
  toAttemptInfo,
  backfillOperationInfo,
  toOperationInfo,
} from "../../utils/operation/operation";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import { TerminationReason } from "../../termination-manager/types";

export const createStepHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  _parentContext: Context,
  createStepId: () => string,
  logger: Logger,
  parentId?: string,
  getDefaultSerdes?: () => AnySerdes,
  plugin: DurableInstrumentationPlugin = {},
  // Plugin-only operation name; never checkpointed. Labels the STEP span.
  pluginOperationName?: string,
  // Passed to the step function as StepContext.signal.
  signal: AbortSignal = new AbortController().signal,
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
    // A custom subtype labels steps of a custom operation. It is typed as
    // OperationSubType, like ChildConfig.subType in the child context handler.
    const subType =
      (options?.subType as OperationSubType) || OperationSubType.STEP;
    const serdes =
      options?.serdes ||
      (getDefaultSerdes ? getDefaultSerdes() : defaultSerdes);

    // Phase 1: Execute step
    const phase1Promise = (async (): Promise<T> => {
      let stepData = context.getStepData(stepId);

      validateReplayConsistency(
        stepId,
        { type: OperationType.STEP, name, subType },
        stepData,
        context,
      );

      const opInfo = {
        id: hashId(stepId),
        name: pluginOperationName ?? name,
        type: OperationType.STEP,
        subType,
        parentId: parentId ? hashId(parentId) : undefined,
      };

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Step already completed:", { stepId });
        const result = stepData.StepDetails?.Result;
        return await completeAfter(
          checkpoint,
          stepId,
          () =>
            safeDeserialize(
              serdes,
              result,
              stepId,
              name,
              context.terminationManager,
              context.durableExecutionArn,
            ),
          { stepId, name, type: OperationType.STEP, subType, parentId },
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
              subType,
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
              subType,
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
            SubType: subType,
            Type: OperationType.STEP,
            Error: createErrorObjectFromError(error),
            Name: name,
          });
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.COMPLETED,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType,
                parentId,
              },
            },
          );
          throw DurableOperationError.fromErrorObject(
            createErrorObjectFromError(error),
          );
        }

        await checkpoint.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.RETRY,
          SubType: subType,
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
              subType,
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
              SubType: subType,
              Type: OperationType.STEP,
              Name: name,
            });
            stepData = context.getStepData(stepId);
            const operationInfo = toOperationInfo(stepData);
            backfillOperationInfo(operationInfo, opInfo);
            const isRetryAttempt = (stepData?.StepDetails?.Attempt || 0) >= 1;
            await plugin.onOperationStart?.({
              ...operationInfo,
              isReplay: isRetryAttempt,
            });
          } else {
            const isRetryAttempt = (stepData?.StepDetails?.Attempt || 0) >= 1;
            // Not awaited on purpose. checkpoint() does not reject: a failed batch terminates the invocation.
            void checkpoint.checkpoint(stepId, {
              Id: stepId,
              ParentId: parentId,
              Action: OperationAction.START,
              SubType: subType,
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
          }
        } else {
          const operationInfo = toOperationInfo(stepData);
          backfillOperationInfo(operationInfo, opInfo);
          await plugin.onOperationStart?.({ ...operationInfo, isReplay: true });
        }

        try {
          stepData = context.getStepData(stepId);
          const currentAttempt = (stepData?.StepDetails?.Attempt || 0) + 1;
          const stepContext: StepContext<Logger> = {
            logger,
            attempt: currentAttempt,
            signal,
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
                subType,
                parentId,
              },
            },
          );
          const attemptInfo = toAttemptInfo(stepData, currentAttempt);
          backfillOperationInfo(attemptInfo, opInfo);
          attemptInfo.startTimestamp = new Date();
          await plugin.onOperationAttemptStart?.(attemptInfo);
          const stepFn = (): Promise<T> => fn(stepContext);
          const wrapOperationAttemptFn = plugin.wrapOperationAttemptFn;
          const result = (await runWithContext(
            stepId,
            parentId,
            wrapOperationAttemptFn
              ? (): CustomerFnResult =>
                  wrapOperationAttemptFn.call(plugin, attemptInfo, stepFn)
              : stepFn,
            currentAttempt,
            DurableExecutionMode.ExecutionMode,
            name,
          )) as T;

          const serializedResult = await safeSerialize(
            serdes,
            result,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );

          const succeedCheckpoint = checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.SUCCEED,
            SubType: subType,
            Type: OperationType.STEP,
            Payload: serializedResult,
            Name: name,
          });
          const isAsync = semantics === StepSemantics.AtLeastOncePerRetryAsync;
          if (isAsync) {
            // Not awaited on purpose. checkpoint() does not reject: a failed batch terminates the
            // invocation. Every exit drains the queue, so the result is saved before the
            // invocation ends.
            void succeedCheckpoint;
          } else {
            await succeedCheckpoint;
          }
          stepData = context.getStepData(stepId);
          const attemptEndInfo = toAttemptEndInfo(
            stepData,
            AttemptEndInfoOutcome.SUCCEEDED,
            {
              attempt: currentAttempt,
            },
          );
          if (isAsync) {
            // The service has not answered yet, so stepData still shows the attempt as STARTED.
            attemptEndInfo.status = PluginOperationStatus.SUCCEEDED;
            attemptEndInfo.result = serializedResult;
            attemptEndInfo.endTimestamp = new Date();
          }
          backfillOperationInfo(attemptEndInfo, opInfo);
          await plugin.onOperationAttemptEnd?.(attemptEndInfo);
          await plugin.onOperationEnd?.({ ...attemptEndInfo, isReplay: false });

          // The step stays EXECUTING (marked above) until the result is deserialized.
          return await completeAfter(checkpoint, stepId, () =>
            safeDeserialize(
              serdes,
              serializedResult,
              stepId,
              name,
              context.terminationManager,
              context.durableExecutionArn,
            ),
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
              SubType: subType,
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
                error:
                  error instanceof Error ? error : new Error(String(error)),
              },
            );
            backfillOperationInfo(attemptEndInfo, opInfo);
            await plugin.onOperationAttemptEnd?.(attemptEndInfo);
            await plugin.onOperationEnd?.({
              ...attemptEndInfo,
              isReplay: false,
              error: error instanceof Error ? error : new Error(String(error)),
            });
            throw DurableOperationError.fromErrorObject(
              createErrorObjectFromError(error),
            );
          }

          const nextAttemptDelaySeconds = retryDecision.delay
            ? durationToSeconds(retryDecision.delay)
            : 1;
          // The RETRY checkpoint is awaited before the pause call. The queue sends START
          // no later than RETRY, so both are saved before the pause can take effect. If
          // the service answers RETRY without a token, or drops it for a finished
          // ancestor, this await never resolves and no pause is requested.
          await checkpoint.checkpoint(stepId, {
            Id: stepId,
            ParentId: parentId,
            Action: OperationAction.RETRY,
            SubType: subType,
            Type: OperationType.STEP,
            Error: createErrorObjectFromError(error),
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
              error: error instanceof Error ? error : new Error(String(error)),
            },
          );
          backfillOperationInfo(attemptEndInfo, opInfo);
          await plugin.onOperationAttemptEnd?.(attemptEndInfo);
          // Requested while the step is still EXECUTING, so the invocation cannot
          // suspend during the call.
          const paused =
            retryDecision.pause === true &&
            (await requestPause(currentAttempt));
          checkpoint.markOperationState(
            stepId,
            OperationLifecycleState.RETRY_WAITING,
            {
              metadata: {
                stepId,
                name,
                type: OperationType.STEP,
                subType,
                parentId,
              },
              endTimestamp:
                context.getStepData(stepId)?.StepDetails?.NextAttemptTimestamp,
            },
          );

          if (paused) {
            context.terminationManager.terminate({
              reason: TerminationReason.EXECUTION_PAUSED,
              message: `Execution paused after step ${name ?? hashId(stepId)} failed attempt ${currentAttempt}`,
            });
            return new Promise<T>(() => {});
          }

          await checkpoint.waitForRetryTimer(stepId);
          return await executeStepLogic();
        }

        /**
         * Asks the service to pause the execution. Returns whether the request succeeded.
         * A missing client method or a failed request leaves the normal retry in place.
         */
        async function requestPause(attempt: number): Promise<boolean> {
          const client = context.durableExecutionClient;
          if (!client.pauseExecution) {
            return false;
          }
          const hashedId = hashId(stepId);
          try {
            await client.pauseExecution({
              DurableExecutionArn: context.durableExecutionArn,
              // Stable across a re-run of this attempt, so the service can drop a repeat. The
              // execution ARN keeps it unique across executions. 64 hex characters.
              ClientToken: createHash("sha256")
                .update(
                  `pause:${context.durableExecutionArn}:${hashedId}:${attempt}`,
                )
                .digest("hex"),
              Reason: `Step "${name ?? hashedId}" failed attempt ${attempt}`,
            });
            return true;
          } catch (error) {
            const errorName = error instanceof Error ? error.name : undefined;
            const errorText =
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error);
            const cause =
              errorName === "ResourceConflictException"
                ? "The execution has closed (for example, stopped) or is already paused."
                : "One possible cause is that the execution role does not allow lambda:PauseDurableExecution. Another is an @aws-sdk/client-lambda older than 3.1171.0 in the bundle.";
            logger.warn(
              `Could not pause the execution after step "${name ?? hashedId}" failed attempt ${attempt}: ${errorText}. The step retries as usual. ${cause}`,
              error,
            );
            return false;
          }
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
