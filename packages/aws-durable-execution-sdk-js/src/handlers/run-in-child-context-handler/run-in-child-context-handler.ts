import {
  ExecutionContext,
  ChildFunc,
  ChildConfig,
  OperationSubType,
  DurableExecutionMode,
  Logger,
} from "../../types";
import { Context } from "aws-lambda";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createDurableContext } from "../../context/durable-context/durable-context";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { OperationInterceptor } from "../../mocks/operation-interceptor";
import { createErrorObjectFromError } from "../../utils/error-object/error-object";

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

    log(context.isVerbose, "🔄", "Running child context:", {
      entityId,
      name,
    });

    // Check if this child context has already completed
    if (context.getStepData(entityId)?.Status === OperationStatus.SUCCEEDED) {
      return handleCompletedChildContext<T>(
        context,
        parentContext,
        entityId,
        name,
        fn,
        options,
        getParentLogger,
      );
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
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;
  const stepData = context.getStepData(entityId);
  const result = stepData?.ContextDetails?.Result;

  // Check if we need to replay children due to large payload
  if (stepData?.ContextDetails?.ReplayChildren) {
    log(
      context.isVerbose,
      "🔄",
      "ReplayChildren mode: Re-executing child context due to large payload:",
      { entityId, stepName },
    );

    // Re-execute the child context to reconstruct the result
    const childContext = createDurableContext(
      {
        ...context,
        parentId: entityId,
        _durableExecutionMode: DurableExecutionMode.ReplaySucceededContext,
      },
      parentContext,
      entityId,
      undefined,
      getParentLogger(),
    );

    return await OperationInterceptor.forExecution(
      context.durableExecutionArn,
    ).execute(stepName, () => fn(childContext));
  }

  log(
    context.isVerbose,
    "⏭️",
    "Child context already finished, returning cached result:",
    { entityId },
  );

  return await safeDeserialize(
    serdes,
    result,
    entityId,
    stepName,
    context.terminationManager,
    context.isVerbose,
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
): Promise<T> => {
  const serdes = options?.serdes || defaultSerdes;

  // Checkpoint at start if not already started (fire-and-forget for performance)
  if (context.getStepData(entityId) === undefined) {
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint(entityId, {
      Id: entityId,
      ParentId: context.parentId,
      Action: OperationAction.START,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Name: name,
    });
  }

  // Create a child context with the entity ID as prefix
  const childContext = createDurableContext(
    {
      ...context,
      parentId: entityId,
      _durableExecutionMode: determineChildReplayMode(context, entityId),
    },
    parentContext,
    entityId,
    undefined,
    getParentLogger(),
  );

  try {
    // Execute the child context function
    const result = await OperationInterceptor.forExecution(
      context.durableExecutionArn,
    ).execute(name, () => fn(childContext));

    // Always checkpoint at finish with adaptive mode
    // Serialize the result for consistency
    const serializedResult = await safeSerialize(
      serdes,
      result,
      entityId,
      name,
      context.terminationManager,
      context.isVerbose,
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

      log(
        context.isVerbose,
        "📦",
        "Large payload detected, using ReplayChildren mode:",
        {
          entityId,
          name,
          payloadSize: Buffer.byteLength(serializedResult, "utf8"),
          limit: CHECKPOINT_SIZE_LIMIT,
        },
      );
    }

    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    await checkpoint(entityId, {
      Id: entityId,
      ParentId: context.parentId,
      Action: OperationAction.SUCCEED,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Payload: payloadToCheckpoint,
      ContextOptions: replayChildren ? { ReplayChildren: true } : undefined,
      Name: name,
    });

    log(context.isVerbose, "✅", "Child context completed successfully:", {
      entityId,
      name,
    });

    return result;
  } catch (error) {
    log(context.isVerbose, "❌", "Child context failed:", {
      entityId,
      name,
      error,
    });

    // Always checkpoint failures
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    await checkpoint(entityId, {
      Id: entityId,
      ParentId: context.parentId,
      Action: OperationAction.FAIL,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Error: createErrorObjectFromError(error),
      Name: name,
    });

    throw error;
  }
};
