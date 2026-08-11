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
} from "../../types/wire";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { defaultSerdes, AnySerdes } from "../../utils/serdes/serdes";
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
import { resolveChildArgs } from "./resolve-child-args";
import {
  DurableInstrumentationPlugin,
  CustomerFnResult,
  PluginOperationStatus,
} from "../../types/plugin";
import {
  backfillOperationInfo,
  toOperationInfo,
} from "../../utils/operation/operation";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

import { CHECKPOINT_SIZE_LIMIT_BYTES } from "../../utils/constants/constants";

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

  getDefaultSerdes?: () => AnySerdes,
  plugin: DurableInstrumentationPlugin = {},
  childPreserveDepth: number = 0,
) => {
  return <T>(
    nameOrFn: string | undefined | ChildFunc<T, Logger>,
    fnOrOptions?: ChildFunc<T, Logger> | ChildConfig<T>,
    maybeOptions?: ChildConfig<T>,
  ): DurablePromise<T> => {
    const { name, fn, options } = resolveChildArgs<T, Logger>(
      nameOrFn,
      fnOrOptions,
      maybeOptions,
    );

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
          getDefaultSerdes,
          parentId,
          plugin,
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
        getDefaultSerdes,
        plugin,
        childPreserveDepth,
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

  getDefaultSerdes?: () => AnySerdes,
  parentId?: string,
  plugin: DurableInstrumentationPlugin = {},
): Promise<T> => {
  const serdes =
    options?.serdes || (getDefaultSerdes ? getDefaultSerdes() : defaultSerdes);
  const errorMapper = options?.errorMapper;
  const stepData = context.getStepData(entityId);
  const result = stepData?.ContextDetails?.Result;

  // Handle failed child context
  if (stepData?.Status === OperationStatus.FAILED) {
    if (stepData.ContextDetails?.Error) {
      const originalError = DurableOperationError.fromErrorObject(
        stepData.ContextDetails.Error,
      );

      // Use errorMapper if provided, otherwise wrap in ChildContextError
      if (errorMapper) {
        throw errorMapper(originalError);
      }

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

    const replayedFn = (): unknown => fn(durableChildContext);
    // This is the one path that re-runs a context body so its checkpointed
    // children replay, so it is the only place isReplayingChildren can be true.
    // The context's own result is also being replayed (it is SUCCEEDED and
    // checkpointed), hence isReplay is true as well -- the two flags together
    // let a plugin tell this apart from a plain replayed result, which does not
    // re-enter the body at all and fires no hook.
    const replayWrapInfo = {
      id: hashId(entityId),
      name: stepName,
      type: OperationType.CONTEXT,
      subType: options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT,
      parentId: parentId ? hashId(parentId) : undefined,
      isReplay: true,
      isReplayingChildren: true,
    };

    const replayedResult = (await runWithContext(
      entityId,
      entityId,
      plugin.wrapChildContextFn
        ? (): CustomerFnResult =>
            plugin.wrapChildContextFn!(replayWrapInfo, replayedFn)
        : replayedFn,
      undefined,
      undefined,
      stepName,
    )) as T;

    // Large payloads re-execute the child function on replay, so apply the
    // same serdes round-trip first-run uses, keeping the returned value
    // consistent across first-run and replay.
    const reserialized = await safeSerialize(
      serdes,
      replayedResult,
      entityId,
      stepName,
      context.terminationManager,
      context.durableExecutionArn,
    );
    return await safeDeserialize(
      serdes,
      reserialized,
      entityId,
      stepName,
      context.terminationManager,
      context.durableExecutionArn,
    );
  }

  log("⏭️", "Child context already finished, returning cached result:", {
    entityId,
  });

  // Small payloads: replay deserializes the checkpoint, so match that here.
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

  getDefaultSerdes?: () => AnySerdes,
  plugin: DurableInstrumentationPlugin = {},
  preserveChildDepth: number = 0,
): Promise<T> => {
  const serdes =
    options?.serdes || (getDefaultSerdes ? getDefaultSerdes() : defaultSerdes);
  const errorMapper = options?.errorMapper;
  const isVirtual = options?.virtualContext === true;
  const opInfo = {
    id: hashId(entityId),
    name: name,
    type: OperationType.CONTEXT,
    subType: options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT,
    parentId: parentId ? hashId(parentId) : undefined,
  };

  // Checkpoint at start if not already started and not virtual (fire-and-forget for performance)
  if (!isVirtual && context.getStepData(entityId) === undefined) {
    const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
    checkpoint.checkpoint(entityId, {
      Id: entityId,
      ParentId: parentId,
      Action: OperationAction.START,
      SubType: subType,
      Type: OperationType.CONTEXT,
      Name: name,
    });
    await plugin.onOperationStart?.({
      ...opInfo,
      status: PluginOperationStatus.STARTED,
      isReplay: false,
    });
  } else {
    await plugin.onOperationStart?.({ ...opInfo, isReplay: true });
  }

  const childReplayMode = determineChildReplayMode(context, entityId);

  // Create a child context with appropriate parentId and stepPrefix
  const durableChildContext = createChildContext(
    context,
    parentContext,
    childReplayMode,
    getParentLogger(),
    entityId, // stepPrefix: use entityId for unique step IDs
    undefined,
    // parentId: this parameter is used for checkpointing, and should point to
    // valid parentId tthat is already checkpointed.
    // If this runInChildContext is a virtual, then we will use the parentId  (the ancestor)
    // But if this runInChildContext is not virtual, then it's entityId can be used
    isVirtual ? parentId : entityId,
  );

  try {
    // Execute the child context function with context tracking
    const childContextFn = () => fn(durableChildContext);
    // Both flags are derived from the replay mode, but note that a
    // SUCCEEDED/FAILED operation never reaches executeChildContext -- the
    // handler dispatches those to handleCompletedChildContext -- and
    // ReplayChildren is only ever written on the terminal checkpoint. So in
    // practice childReplayMode is ExecutionMode here and both flags are false;
    // the children-replay re-run is wrapped in handleCompletedChildContext.
    // The derivation is kept rather than hardcoded so it stays correct if the
    // dispatch ever admits a terminal operation here.
    const wrapInfo = {
      ...opInfo,
      isReplay: childReplayMode !== DurableExecutionMode.ExecutionMode,
      isReplayingChildren:
        childReplayMode === DurableExecutionMode.ReplaySucceededContext,
    };
    const result = (await runWithContext(
      entityId,
      parentId,
      plugin.wrapChildContextFn
        ? () => plugin.wrapChildContextFn!(wrapInfo, childContextFn)
        : childContextFn,
      undefined,
      childReplayMode,
      name,
    )) as T;

    // Close the descendant-checkpoint gate NOW — synchronously, before the
    // safeSerialize await below yields the event loop. `fn` has returned, so
    // this context is logically finished; for a map/parallel that completed
    // early (e.g. minSuccessful) some child branches may still be in flight.
    // Marking finished here makes their later terminal checkpoints
    // deterministically no-op, closing the race where a child that settles
    // during serialization would otherwise checkpoint SUCCEEDED after the batch
    // completed — which replay would then reconstruct as a completed item the
    // live BatchResult never observed (issue #751). Descendant checkpoints are
    // the only thing this gate affects; this context's own SUCCEED checkpoint
    // below is unaffected (hasFinishedAncestor only inspects ancestors).
    if (!isVirtual) {
      checkpoint.markAncestorFinished(entityId);
    }

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
      Buffer.byteLength(serializedResult, "utf8") > CHECKPOINT_SIZE_LIMIT_BYTES
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
        limit: CHECKPOINT_SIZE_LIMIT_BYTES,
      });
    }

    // Preserve this context's children across suspend/resume when the execution
    // opts in within the configured depth (pluginsConfig.childOperationsDepth).
    // Setting ReplayChildren tells the backend not to prune this context's
    // children when it finishes, so a later invocation's snapshot still sees
    // the full tree. Unlike the large-payload case we keep the FULL result
    // checkpointed. On replay the context's orchestration re-runs and its
    // result is rebuilt by replaying the (still-checkpointed) children — the
    // children themselves are NOT re-executed (their step bodies/side effects
    // don't run again). See the cost note on
    // DurableExecutionConfig.pluginsConfig.childOperationsDepth.
    if (preserveChildDepth >= 1) {
      replayChildren = true;
    }

    // Checkpoint this run-in-child-context as finished (only for non-virtual).
    // The descendant-checkpoint gate was already closed via
    // markAncestorFinished immediately after `fn` returned (see above), before
    // the safeSerialize await, so no in-flight child can slip a terminal
    // checkpoint through during serialization.
    if (!isVirtual) {
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
      const currentStepData = context.getStepData(entityId);
      const onOperationEndInfo = toOperationInfo(currentStepData);
      backfillOperationInfo(onOperationEndInfo, opInfo);
      await plugin.onOperationEnd?.({
        ...onOperationEndInfo,
        status: PluginOperationStatus.SUCCEEDED,
        isReplay: false,
      });

      log("✅", "Child context completed successfully:", {
        entityId,
        name,
      });
    } else {
      log("✅", "Virtual child context completed successfully:", {
        entityId,
        name,
      });
      await plugin.onOperationEnd?.({
        ...opInfo,
        status: PluginOperationStatus.SUCCEEDED,
        isReplay: true,
      });
    }

    // Return deserialize(serialize(result)) in every mode (small payload,
    // large payload / ReplayChildren, and virtual). This gives developers a
    // single, predictable mental model: the value handed back from a child
    // context has always passed through the serdes round-trip, regardless of
    // payload size or whether the context is virtual. The corresponding replay
    // paths (small: deserialize the checkpoint; large: re-execute then
    // round-trip; virtual: re-execute then round-trip) produce the same value.
    return await safeDeserialize(
      serdes,
      serializedResult,
      entityId,
      name,
      context.terminationManager,
      context.durableExecutionArn,
    );
  } catch (error) {
    log(
      "❌",
      isVirtual ? "Virtual child context failed:" : "Child context failed:",
      {
        entityId,
        name,
        error,
      },
    );

    // Always wrap in ChildContextError for consistent error handling
    const errorObject = createErrorObjectFromError(error);
    const reconstructedError =
      DurableOperationError.fromErrorObject(errorObject);

    // Mark this run-in-child-context as finished and checkpoint failure (only for non-virtual)
    if (!isVirtual) {
      checkpoint.markAncestorFinished(entityId);

      const subType = options?.subType || OperationSubType.RUN_IN_CHILD_CONTEXT;
      checkpoint.checkpoint(entityId, {
        Id: entityId,
        ParentId: parentId,
        Action: OperationAction.FAIL,
        SubType: subType,
        Type: OperationType.CONTEXT,
        Error: createErrorObjectFromError(error),
        // Preserve the children of a FAILED context too when within the
        // configured depth — failures are often the most important thing to
        // observe (e.g. emitMode "on-failure"). A failed context throws its
        // checkpointed error on replay (ReplayMode) and is never re-executed,
        // so this only asks the backend to retain the children; it adds no
        // replay cost. See pluginsConfig.childOperationsDepth.
        ContextOptions:
          preserveChildDepth >= 1 ? { ReplayChildren: true } : undefined,
        Name: name,
      });
      const currentStepData = context.getStepData(entityId);
      const onOperationEndInfo = toOperationInfo(currentStepData);
      backfillOperationInfo(onOperationEndInfo, opInfo);
      await plugin.onOperationEnd?.({
        ...onOperationEndInfo,
        status: PluginOperationStatus.FAILED,
        isReplay: false,
        error: reconstructedError,
      });
    } else {
      await plugin.onOperationEnd?.({
        ...opInfo,
        status: PluginOperationStatus.FAILED,
        isReplay: true,
        error: reconstructedError,
      });
    }

    // Use errorMapper if provided, otherwise wrap in ChildContextError
    if (errorMapper) {
      throw errorMapper(reconstructedError);
    }

    throw new ChildContextError(reconstructedError.message, reconstructedError);
  }
};
