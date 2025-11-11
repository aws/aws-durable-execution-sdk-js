import {
  ExecutionContext,
  ChildFunc,
  ChildConfig,
  OperationSubType,
  DurableExecutionMode,
  Logger,
  DurableContext,
} from "../../types";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
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

export const createRunInChildContextHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  parentContext: Context,
  createStepId: () => string,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    stepPrefix?: string,
    checkpointToken?: string,
    inheritedLogger?: Logger | null,
    parentId?: string,
  ) => DurableContext,
  parentId?: string,
) => {
  return async <T>(
    nameOrFn: string | undefined | ChildFunc<T>,
    fnOrOptions?: ChildFunc<T> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ): Promise<T> => {
    let name: string | undefined;
    let fn: ChildFunc<T>;
    let options: ChildConfig<T> | undefined;

    if (typeof nameOrFn === "string" || nameOrFn === undefined) {
      name = nameOrFn;
      fn = fnOrOptions as ChildFunc<T>;
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

    // Check if this child context has already completed
    if (stepData?.Status === OperationStatus.SUCCEEDED) {
      return handleCompletedChildContext<T>(
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

    if (stepData?.Status === OperationStatus.FAILED) {
      // Return an async rejected promise to ensure it's handled asynchronously
      return (async (): Promise<T> => {
        // Reconstruct the original error and wrap in ChildContextError for consistency
        if (stepData.ContextDetails?.Error) {
          const originalError = DurableOperationError.fromErrorObject(
            stepData.ContextDetails.Error,
          );
          throw new ChildContextError(originalError.message, originalError);
        } else {
          // Fallback for legacy data without Error field
          throw new ChildContextError("Child context failed");
        }
      })();
    }

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
  };
};

export const handleCompletedChildContext = async <T>(
  context: ExecutionContext,
  parentContext: Context,
  entityId: string,
  stepName: string | undefined,
  fn: ChildFunc<T>,
  options: ChildConfig<T> | undefined,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    entityId: string,
    checkpointToken: string | undefined,
    logger: Logger,
    parentId?: string,
  ) => DurableContext,
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;
  const stepData = context.getStepData(entityId);
  const result = stepData?.ContextDetails?.Result;

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
      entityId,
      undefined,
      getParentLogger(),
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

export const executeChildContext = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  parentContext: Context,
  entityId: string,
  name: string | undefined,
  fn: ChildFunc<T>,
  options: ChildConfig<T> | undefined,
  getParentLogger: () => Logger,
  createChildContext: (
    executionContext: ExecutionContext,
    parentContext: Context,
    durableExecutionMode: DurableExecutionMode,
    entityId: string,
    checkpointToken: string | undefined,
    logger: Logger,
    parentId?: string,
  ) => DurableContext,
  parentId?: string,
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;

  // Checkpoint at start if not already started (fire-and-forget for performance)
  if (context.getStepData(entityId) === undefined) {
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint(entityId, {
      Id: entityId,
      ParentId: parentId,
      Action: OperationAction.START,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Name: name,
    });
  }

  // Create a child context with the entity ID as prefix
  const durableChildContext = createChildContext(
    context,
    parentContext,
    determineChildReplayMode(context, entityId),
    entityId,
    undefined,
    getParentLogger(),
    entityId, // parentId
  );

  try {
    // Execute the child context function with context tracking
    const result = await runWithContext(entityId, parentId, () =>
      fn(durableChildContext),
    );

    // Always checkpoint at finish with adaptive mode
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

    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    await checkpoint(entityId, {
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

    // Always checkpoint failures
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    await checkpoint(entityId, {
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
