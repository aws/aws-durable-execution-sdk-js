import {
  ExecutionContext,
  StepFunc,
  StepConfig,
  RetryDecision,
  StepSemantics,
  OperationSubType,
  StepContext,
  Logger,
  DurablePromise,
} from "../../types";
import { durationToSeconds } from "../../utils/duration/duration";
import {
  terminate,
  terminateForUnrecoverableError,
} from "../../utils/termination-helper/termination-helper";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { retryPresets } from "../../utils/retry/retry-presets/retry-presets";
import { StepInterruptedError } from "../../errors/step-errors/step-errors";
import {
  DurableOperationError,
  StepError,
} from "../../errors/durable-error/durable-error";
import { TerminationReason } from "../../termination-manager/types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { EventEmitter } from "events";
import { isUnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";

// Special symbol to indicate that the main loop should continue
const CONTINUE_MAIN_LOOP = Symbol("CONTINUE_MAIN_LOOP");

const waitForContinuation = async (
  context: ExecutionContext,
  stepId: string,
  name: string | undefined,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  checkpoint: ReturnType<typeof createCheckpoint>,
  onAwaitedChange?: (callback: () => void) => void,
): Promise<void> => {
  const stepData = context.getStepData(stepId);

  // Check if there are any ongoing operations
  if (!hasRunningOperations()) {
    // No ongoing operations - safe to terminate
    return terminate(
      context,
      TerminationReason.RETRY_SCHEDULED,
      `Retry scheduled for ${name || stepId}`,
    );
  }

  // There are ongoing operations - wait before continuing
  await waitBeforeContinue({
    checkHasRunningOperations: true,
    checkStepStatus: true,
    checkTimer: true,
    scheduledEndTimestamp: stepData?.StepDetails?.NextAttemptTimestamp,
    stepId,
    context,
    hasRunningOperations,
    operationsEmitter: getOperationsEmitter(),
    checkpoint,
    onAwaitedChange,
  });

  // Return to let the main loop re-evaluate step status
};

/**
 * Creates a step handler for executing durable steps with two-phase execution.
 */
export const createStepHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  parentContext: Context,
  createStepId: () => string,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  addRunningOperation: (stepId: string) => void,
  removeRunningOperation: (stepId: string) => void,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId?: string,
) => {
  return <T>(
    nameOrFn: string | undefined | StepFunc<T>,
    fnOrOptions?: StepFunc<T> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): DurablePromise<T> => {
    let name: string | undefined;
    let fn: StepFunc<T>;
    let options: StepConfig<T> | undefined;

    if (typeof nameOrFn === "string" || nameOrFn === undefined) {
      name = nameOrFn;
      fn = fnOrOptions as StepFunc<T>;
      options = maybeOptions;
    } else {
      fn = nameOrFn;
      options = fnOrOptions as StepConfig<T>;
    }

    const stepId = createStepId();

    log("▶️", "Running step:", { stepId, name, options });

    // Two-phase execution: Phase 1 starts immediately, Phase 2 returns result when awaited
    let phase1Result: T | undefined;
    let phase1Error: unknown;
    let isAwaited = false;
    let waitingCallback: (() => void) | undefined;

    const setWaitingCallback = (cb: () => void): void => {
      waitingCallback = cb;
    };

    // Phase 1: Start execution immediately and capture result/error
    const phase1Promise = (async (): Promise<T> => {
      // Main step logic - can be re-executed if step status changes
      while (true) {
        try {
          const stepData = context.getStepData(stepId);

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
            return await handleCompletedStep<T>(
              context,
              stepId,
              name,
              options?.serdes,
            );
          }

          if (stepData?.Status === OperationStatus.FAILED) {
            // Return an async rejected promise to ensure it's handled asynchronously
            return (async (): Promise<T> => {
              // Reconstruct the original error from stored ErrorObject
              if (stepData.StepDetails?.Error) {
                throw DurableOperationError.fromErrorObject(
                  stepData.StepDetails.Error,
                );
              } else {
                // Fallback for legacy data without Error field
                const errorMessage = stepData?.StepDetails?.Result;
                throw new StepError(errorMessage || "Unknown error");
              }
            })();
          }

          // If PENDING, wait for timer to complete
          if (stepData?.Status === OperationStatus.PENDING) {
            await waitForContinuation(
              context,
              stepId,
              name,
              hasRunningOperations,
              getOperationsEmitter,
              checkpoint,
              isAwaited ? undefined : setWaitingCallback,
            );
            continue; // Re-evaluate step status after waiting
          }

          // Check for interrupted step with AT_MOST_ONCE_PER_RETRY semantics
          if (stepData?.Status === OperationStatus.STARTED) {
            const semantics =
              options?.semantics || StepSemantics.AtLeastOncePerRetry;
            if (semantics === StepSemantics.AtMostOncePerRetry) {
              log("⚠️", "Step was interrupted during execution:", {
                stepId,
                name,
              });
              const error = new StepInterruptedError(stepId, name);

              // Handle the interrupted step as a failure
              const currentAttempt = (stepData?.StepDetails?.Attempt || 0) + 1;
              let retryDecision: RetryDecision;

              if (options?.retryStrategy !== undefined) {
                retryDecision = options.retryStrategy(error, currentAttempt);
              } else {
                retryDecision = retryPresets.default(error, currentAttempt);
              }

              log("⚠️", "Should Retry Interrupted Step:", {
                stepId,
                name,
                currentAttempt,
                shouldRetry: retryDecision.shouldRetry,
                delayInSeconds: retryDecision.shouldRetry
                  ? retryDecision.delay
                    ? durationToSeconds(retryDecision.delay)
                    : undefined
                  : undefined,
              });

              if (!retryDecision.shouldRetry) {
                // No retry, mark as failed
                await checkpoint(stepId, {
                  Id: stepId,
                  ParentId: parentId,
                  Action: OperationAction.FAIL,
                  SubType: OperationSubType.STEP,
                  Type: OperationType.STEP,
                  Error: createErrorObjectFromError(error),
                  Name: name,
                });

                // Reconstruct error from ErrorObject for deterministic behavior
                const errorObject = createErrorObjectFromError(error);
                throw DurableOperationError.fromErrorObject(errorObject);
              } else {
                // Retry
                await checkpoint(stepId, {
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

                await waitForContinuation(
                  context,
                  stepId,
                  name,
                  hasRunningOperations,
                  getOperationsEmitter,
                  checkpoint,
                  isAwaited ? undefined : setWaitingCallback,
                );
                continue; // Re-evaluate step status after waiting
              }
            }
          }

          // Execute step function for READY, STARTED (AtLeastOncePerRetry), or first time (undefined)
          const result = await executeStep(
            context,
            checkpoint,
            stepId,
            name,
            fn,
            createContextLogger,
            addRunningOperation,
            removeRunningOperation,
            hasRunningOperations,
            getOperationsEmitter,
            parentId,
            options,
            isAwaited ? undefined : setWaitingCallback,
          );

          // If executeStep signals to continue the main loop, do so
          if (result === CONTINUE_MAIN_LOOP) {
            continue;
          }

          return result;
        } catch (error) {
          // Preserve DurableOperationError instances (StepInterruptedError is handled specifically where it's thrown)
          if (error instanceof DurableOperationError) {
            throw error;
          }

          // For any other error from executeStep, wrap it in StepError for consistency
          throw new StepError(
            error instanceof Error ? error.message : "Step failed",
            error instanceof Error ? error : undefined,
          );
        }
      }
    })()
      .then((result) => {
        phase1Result = result;
      })
      .catch((error) => {
        phase1Error = error;
      });

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    return new DurablePromise(async () => {
      // When promise is awaited, mark as awaited and invoke waiting callback
      isAwaited = true;
      if (waitingCallback) {
        waitingCallback();
      }

      await phase1Promise;
      if (phase1Error !== undefined) {
        throw phase1Error;
      }
      return phase1Result!;
    });
  };
};

export const handleCompletedStep = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes = defaultSerdes,
): Promise<T> => {
  log("⏭️", "Step already finished, returning cached result:", { stepId });

  const stepData = context.getStepData(stepId);
  const result = stepData?.StepDetails?.Result;

  return await safeDeserialize(
    serdes,
    result,
    stepId,
    stepName,
    context.terminationManager,

    context.durableExecutionArn,
  );
};

