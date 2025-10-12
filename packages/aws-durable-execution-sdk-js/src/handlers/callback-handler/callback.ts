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
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";

const passThroughSerdes: Serdes<any> = {
  serialize: async (value: any) => value,
  deserialize: async (data: string | undefined) => data,
};

/**
 * A Promise-like class that checks status and running operations before terminating
 */
export class TerminatingPromise<T> implements Promise<T> {
  constructor(
    private readonly context: ExecutionContext,
    private readonly stepId: string,
    private readonly stepName: string | undefined,
    private readonly message: string,
    private readonly hasRunningOperations: () => boolean,
    private readonly serdes: Serdes<T>,
  ) {}

  async then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      // Wait for EITHER operations to complete OR status to change
      if (this.hasRunningOperations()) {
        await waitBeforeContinue({
          checkHasRunningOperations: true,
          checkStepStatus: true, // ✅ Check status changes too
          checkTimer: false,
          stepId: this.stepId,
          context: this.context,
          hasRunningOperations: this.hasRunningOperations,
          pollingInterval: 1000,
        });
      }

      // Check final status after waiting
      const finalStepData = this.context.getStepData(this.stepId);
      if (finalStepData?.Status === OperationStatus.SUCCEEDED) {
        const result = await handleCompletedCallback<T>(
          this.context,
          this.stepId,
          this.stepName,
          this.serdes,
        );

        if (onfulfilled) {
          return onfulfilled(await result[0]);
        }

        return result[0] as TResult1;
      }

      if (
        finalStepData?.Status === OperationStatus.FAILED ||
        finalStepData?.Status === OperationStatus.TIMED_OUT
      ) {
        const result = await handleFailedCallback<T>(
          this.context,
          this.stepId,
          this.stepName,
          this.serdes,
        );

        await result[0];
        throw new Error(
          "Unreachable state detected. Failed callback should always throw an error.",
        );
      }
    } catch (err) {
      if (onrejected) {
        return onrejected(err);
      }

      throw err;
    }

    // Only terminate if still pending
    return terminate(
      this.context,
      TerminationReason.CALLBACK_PENDING,
      this.message,
    );
  }

  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | null
      | undefined,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    // Delegate to then() which handles the status checking
    return this.then(
      (value) => {
        onfinally?.();
        return value;
      },
      (reason) => {
        onfinally?.();
        throw reason;
      },
    );
  }

  get [Symbol.toStringTag](): string {
    return "TerminatingPromise";
  }
}

/**
 * Creates a thenable that checks status and running operations before terminating
 * Properly implements Promise interface including instanceof Promise support
 */
const createTerminatingThenable = <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  message: string,
  hasRunningOperations: () => boolean,
  serdes: Serdes<T>,
): TerminatingPromise<T> => {
  return new TerminatingPromise<T>(
    context,
    stepId,
    stepName,
    message,
    hasRunningOperations,
    serdes,
  );
};

export const createCallback = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  parentId?: string,
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

    log("📞", "Creating callback:", {
      stepId,
      name,
      config,
    });

    const stepData = context.getStepData(stepId);

    // Check if callback already exists and is completed
    if (stepData?.Status === OperationStatus.SUCCEEDED) {
      return await handleCompletedCallback<T>(context, stepId, name, serdes);
    }

    if (
      stepData?.Status === OperationStatus.FAILED ||
      stepData?.Status === OperationStatus.TIMED_OUT
    ) {
      return await handleFailedCallback<T>(context, stepId, name, serdes);
    }

    // Check if callback is already started (has callbackId)
    if (stepData?.Status === OperationStatus.STARTED) {
      return await handleStartedCallback<T>(
        context,
        stepId,
        name,
        serdes,
        hasRunningOperations,
      );
    }

    // Create new callback
    return await createNewCallback<T>(
      context,
      checkpoint,
      stepId,
      name,
      config,
      serdes,
      hasRunningOperations,
      parentId,
    );
  };
};

const handleCompletedCallback = async <T>(
  context: ExecutionContext,
  stepId: string,
  stepName: string | undefined,
  serdes: Serdes<T>,
): Promise<CreateCallbackResult<T>> => {
  log("⏭️", "Callback already completed, returning cached result:", { stepId });

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
  log("❌", "Callback already failed, returning rejected promise:", { stepId });

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
  stepName: string | undefined,
  serdes: Serdes<T>,
  hasRunningOperations: () => boolean,
): Promise<CreateCallbackResult<T>> => {
  log("⏳", "Callback already started, returning existing promise:", {
    stepId,
  });

  const stepData = context.getStepData(stepId);
  const callbackData = stepData?.CallbackDetails;
  if (!callbackData?.CallbackId) {
    throw new Error(`No callback ID found for started callback: ${stepId}`);
  }

  // Create a thenable that checks status and operations before terminating
  const callbackPromise = createTerminatingThenable<T>(
    context,
    stepId,
    stepName,
    `Callback ${stepName || stepId} is pending external completion`,
    hasRunningOperations,
    serdes,
  );

  return [callbackPromise, callbackData.CallbackId];
};

const createNewCallback = async <T>(
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  stepId: string,
  name: string | undefined,
  config: CreateCallbackConfig | undefined,
  serdes: Serdes<T>,
  hasRunningOperations: () => boolean,
  parentId?: string,
): Promise<CreateCallbackResult<T>> => {
  log("🆕", "Creating new callback:", {
    stepId,
    name,
    config,
  });

  // Checkpoint the callback creation - the API will generate and return the callbackId
  await checkpoint(stepId, {
    Id: stepId,
    ParentId: parentId,
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

  // Create a thenable that checks status and operations before terminating
  const callbackPromise = createTerminatingThenable<T>(
    context,
    stepId,
    name,
    `Callback ${name || stepId} created and pending external completion`,
    hasRunningOperations,
    serdes,
  );

  log("✅", "Callback created successfully:", {
    stepId,
    name,
    callbackId,
  });

  return [callbackPromise, callbackId];
};
