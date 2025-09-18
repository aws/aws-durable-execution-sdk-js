import {
  ExecutionContext,
  CreateCallbackConfig,
  CreateCallbackResult,
  OperationSubType,
} from "../../types";
import { terminate } from "../../utils/termination-helper";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";
import { TerminationReason } from "../../termination-manager/types";
import { Serdes } from "../../utils/serdes/serdes";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";
import { CallbackError } from "../../errors/callback-error/callback-error";

const passThroughSerdes: Serdes<any> = {
  serialize: async (value: any) => value,
  deserialize: async (data: string | undefined) => data,
};

/**
 * Creates a thenable that terminates only when awaited (when .then() is called)
 * Properly implements Promise interface including instanceof Promise support
 */
const createTerminatingThenable = <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  message: string,
): Promise<T> => {
  // Create a class that extends Promise to support instanceof checks
  class TerminatingPromise extends Promise<T> {
    constructor() {
      // Call super with a dummy executor that never resolves
      super(() => {});
    }

    then<TResult1 = T, TResult2 = never>(
      _onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      _onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> {
      // Terminate when the promise is actually awaited
      return terminate(context, TerminationReason.CALLBACK_PENDING, message);
    }

    catch<TResult = never>(
      _onrejected?:
        | ((reason: unknown) => TResult | PromiseLike<TResult>)
        | null,
    ): Promise<T | TResult> {
      // Terminate when catch is called (which internally calls then)
      return terminate(context, TerminationReason.CALLBACK_PENDING, message);
    }

    finally(_onfinally?: (() => void) | null): Promise<T> {
      // Terminate when finally is called
      return terminate(context, TerminationReason.CALLBACK_PENDING, message);
    }
  }

  return new TerminatingPromise();
};

export const createCallback = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
) => {
  return async <T>(
    nameOrConfig?: string | undefined | CreateCallbackConfig,
    maybeConfig?: CreateCallbackConfig,
  ): Promise<CreateCallbackResult<T>> => {
    let name: string | undefined;
    let config: CreateCallbackConfig | undefined;

    if (typeof nameOrConfig === "string" || nameOrConfig === undefined) {
      name = nameOrConfig;
      config = maybeConfig;
    } else {
      config = nameOrConfig;
    }

    const stepId = createStepId();
    const serdes = config?.serdes || passThroughSerdes;

    log(context.isVerbose, "📞", "Creating callback:", {
      stepId,
      name,
      config,
    });

    const stepData = context.getStepData(stepId);

    // Check if callback already exists and is completed
    if (stepData?.Status === OperationStatus.SUCCEEDED) {
      return await handleCompletedCallback<T>(context, stepId, name, serdes);
    }

    if (stepData?.Status === OperationStatus.FAILED) {
      return await handleFailedCallback<T>(context, stepId, name, serdes);
    }

    // Check if callback is already started (has callbackId)
    if (stepData?.Status === OperationStatus.STARTED) {
      return await handleStartedCallback<T>(context, stepId, name, serdes);
    }

    // Create new callback
    return await createNewCallback<T>(
      context,
      checkpoint,
      stepId,
      name,
      config,
      serdes,
    );
  };
};

const handleCompletedCallback = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes: Serdes<T>,
): Promise<CreateCallbackResult<T>> => {
  log(
    context.isVerbose,
    "⏭️",
    "Callback already completed, returning cached result:",
    { stepId },
  );

  const stepData = context.getStepData(stepId);
  const callbackData = stepData?.CallbackDetails;
  if (!callbackData?.CallbackId) {
    throw new Error(`No callback ID found for completed callback: ${stepId}`);
  }

  const result = callbackData.Result;
  if (result === undefined) {
    throw new Error(`No result found for completed callback: ${stepId}`);
  }

  const deserializedResult = await safeDeserialize(
    serdes,
    result,
    stepId,
    stepName,
    context.terminationManager,
    context.isVerbose,
    context.durableExecutionArn,
  );

  // Return resolved promise with the result
  const resolvedPromise = Promise.resolve(deserializedResult) as Promise<T>;
  return [resolvedPromise, callbackData.CallbackId];
};

const handleFailedCallback = async <T>(
  context: ExecutionContext,
  stepId: string,
  _stepName: string | undefined,
  _serdes: Serdes<T>,
): Promise<CreateCallbackResult<T>> => {
  log(
    context.isVerbose,
    "❌",
    "Callback already failed, returning rejected promise:",
    { stepId },
  );

  const stepData = context.getStepData(stepId);
  const callbackData = stepData?.CallbackDetails;
  if (!callbackData?.CallbackId) {
    throw new Error(`No callback ID found for failed callback: ${stepId}`);
  }

  // Return rejected promise with the error
  const rejectedPromise = Promise.reject(
    new CallbackError(stepData?.CallbackDetails?.Error),
  ) as Promise<T>;
  return [rejectedPromise, callbackData.CallbackId];
};

const handleStartedCallback = async <T>(
  context: ExecutionContext,
  stepId: string,
  _stepName: string | undefined,
  _serdes: Serdes<T>,
): Promise<CreateCallbackResult<T>> => {
  log(
    context.isVerbose,
    "⏳",
    "Callback already started, returning existing promise:",
    { stepId },
  );

  const stepData = context.getStepData(stepId);
  const callbackData = stepData?.CallbackDetails;
  if (!callbackData?.CallbackId) {
    throw new Error(`No callback ID found for started callback: ${stepId}`);
  }

  // Create a thenable that terminates only when awaited
  const callbackPromise = createTerminatingThenable<T>(
    context,
    stepId,
    _stepName,
    `Callback ${_stepName || stepId} is pending external completion`,
  );

  return [callbackPromise, callbackData.CallbackId];
};

const createNewCallback = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  stepId: string,
  name: string | undefined,
  config: CreateCallbackConfig | undefined,
  _serdes: Serdes<T>,
): Promise<CreateCallbackResult<T>> => {
  log(context.isVerbose, "🆕", "Creating new callback:", {
    stepId,
    name,
    config,
  });

  // Checkpoint the callback creation - the API will generate and return the callbackId
  await checkpoint(stepId, {
    Id: stepId,
    ParentId: context.parentId,
    Action: "START",
    SubType: OperationSubType.CALLBACK,
    Type: OperationType.CALLBACK,
    Name: name,
    CallbackOptions: {
      TimeoutSeconds: config?.timeout,
      HeartbeatTimeoutSeconds: config?.heartbeatTimeout,
    },
  });

  // After checkpoint, the context._stepData should be updated with the callbackId
  const stepData = context.getStepData(stepId);
  const callbackData = stepData?.CallbackDetails;
  if (!callbackData?.CallbackId) {
    throw new Error(
      `Callback ID not found in stepData after checkpoint: ${stepId}`,
    );
  }

  const callbackId = callbackData.CallbackId;

  // Create a thenable that terminates only when awaited
  const callbackPromise = createTerminatingThenable<T>(
    context,
    stepId,
    name,
    `Callback ${name || stepId} created and pending external completion`,
  );

  log(context.isVerbose, "✅", "Callback created successfully:", {
    stepId,
    name,
    callbackId,
  });

  return [callbackPromise, callbackId];
};