export const executeStep = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  stepId: string,
  name: string | undefined,
  fn: StepFunc<T>,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  addRunningOperation: (stepId: string) => void,
  removeRunningOperation: (stepId: string) => void,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId: string | undefined,
  options?: StepConfig<T>,
  onAwaitedChange?: ((callback: () => void) => void) | undefined,
): Promise<T | typeof CONTINUE_MAIN_LOOP> => {
  // Determine step semantics (default to AT_LEAST_ONCE_PER_RETRY if not specified)
  const semantics = options?.semantics || StepSemantics.AtLeastOncePerRetry;
  const serdes = options?.serdes || defaultSerdes;

  // Checkpoint at start for both semantics (only if not already started)
  const stepData = context.getStepData(stepId);
  if (stepData?.Status !== OperationStatus.STARTED) {
    if (semantics === StepSemantics.AtMostOncePerRetry) {
      // Wait for checkpoint to complete
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: parentId,
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: name,
      });
    } else {
      // Fire and forget for AtLeastOncePerRetry
      checkpoint(stepId, {
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
    // Get current attempt number for logger enrichment
    const stepData = context.getStepData(stepId);
    const currentAttempt = stepData?.StepDetails?.Attempt || 0;

    // Create step context with enriched logger
    const stepContext: StepContext = {
      logger: createContextLogger(stepId, currentAttempt),
    };

    // Execute the step function with stepContext
    addRunningOperation(stepId);
    let result: T;
    try {
      result = await runWithContext(stepId, parentId, () => fn(stepContext));
    } finally {
      removeRunningOperation(stepId);
    }

    // Serialize the result for consistency
    const serializedResult = await safeSerialize(
      serdes,
      result,
      stepId,
      name,
      context.terminationManager,

      context.durableExecutionArn,
    );

    // Always checkpoint on completion
    await checkpoint(stepId, {
      Id: stepId,
      ParentId: parentId,
      Action: OperationAction.SUCCEED,
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
      Payload: serializedResult,
      Name: name,
    });

    log("✅", "Step completed successfully:", {
      stepId,
      name,
      result,
      semantics,
    });

    // Deserialize the result for consistency with replay behavior
    return await safeDeserialize(
      serdes,
      serializedResult,
      stepId,
      name,
      context.terminationManager,

      context.durableExecutionArn,
    );
  } catch (error) {
    log("❌", "Step failed:", {
      stepId,
      name,
      error,
      semantics,
    });

    // Handle unrecoverable errors - these should not go through retry logic
    if (isUnrecoverableError(error)) {
      log("💥", "Unrecoverable error detected:", {
        stepId,
        name,
        error: error.message,
      });

      return terminateForUnrecoverableError(context, error, name || stepId);
    }

    const stepData = context.getStepData(stepId);
    const currentAttempt = (stepData?.StepDetails?.Attempt || 0) + 1;
    let retryDecision: RetryDecision;

    if (options?.retryStrategy !== undefined) {
      // Use provided retry configuration
      retryDecision = options.retryStrategy(
        error instanceof Error ? error : new Error("Unknown Error"),
        currentAttempt,
      );
    } else {
      // Use default retry preset if no config provided
      retryDecision = retryPresets.default(
        error instanceof Error ? error : new Error("Unknown Error"),
        currentAttempt,
      );
    }

    log("⚠️", "Should Retry:", {
      stepId,
      name,
      currentAttempt,
      shouldRetry: retryDecision.shouldRetry,
      delayInSeconds: retryDecision.shouldRetry
        ? retryDecision.delay
          ? durationToSeconds(retryDecision.delay)
          : undefined
        : undefined,
      semantics,
    });

    if (!retryDecision.shouldRetry) {
      // No retry
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: parentId,
        Action: OperationAction.FAIL,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Error: createErrorObjectFromError(error),
        Name: name,
      });

      // Reconstruct error from ErrorObject for deterministic behavior
      const errorObject = createErrorObjectFromError(error);
      throw DurableOperationError.fromErrorObject(errorObject);
    } else {
      // Retry
      await checkpoint(stepId, {
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

      // Wait for continuation and signal main loop to continue
      await waitForContinuation(
        context,
        stepId,
        name,
        hasRunningOperations,
        getOperationsEmitter,
        checkpoint,
        onAwaitedChange,
      );
      return CONTINUE_MAIN_LOOP;
    }
  }
};
