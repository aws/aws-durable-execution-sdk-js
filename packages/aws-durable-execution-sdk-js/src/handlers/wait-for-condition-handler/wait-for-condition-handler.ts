import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  WaitForConditionDecision,
  OperationSubType,
  WaitForConditionContext,
  Logger,
} from "../../types";
import { durationToSeconds } from "../../utils/duration/duration";
import { terminate } from "../../utils/termination-helper/termination-helper";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { EventEmitter } from "events";

// Special symbol to indicate that the main loop should continue
const CONTINUE_MAIN_LOOP = Symbol("CONTINUE_MAIN_LOOP");

const waitForContinuation = async (
  context: ExecutionContext,
  stepId: string,
  name: string | undefined,
  hasRunningOperations: () => boolean,
  checkpoint: ReturnType<typeof createCheckpoint>,
  operationsEmitter: EventEmitter,
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
    operationsEmitter,
    checkpoint,
  });

  // Return to let the main loop re-evaluate step status
};

export const createWaitForConditionHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  addRunningOperation: (stepId: string) => void,
  removeRunningOperation: (stepId: string) => void,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId: string | undefined,
) => {
  return async <T>(
    nameOrCheck: string | undefined | WaitForConditionCheckFunc<T>,
    checkOrConfig?: WaitForConditionCheckFunc<T> | WaitForConditionConfig<T>,
    maybeConfig?: WaitForConditionConfig<T>,
  ): Promise<T> => {
    let name: string | undefined;
    let check: WaitForConditionCheckFunc<T>;
    let config: WaitForConditionConfig<T>;

    // Parse overloaded parameters
    if (typeof nameOrCheck === "string" || nameOrCheck === undefined) {
      name = nameOrCheck;
      check = checkOrConfig as WaitForConditionCheckFunc<T>;
      config = maybeConfig as WaitForConditionConfig<T>;
    } else {
      check = nameOrCheck;
      config = checkOrConfig as WaitForConditionConfig<T>;
    }

    if (!config || !config.waitStrategy || config.initialState === undefined) {
      throw new Error(
        "waitForCondition requires config with waitStrategy and initialState",
      );
    }

    const stepId = createStepId();

    log("🔄", "Running waitForCondition:", {
      stepId,
      name,
      config,
    });

    // Main waitForCondition logic - can be re-executed if step status changes
    while (true) {
      try {
        const stepData = context.getStepData(stepId);

        // Check if already completed
        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          return await handleCompletedWaitForCondition<T>(
            context,
            stepId,
            name,
            config.serdes,
          );
        }

        if (stepData?.Status === OperationStatus.FAILED) {
          const errorMessage = stepData?.StepDetails?.Result;
          // Return async rejected promise to ensure it's handled asynchronously
          return (async (): Promise<T> => {
            throw new Error(errorMessage || "waitForCondition failed");
          })();
        }

        // If PENDING, wait for timer to complete
        if (stepData?.Status === OperationStatus.PENDING) {
          await waitForContinuation(
            context,
            stepId,
            name,
            hasRunningOperations,
            checkpoint,
            getOperationsEmitter(),
          );
          continue; // Re-evaluate step status after waiting
        }

        // Execute check function for READY, STARTED, or first time (undefined)
        const result = await executeWaitForCondition(
          context,
          checkpoint,
          stepId,
          name,
          check,
          config,
          createContextLogger,
          addRunningOperation,
          removeRunningOperation,
          hasRunningOperations,
          getOperationsEmitter,
          parentId,
        );

        // If executeWaitForCondition signals to continue the main loop, do so
        if (result === CONTINUE_MAIN_LOOP) {
          continue;
        }

        return result;
      } catch (error) {
        // For any error from executeWaitForCondition, re-throw it
        throw error;
      }
    }
  };
};

