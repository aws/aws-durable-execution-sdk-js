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
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
): {
  <I, O>(funcId: string, input: I, config?: InvokeConfig<I, O>): Promise<O>;
  <I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;
} => {
  function invokeHandler<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;
  function invokeHandler<I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): Promise<O>;
  async function invokeHandler<I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ): Promise<O> {
    const isNameFirst = typeof funcIdOrInput === "string";
    const name = isNameFirst ? nameOrFuncId : undefined;
    const funcId = isNameFirst ? (funcIdOrInput as string) : nameOrFuncId;
    const input = isNameFirst ? (inputOrConfig as I) : (funcIdOrInput as I);
    const config = isNameFirst
      ? maybeConfig
      : (inputOrConfig as InvokeConfig<I, O>);

    const stepId = createStepId();

    log(context.isVerbose, "🔗", `Invoke ${name || funcId} (${stepId})`);

    // Main invoke logic - can be re-executed if step status changes
    while (true) {
      // Check if we have existing step data
      const stepData = context.getStepData(stepId);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        // Return cached result - no need to check for errors in successful operations
        const invokeDetails = stepData.InvokeDetails;
        return await safeDeserialize(
          config?.resultSerdes || defaultSerdes,
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
        // Operation is still running, check for other operations before terminating
        if (hasRunningOperations()) {
          log(
            context.isVerbose,
            "⏳",
            `Invoke ${name || funcId} still in progress, waiting for other operations`,
          );
          await waitBeforeContinue({
            checkHasRunningOperations: true,
            checkStepStatus: true,
            checkTimer: false,
            stepId,
            context,
            hasRunningOperations,
          });
          continue; // Re-evaluate status after waiting
        }

        // No other operations running, safe to terminate
        log(
          context.isVerbose,
          "⏳",
          `Invoke ${name || funcId} still in progress, terminating`,
        );
        return terminate(
          context,
          TerminationReason.OPERATION_TERMINATED,
          stepId,
        );
      }

      // Execute with potential interception (testing)
      await OperationInterceptor.forExecution(
        context.durableExecutionArn,
      ).execute(name, async (): Promise<void> => {
        // Serialize the input payload
        const serializedPayload = await safeSerialize(
          config?.payloadSerdes || defaultSerdes,
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
            ...(config?.timeoutSeconds && {
              TimeoutSeconds: config.timeoutSeconds,
            }),
          },
        });

        log(
          context.isVerbose,
          "🚀",
          `Invoke ${name || funcId} started, re-checking status`,
        );
      });

      // Continue the loop to re-evaluate status (will hit STARTED case)
      continue;
    }
  }

  return invokeHandler;
};
