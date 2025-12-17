import {
  ExecutionContext,
  ChildFunc,
  ChildConfig,
  OperationSubType,
  DurableExecutionMode,
  DurableContext,
} from "../../types";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import {
  DurableOperationError,
  ChildContextError,
} from "../../errors/durable-error/durable-error";
import { runWithContext } from "../../utils/context-tracker/context-tracker";
import { DurablePromise } from "../../types/durable-promise";
import { DurableLogger } from "../../types/durable-logger";

// Checkpoint size limit in bytes (256KB)
const CHECKPOINT_SIZE_LIMIT = 256 * 1024;

export const determineChildReplayMode = (
  context: ExecutionContext,
  stepId: string,
): DurableExecutionMode => {
  const stepData = context.getStepData(stepId);

  if (!stepData) {
    return DurableExecutionMode.ExecutionMode;
  }

  if (
    stepData.Status === OperationStatus.SUCCEEDED &&
    stepData.ContextDetails?.ReplayChildren
  ) {
    return DurableExecutionMode.ReplaySucceededContext;
  }

  if (
    stepData.Status === OperationStatus.SUCCEEDED ||
    stepData.Status === OperationStatus.FAILED
  ) {
    return DurableExecutionMode.ReplayMode;
  }

  return DurableExecutionMode.ExecutionMode;
};

export const createRunInChildContextHandler = <Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  parentContext: Context,
  createStepId: () => string,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    inheritedLogger: Logger,
    stepPrefix?: string,
    checkpointToken?: string,
    parentId?: string,
  ) => DurableContext<Logger>,
  parentId?: string,
) => {
  return <T>(
    nameOrFn: string | undefined | ChildFunc<T, Logger>,
    fnOrOptions?: ChildFunc<T, Logger> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ): DurablePromise<T> => {
    let name: string | undefined;
    let fn: ChildFunc<T, Logger>;
    let options: ChildConfig<T> | undefined;

    if (typeof nameOrFn === "string" || nameOrFn === undefined) {
      name = nameOrFn;
      fn = fnOrOptions as ChildFunc<T, Logger>;
      options = maybeOptions;
    } else {
      fn = nameOrFn;
      options = fnOrOptions as ChildConfig<T>;
    }

    const entityId = createStepId();

    log("🔄", "Running child context:", {
      entityId,
      name,
    });

    const stepData = context.getStepData(entityId);

    // Validate replay consistency
    validateReplayConsistency(
      entityId,
      {
        type: OperationType.CONTEXT,
        name,
        subType:
          (options?.subType as OperationSubType) ||
          OperationSubType.RUN_IN_CHILD_CONTEXT,
      },
      stepData,
      context,
    );

    // Two-phase execution: Phase 1 starts immediately, Phase 2 returns result when awaited
    let phase1Result: T | undefined;
    let phase1Error: unknown;

    // Phase 1: Start execution immediately and capture result/error
    const phase1Promise = (async (): Promise<T> => {
      const currentStepData = context.getStepData(entityId);

      // If already completed, return cached result
      if (
        currentStepData?.Status === OperationStatus.SUCCEEDED ||
        currentStepData?.Status === OperationStatus.FAILED
      ) {
        // Mark this run-in-child-context as finished to prevent descendant operations
        checkpoint.markAncestorFinished(entityId);

        return handleCompletedChildContext(
          context,
          parentContext,
          entityId,
          name,
          fn,
          options,
          getParentLogger,
          createChildContext,
        );
      }

      // Execute if not completed
      return executeChildContext(
        context,
        checkpoint,
        parentContext,
        entityId,
        name,
        fn,
        options,
        getParentLogger,
        createChildContext,
        parentId,
      );
    })()
      .then((result) => {
        phase1Result = result;
      })
      .catch((error) => {
        phase1Error = error;
      });

    // Phase 2: Return DurablePromise that returns Phase 1 result when awaited
    return new DurablePromise(async () => {
      await phase1Promise;
      if (phase1Error !== undefined) {
        throw phase1Error;
      }
      return phase1Result!;
    });
  };
};

export const handleCompletedChildContext = async <
  T,
  Logger extends DurableLogger,
