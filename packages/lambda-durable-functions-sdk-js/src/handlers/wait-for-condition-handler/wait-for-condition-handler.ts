import {
  ExecutionContext,
  WaitForConditionCheckFunc,
  WaitForConditionConfig,
  WaitForConditionDecision,
  OperationSubType,
  Telemetry,
} from "../../types";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@amzn/dex-internal-sdk";
import { log } from "../../utils/logger/logger";
import { createStructuredLogger } from "../../utils/logger/structured-logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

export const createWaitForConditionHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
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

    log(context.isVerbose, "🔄", "Running waitForCondition:", {
      stepId,
      name,
      config,
    });

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
      throw new Error(errorMessage || "waitForCondition failed");
    }

    return executeWaitForCondition(
      context,
      checkpoint,
      stepId,
      name,
      check,
      config,
    );
  };
};

export const handleCompletedWaitForCondition = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes = defaultSerdes,
): Promise<T> => {
  log(
    context.isVerbose,
    "⏭️",
    "waitForCondition already finished, returning cached result:",
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

export const executeWaitForCondition = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  stepId: string,
  name: string | undefined,
  check: WaitForConditionCheckFunc<T>,
  config: WaitForConditionConfig<T>,
): Promise<T> => {
  const serdes = config.serdes || defaultSerdes;

  // Get current state from previous checkpoint or use initial state
  let currentState: T;

  const existingOperation = context.getStepData(stepId);
  if (existingOperation?.Status === OperationStatus.STARTED) {
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
          context.isVerbose,
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

  // Get the current attempt number from the system (like step-handler does)
  const currentAttemptForLogging = existingOperation?.StepDetails?.Attempt || 0;
  const currentAttemptForWaitStrategy =
    existingOperation?.StepDetails?.Attempt || 1;

  try {
    // Create Telemetry with logger for the check function
    const logger = createStructuredLogger({
      executionId: context.durableExecutionArn,
      stepId,
      attempt: currentAttemptForLogging,
    });
    const telemetry: Telemetry = { logger };

    // Execute the check function
    const newState = await OperationInterceptor.forExecution(
      context.durableExecutionArn,
    ).execute(name, () => check(currentState, telemetry));

    // Serialize the new state for consistency
    const serializedState = await safeSerialize(
      serdes,
      newState,
      stepId,
      name,
      context.terminationManager,
      context.isVerbose,
      context.durableExecutionArn,
    );

    // Deserialize for consistency with replay behavior
    const deserializedState = await safeDeserialize(
      serdes,
      serializedState,
      stepId,
      name,
      context.terminationManager,
      context.isVerbose,
      context.durableExecutionArn,
    );

    // Check if condition is met using the wait strategy
    const decision: WaitForConditionDecision = config.waitStrategy(
      deserializedState,
      currentAttemptForWaitStrategy,
    );

    log(context.isVerbose, "🔍", "waitForCondition check completed:", {
      stepId,
      name,
      currentAttempt: currentAttemptForWaitStrategy,
      shouldContinue: decision.shouldContinue,
      delaySeconds: decision.shouldContinue ? decision.delaySeconds : undefined,
    });

    if (!decision.shouldContinue) {
      // Condition is met - complete successfully
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
        Action: "SUCCEED",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: serializedState,
        Name: name,
      });

      log(context.isVerbose, "✅", "waitForCondition completed successfully:", {
        stepId,
        name,
        result: deserializedState,
        totalAttempts: currentAttemptForWaitStrategy,
      });

      return deserializedState;
    } else {
      // Condition not met - schedule retry
      // Only checkpoint the state, not the attempt number (system handles that)
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
        Action: "RETRY",
        SubType: OperationSubType.WAIT_FOR_CONDITION,
        Type: OperationType.STEP,
        Payload: serializedState, // Just the state, not wrapped in an object
        Name: name,
        StepOptions: {
          NextAttemptDelaySeconds: decision.delaySeconds,
        },
      });

      context.terminationManager.terminate({
        reason: TerminationReason.RETRY_SCHEDULED,
        message: `waitForCondition ${name || stepId} will retry in ${decision.delaySeconds} seconds`,
      });

      // Return a never-resolving promise to ensure the execution doesn't continue
      return new Promise<T>(() => {});
    }
  } catch (error) {
    log(context.isVerbose, "❌", "waitForCondition check function failed:", {
      stepId,
      name,
      error,
      currentAttempt: currentAttemptForWaitStrategy,
    });

    // Mark as failed - waitForCondition doesn't have its own retry logic for errors
    // If the check function throws, it's considered a failure
    await checkpoint(stepId, {
      Id: stepId,
      ParentId: context.parentId,
      Action: OperationAction.FAIL,
      SubType: OperationSubType.WAIT_FOR_CONDITION,
      Type: OperationType.STEP,
      Error: createErrorObjectFromError(error),
      Name: name,
    });

    throw error;
  }
};
