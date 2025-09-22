import {
  ExecutionContext,
  StepFunc,
  StepConfig,
  RetryDecision,
  StepSemantics,
  OperationSubType,
  StepContext,
  Logger,
} from "../../types";
import {
  terminate,
  terminateForUnrecoverableError,
} from "../../utils/termination-helper";
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
import { TerminationReason } from "../../termination-manager/types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { isUnrecoverableError } from "../../errors/unrecoverable-error/unrecoverable-error";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";

// Special symbol to indicate that the main loop should continue
const CONTINUE_MAIN_LOOP = Symbol("CONTINUE_MAIN_LOOP");

const waitForContinuation = async (
  context: ExecutionContext,
  stepId: string,
  name: string | undefined,
  hasRunningOperations: () => boolean,
  checkpoint: ReturnType<typeof createCheckpoint>,
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
    scheduledTimestamp: stepData?.StepDetails?.NextAttemptTimestamp,
    stepId,
    context,
    hasRunningOperations,
    checkpoint,
  });

  // Return to let the main loop re-evaluate step status
};

export const createStepHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  parentContext: Context,
  createStepId: () => string,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  addRunningOperation: (stepId: string) => void,
  removeRunningOperation: (stepId: string) => void,
  hasRunningOperations: () => boolean,
) => {
  return async <T>(
    nameOrFn: string | undefined | StepFunc<T>,
    fnOrOptions?: StepFunc<T> | StepConfig<T>,
    maybeOptions?: StepConfig<T>,
  ): Promise<T> => {
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

    log(context.isVerbose, "▶️", "Running step:", { stepId, name, options });

    // Main step logic - can be re-executed if step status changes
    while (true) {
      try {
        const stepData = context.getStepData(stepId);

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          return await handleCompletedStep<T>(
            context,
            stepId,
            name,
            options?.serdes,
          );
        }

        if (stepData?.Status === OperationStatus.FAILED) {
          const errorMessage = stepData?.StepDetails?.Result;
          throw new Error(errorMessage || "Unknown error");
        }

        // If PENDING, wait for timer to complete
        if (stepData?.Status === OperationStatus.PENDING) {
          await waitForContinuation(
            context,
            stepId,
            name,
            hasRunningOperations,
            checkpoint,
          );
          continue; // Re-evaluate step status after waiting
        }

        // Check for interrupted step with AT_MOST_ONCE_PER_RETRY semantics
        if (stepData?.Status === OperationStatus.STARTED) {
          const semantics =
            options?.semantics || StepSemantics.AtLeastOncePerRetry;
          if (semantics === StepSemantics.AtMostOncePerRetry) {
            log(
              context.isVerbose,
              "⚠️",
              "Step was interrupted during execution:",
              {
                stepId,
                name,
              },
            );
            const error = new StepInterruptedError(stepId, name);

            // Handle the interrupted step as a failure
            const currentAttempt = (stepData?.StepDetails?.Attempt || 0) + 1;
            let retryDecision: RetryDecision;

            if (options?.retryStrategy !== undefined) {
              retryDecision = options.retryStrategy(error, currentAttempt);
            } else {
              retryDecision = retryPresets.default(error, currentAttempt);
            }

            log(context.isVerbose, "⚠️", "Should Retry Interrupted Step:", {
              stepId,
              name,
              currentAttempt,
              shouldRetry: retryDecision.shouldRetry,
              delaySeconds: retryDecision.shouldRetry
                ? retryDecision.delaySeconds
                : undefined,
            });

            if (!retryDecision.shouldRetry) {
              // No retry, mark as failed
              await checkpoint(stepId, {
                Id: stepId,
                ParentId: context.parentId,
                Action: OperationAction.FAIL,
                SubType: OperationSubType.STEP,
                Type: OperationType.STEP,
                Error: createErrorObjectFromError(error),
                Name: name,
              });

              throw error;
            } else {
              // Retry
              await checkpoint(stepId, {
                Id: stepId,
                ParentId: context.parentId,
                Action: OperationAction.RETRY,
                SubType: OperationSubType.STEP,
                Type: OperationType.STEP,
                Error: createErrorObjectFromError(error),
                Name: name,
                StepOptions: {
                  NextAttemptDelaySeconds: retryDecision.delaySeconds,
                },
              });

              await waitForContinuation(
                context,
                stepId,
                name,
                hasRunningOperations,
                checkpoint,
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
          options,
        );

        // If executeStep signals to continue the main loop, do so
        if (result === CONTINUE_MAIN_LOOP) {
          continue;
        }

        return result;
      } catch (error) {
        // For any error from executeStep, re-throw it
        throw error;
      }
    }
  };
};

export const handleCompletedStep = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes = defaultSerdes,
): Promise<T> => {
  log(
    context.isVerbose,
    "⏭️",
    "Step already finished, returning cached result:",
    { stepId },
  );

  const stepData = context.getStepData(stepId);
  const result = stepData?.StepDetails?.Result;

  return await safeDeserialize(
    serdes,
    result,
    stepId,
    stepName,
    context.terminationManager,
    context.isVerbose,
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
  options?: StepConfig<T>,
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
        ParentId: context.parentId,
        Action: OperationAction.START,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Name: name,
      });
    } else {
      // Fire and forget for AtLeastOncePerRetry
      checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
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
      result = await OperationInterceptor.forExecution(
        context.durableExecutionArn,
      ).execute(name, () => fn(stepContext));
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
      context.isVerbose,
      context.durableExecutionArn,
    );

    // Always checkpoint on completion
    await checkpoint(stepId, {
      Id: stepId,
      ParentId: context.parentId,
      Action: OperationAction.SUCCEED,
      SubType: OperationSubType.STEP,
      Type: OperationType.STEP,
      Payload: serializedResult,
      Name: name,
    });

    log(context.isVerbose, "✅", "Step completed successfully:", {
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
      context.isVerbose,
      context.durableExecutionArn,
    );
  } catch (error) {
    log(context.isVerbose, "❌", "Step failed:", {
      stepId,
      name,
      error,
      semantics,
    });

    // Handle unrecoverable errors - these should not go through retry logic
    if (isUnrecoverableError(error)) {
      log(context.isVerbose, "💥", "Unrecoverable error detected:", {
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

    log(context.isVerbose, "⚠️", "Should Retry:", {
      stepId,
      name,
      currentAttempt,
      shouldRetry: retryDecision.shouldRetry,
      delaySeconds: retryDecision.shouldRetry
        ? retryDecision.delaySeconds
        : undefined,
      semantics,
    });

    if (!retryDecision.shouldRetry) {
      // No retry
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
        Action: OperationAction.FAIL,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Error: createErrorObjectFromError(error),
        Name: name,
      });

      throw error;
    } else {
      // Retry
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
        Action: OperationAction.RETRY,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
        Error: createErrorObjectFromError(error),
        Name: name,
        StepOptions: {
          NextAttemptDelaySeconds: retryDecision.delaySeconds,
        },
      });

      // Wait for continuation and signal main loop to continue
      await waitForContinuation(
        context,
        stepId,
        name,
        hasRunningOperations,
        checkpoint,
      );
      return CONTINUE_MAIN_LOOP;
    }
  }
};
