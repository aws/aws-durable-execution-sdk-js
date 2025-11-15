import { ExecutionContext, InvokeConfig, OperationSubType } from "../../types";
import { InvokeError } from "../../errors/durable-error/durable-error";
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
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { EventEmitter } from "events";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { DurablePromise } from "../../utils/durable-promise/durable-promise";

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId?: string,
): {
  <I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  <I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
} => {
  function invokeHandler<I, O>(
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  function invokeHandler<I, O>(
    name: string,
    funcId: string,
    input: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  function invokeHandler<I, O>(
    nameOrFuncId: string,
    funcIdOrInput?: string | I,
    inputOrConfig?: I | InvokeConfig<I, O>,
    maybeConfig?: InvokeConfig<I, O>,
  ): DurablePromise<O> {
    const isNameFirst = typeof funcIdOrInput === "string";
    const name = isNameFirst ? nameOrFuncId : undefined;
    const funcId = isNameFirst ? (funcIdOrInput as string) : nameOrFuncId;
    const input = isNameFirst ? (inputOrConfig as I) : (funcIdOrInput as I);
    const config = isNameFirst
      ? maybeConfig
      : (inputOrConfig as InvokeConfig<I, O>);

    const stepId = createStepId();

    return new DurablePromise(async () => {
      log("🔗", `Invoke ${name || funcId} (${stepId})`);

      // Main invoke logic - can be re-executed if step status changes
      while (true) {
        // Check if we have existing step data
        const stepData = context.getStepData(stepId);

        // Validate replay consistency
        validateReplayConsistency(
          stepId,
          {
            type: OperationType.CHAINED_INVOKE,
            name,
            subType: OperationSubType.CHAINED_INVOKE,
          },
          stepData,
          context,
        );

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          // Return cached result - no need to check for errors in successful operations
          const invokeDetails = stepData.ChainedInvokeDetails;
          return new DurablePromise<O>(() =>
            safeDeserialize(
              config?.resultSerdes || defaultSerdes,
              invokeDetails?.Result,
              stepId,
              name,
              context.terminationManager,

              context.durableExecutionArn,
            ),
          );
        }

        if (
          stepData?.Status === OperationStatus.FAILED ||
          stepData?.Status === OperationStatus.TIMED_OUT ||
          stepData?.Status === OperationStatus.STOPPED
        ) {
          // Wrap in DurablePromise for lazy evaluation
          const invokeDetails = stepData.ChainedInvokeDetails;
          return new DurablePromise<O>(() => {
            if (invokeDetails?.Error) {
              return Promise.reject(
                new InvokeError(
                  invokeDetails.Error.ErrorMessage || "Invoke failed",
                  invokeDetails.Error.ErrorMessage
                    ? new Error(invokeDetails.Error.ErrorMessage)
                    : undefined,
                  invokeDetails.Error.ErrorData,
                ),
              );
            } else {
              return Promise.reject(new InvokeError("Invoke failed"));
            }
          });
        }

        if (stepData?.Status === OperationStatus.STARTED) {
          // Operation is still running, check for other operations before terminating
          if (hasRunningOperations()) {
            log(
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
              operationsEmitter: getOperationsEmitter(),
            });
            continue; // Re-evaluate status after waiting
          }

          // No other operations running, safe to terminate
          log("⏳", `Invoke ${name || funcId} still in progress, terminating`);
          return terminate(
            context,
            TerminationReason.OPERATION_TERMINATED,
            stepId,
          );
        }

        // Serialize the input payload
        const serializedPayload = await safeSerialize(
          config?.payloadSerdes || defaultSerdes,
          input,
          stepId,
          name,
          context.terminationManager,

          context.durableExecutionArn,
        );

        // Create checkpoint for the invoke operation
        await checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.CHAINED_INVOKE,
          Type: OperationType.CHAINED_INVOKE,
          Name: name,
          Payload: serializedPayload,
          ChainedInvokeOptions: {
            FunctionName: funcId,
          },
        });

        log("🚀", `Invoke ${name || funcId} started, re-checking status`);

        // Continue the loop to re-evaluate status (will hit STARTED case)
        continue;
      }
    });
  }

  return invokeHandler;
};