export const handleCompletedWaitForCondition = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes = defaultSerdes,
): Promise<T> => {
  log("⏭️", "waitForCondition already finished, returning cached result:", {
    stepId,
  });

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

export const executeWaitForCondition = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  stepId: string,
  name: string | undefined,
  check: WaitForConditionCheckFunc<T>,
  config: WaitForConditionConfig<T>,
  createContextLogger: (stepId: string, attempt?: number) => Logger,
  addRunningOperation: (stepId: string) => void,
  removeRunningOperation: (stepId: string) => void,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId: string | undefined,
): Promise<T | typeof CONTINUE_MAIN_LOOP> => {
  const serdes = config.serdes || defaultSerdes;

  // Get current state from previous checkpoint or use initial state
  let currentState: T;

  const existingOperation = context.getStepData(stepId);
  if (
    existingOperation?.Status === OperationStatus.STARTED ||
    existingOperation?.Status === OperationStatus.READY
  ) {
    // This is a retry - get state from previous checkpoint
    const checkpointData = existingOperation.StepDetails?.Result;
    if (checkpointData) {
      try {
        // Try to deserialize the checkpoint data directly
        const serdesContext = {
          entityId: stepId,
          durableExecutionArn: context.durableExecutionArn,
        };
        currentState = await serdes.deserialize(checkpointData, serdesContext);
      } catch (error) {
        log(
          "⚠️",
          "Failed to deserialize checkpoint data, using initial state:",
          {
            stepId,
            name,
            error,
          },
        );
        currentState = config.initialState;
      }
    } else {
      currentState = config.initialState;
    }
  } else {
    // First execution
    currentState = config.initialState;
  }

  // Get the current attempt number (1-based for wait strategy consistency)
  const currentAttempt = existingOperation?.StepDetails?.Attempt || 1;

  // Checkpoint START for observability (fire and forget) - only if not already started
  const stepData = context.getStepData(stepId);
  if (stepData?.Status !== OperationStatus.STARTED) {
    checkpoint(stepId, {
      Id: stepId,
      ParentId: parentId,
      Action: OperationAction.START,
      SubType: OperationSubType.WAIT_FOR_CONDITION,
      Type: OperationType.STEP,
      Name: name,
    });
  }

  try {
    // Create WaitForConditionContext with enriched logger for the check function
    const waitForConditionContext: WaitForConditionContext = {
      logger: createContextLogger(stepId, currentAttempt),
    };

    // Execute the check function
    addRunningOperation(stepId);
    let newState: T;
    try {
      newState = await check(currentState, waitForConditionContext);
    } finally {
      removeRunningOperation(stepId);
    }

    // Serialize the new state for consistency
    const serializedState = await safeSerialize(
      serdes,
      newState,
      stepId,
      name,
      context.terminationManager,

      context.durableExecutionArn,
    );

    // Deserialize for consistency with replay behavior
    const deserializedState = await safeDeserialize(
      serdes,
      serializedState,
      stepId,
      name,
      context.terminationManager,

      context.durableExecutionArn,
    );

    // Check if condition is met using the wait strategy
    const decision: WaitForConditionDecision = config.waitStrategy(
      deserializedState,
      currentAttempt,
    );

    log("🔍", "waitForCondition check completed:", {
      stepId,
      name,
      currentAttempt: currentAttempt,
      shouldContinue: decision.shouldContinue,
      delaySeconds: decision.shouldContinue
        ? durationToSeconds(decision.delay)
        : undefined,
    });

    if (!decision.shouldContinue) {
      // Condition is met - complete successfully
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: parentId,
        Action: OperationAction.SUCCEED,
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: serializedState,
        Name: name,
      });

      log("✅", "waitForCondition completed successfully:", {
        stepId,
        name,
        result: deserializedState,
        totalAttempts: currentAttempt,
      });

      return deserializedState;
    } else {
      // Condition not met - schedule retry
      // Only checkpoint the state, not the attempt number (system handles that)
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: parentId,
        Action: OperationAction.RETRY,
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: serializedState, // Just the state, not wrapped in an object
        Name: name,
        StepOptions: {
          NextAttemptDelaySeconds: durationToSeconds(decision.delay),
        },
      });

      // Wait for continuation and signal main loop to continue
      await waitForContinuation(
        context,
        stepId,
        name,
        hasRunningOperations,
        checkpoint,
        getOperationsEmitter(),
      );
      return CONTINUE_MAIN_LOOP;
    }
  } catch (error) {
    log("❌", "waitForCondition check function failed:", {
      stepId,
      name,
      error,
      currentAttempt: currentAttempt,
    });

    // Mark as failed - waitForCondition doesn't have its own retry logic for errors
    // If the check function throws, it's considered a failure
    await checkpoint(stepId, {
      Id: stepId,
      ParentId: parentId,
      Action: OperationAction.FAIL,
      SubType: OperationSubType.WAIT_FOR_CONDITION,
      Type: OperationType.STEP,
      Error: createErrorObjectFromError(error),
      Name: name,
    });

    throw error;
  }
};
