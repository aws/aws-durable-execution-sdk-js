import { ExecutionContext, InvokeConfig, OperationSubType } from "../../types";
import { terminate } from "../../utils/termination-helper";
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
import { OperationInterceptor } from "../../mocks/operation-interceptor";

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
) => {
  function invokeHandler<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig,
  ): Promise<O>;
  function invokeHandler<I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig,
  ): Promise<O>;
  async function invokeHandler<I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig,
    maybeConfig?: InvokeConfig,
  ): Promise<O> {
    const isNameFirst = typeof funcIdOrInput === "string";
    const name = isNameFirst ? nameOrFuncId : undefined;
    const funcId = isNameFirst ? (funcIdOrInput as string) : nameOrFuncId;
    const input = isNameFirst ? (inputOrConfig as I) : (funcIdOrInput as I);
    const config = isNameFirst
      ? maybeConfig
      : (inputOrConfig as InvokeConfig);

    const stepId = createStepId();

    log(context.isVerbose, "🔗", `Invoke ${name || funcId} (${stepId})`);

    // Check if we have existing step data
    const stepData = context.getStepData(stepId);

    if (stepData?.Status === OperationStatus.SUCCEEDED) {
      // Return cached result - no need to check for errors in successful operations
      const invokeDetails = stepData.InvokeDetails;
      return await safeDeserialize(
        config?.serdes || defaultSerdes,
        invokeDetails?.Result,
        stepId,
        name,
        context.terminationManager,
        context.isVerbose,
        context.durableExecutionArn,
      );
    }

    if (stepData?.Status === OperationStatus.FAILED) {
      // Operation failed, throw error
      const invokeDetails = stepData.InvokeDetails;
      const error = new Error(
        invokeDetails?.Error?.ErrorMessage || "Invoke failed",
      );
      error.name = invokeDetails?.Error?.ErrorType || "InvokeError";
      throw error;
    }

    if (stepData?.Status === OperationStatus.STARTED) {
      // Operation is still running, terminate and wait for completion
      // It's a temporary solution until we implement more sopesticated solution
      log(
        context.isVerbose,
        "⏳",
        `Invoke ${name || funcId} still in progress, terminating`,
      );
      return terminate(context, TerminationReason.OPERATION_TERMINATED, stepId);
    }

    // Execute with potential interception (testing)
    const result = await OperationInterceptor.forExecution(
      context.durableExecutionArn,
    ).execute(name, async (): Promise<O> => {
      // Serialize the input payload
      const serializedPayload = await safeSerialize(
        config?.serdes || defaultSerdes,
        input,
        stepId,
        name,
        context.terminationManager,
        context.isVerbose,
        context.durableExecutionArn,
      );

      // Create checkpoint for the invoke operation
      await checkpoint(stepId, {
        Id: stepId,
        ParentId: context.parentId,
        Action: OperationAction.START,
        SubType: OperationSubType.INVOKE,
        Type: OperationType.INVOKE,
        Name: name,
        Payload: serializedPayload,
        InvokeOptions: {
          FunctionName: funcId,
        },
      });

      log(
        context.isVerbose,
        "🚀",
        `Invoke ${name || funcId} started, terminating for async execution`,
      );

      // Terminate to allow the invoke to execute asynchronously
      // It's a temporary solution until we implement more sopesticated solution
      return terminate(context, TerminationReason.OPERATION_TERMINATED, stepId);
    });

    return result;
  }

  return invokeHandler;
};