>(
  context: ExecutionContext,
  parentContext: Context,
  entityId: string,
  stepName: string | undefined,
  fn: ChildFunc<T, Logger>,
  options: ChildConfig<T> | undefined,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    logger: Logger,
    entityId: string,
    checkpointToken: string | undefined,
    parentId?: string,
  ) => DurableContext<Logger>,
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;
  const stepData = context.getStepData(entityId);
  const result = stepData?.ContextDetails?.Result;

  // Handle failed child context
  if (stepData?.Status === OperationStatus.FAILED) {
    if (stepData.ContextDetails?.Error) {
      const originalError = DurableOperationError.fromErrorObject(
        stepData.ContextDetails.Error,
      );
      throw new ChildContextError(originalError.message, originalError);
    } else {
      throw new ChildContextError("Child context failed");
    }
  }

  // Check if we need to replay children due to large payload
  if (stepData?.ContextDetails?.ReplayChildren) {
    log(
      "🔄",
      "ReplayChildren mode: Re-executing child context due to large payload:",
      { entityId, stepName },
    );

    // Re-execute the child context to reconstruct the result
    const durableChildContext = createChildContext(
      context,
      parentContext,
      DurableExecutionMode.ReplaySucceededContext,
      getParentLogger(),
      entityId,
      undefined,
      entityId, // parentId
    );

    return await runWithContext(entityId, entityId, () =>
      fn(durableChildContext),
    );
  }

  log("⏭️", "Child context already finished, returning cached result:", {
    entityId,
  });

  return await safeDeserialize(
    serdes,
    result,
    entityId,
    stepName,
    context.terminationManager,
    context.durableExecutionArn,
  );
};

export const executeChildContext = async <T, Logger extends DurableLogger>(
  context: ExecutionContext,
  checkpoint: Checkpoint,
  parentContext: Context,
  entityId: string,
  name: string | undefined,
  fn: ChildFunc<T, Logger>,
  options: ChildConfig<T> | undefined,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    logger: Logger,
    entityId: string,
    checkpointToken: string | undefined,
    parentId?: string,
  ) => DurableContext<Logger>,
  parentId?: string,
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;

  // Checkpoint at start if not already started (fire-and-forget for performance)
  if (context.getStepData(entityId) === undefined) {
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint.checkpoint(entityId, {
      Id: entityId,
      ParentId: parentId,
      Action: OperationAction.START,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Name: name,
    });
  }

  const childReplayMode = determineChildReplayMode(context, entityId);
  // Create a child context with the entity ID as prefix
  const durableChildContext = createChildContext(
    context,
    parentContext,
    childReplayMode,
    getParentLogger(),
    entityId,
    undefined,
    entityId, // parentId
  );

  try {
    // Execute the child context function with context tracking
    const result = await runWithContext(
      entityId,
      parentId,
      () => fn(durableChildContext),
      undefined,
      childReplayMode,
    );

    // Serialize the result for consistency
    const serializedResult = await safeSerialize(
      serdes,
      result,
      entityId,
      name,
      context.terminationManager,
      context.durableExecutionArn,
    );

    // Check if payload is too large for adaptive mode
    let payloadToCheckpoint = serializedResult;
    let replayChildren = false;

    if (
      serializedResult &&
      Buffer.byteLength(serializedResult, "utf8") > CHECKPOINT_SIZE_LIMIT
    ) {
      replayChildren = true;

      // Use summary generator if provided, otherwise use empty string
      if (options?.summaryGenerator) {
        payloadToCheckpoint = options.summaryGenerator(result);
      } else {
        payloadToCheckpoint = "";
      }

      log("📦", "Large payload detected, using ReplayChildren mode:", {
        entityId,
        name,
        payloadSize: Buffer.byteLength(serializedResult, "utf8"),
        limit: CHECKPOINT_SIZE_LIMIT,
      });
    }

    // Mark this run-in-child-context as finished to prevent descendant operations
    checkpoint.markAncestorFinished(entityId);

    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint.checkpoint(entityId, {
      Id: entityId,
      ParentId: parentId,
      Action: OperationAction.SUCCEED,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Payload: payloadToCheckpoint,
      ContextOptions: replayChildren ? { ReplayChildren: true } : undefined,
      Name: name,
    });

    log("✅", "Child context completed successfully:", {
      entityId,
      name,
    });

    return result;
  } catch (error) {
    log("❌", "Child context failed:", {
      entityId,
      name,
      error,
    });

    // Mark this run-in-child-context as finished to prevent descendant operations
    checkpoint.markAncestorFinished(entityId);

    // Always checkpoint failures
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint.checkpoint(entityId, {
      Id: entityId,
      ParentId: parentId,
      Action: OperationAction.FAIL,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Error: createErrorObjectFromError(error),
      Name: name,
    });

    // Reconstruct error from ErrorObject for deterministic behavior
    const errorObject = createErrorObjectFromError(error);
    const reconstructedError =
      DurableOperationError.fromErrorObject(errorObject);
    throw new ChildContextError(reconstructedError.message, reconstructedError);
  }
};
