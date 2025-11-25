import {
  ExecutionContext,
  InvokeConfig,
  OperationSubType,
  DurablePromise,
} from "../../types";
import { InvokeError } from "../../errors/durable-error/durable-error";
import { terminate } from "../../utils/termination-helper/termination-helper";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { callCheckpoint, Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { TerminationReason } from "../../termination-manager/types";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { EventEmitter } from "events";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
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

    // Phase 1: Only checkpoint if needed, don't execute full logic
    const startInvokeOperation = async (): Promise<void> => {
      log("🔗", `Invoke ${name || funcId} (${stepId}) - phase 1`);

      // Check initial step data for replay consistency validation
      const initialStepData = context.getStepData(stepId);

      // Validate replay consistency once before any execution
      validateReplayConsistency(
        stepId,
        {
          type: OperationType.CHAINED_INVOKE,
          name,
          subType: OperationSubType.CHAINED_INVOKE,
        },
        initialStepData,
        context,
      );

      // If stepData already exists, phase 1 has nothing to do
      if (initialStepData) {
        log("⏸️", `Invoke ${name || funcId} already exists (phase 1)`);
        return;
      }

      // No stepData exists - need to start the invoke operation
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
      await callCheckpoint(checkpoint, stepId, {
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

      log("🚀", `Invoke ${name || funcId} started (phase 1)`);
    };

    // Phase 2: Execute full logic including waiting and termination
    const continueInvokeOperation = async (): Promise<O> => {
      log("🔗", `Invoke ${name || funcId} (${stepId}) - phase 2`);

      // Main invoke logic - can be re-executed if step status changes
      while (true) {
        // Check if we have existing step data
        const stepData = context.getStepData(stepId);

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          // Return cached result - no need to check for errors in successful operations
          const invokeDetails = stepData.ChainedInvokeDetails;
          checkAndUpdateReplayMode?.();
          return await safeDeserialize(
            config?.resultSerdes || defaultSerdes,
            invokeDetails?.Result,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );
        }

        if (
          stepData?.Status === OperationStatus.FAILED ||
          stepData?.Status === OperationStatus.TIMED_OUT ||
          stepData?.Status === OperationStatus.STOPPED
        ) {
          // Operation failed, return async rejected promise
          const invokeDetails = stepData.ChainedInvokeDetails;
          return (async (): Promise<O> => {
            if (invokeDetails?.Error) {
              throw new InvokeError(
                invokeDetails.Error.ErrorMessage || "Invoke failed",
                invokeDetails.Error.ErrorMessage
                  ? new Error(invokeDetails.Error.ErrorMessage)
                  : undefined,
                invokeDetails.Error.ErrorData,
              );
            } else {
              throw new InvokeError("Invoke failed");
            }
          })();
        }

        if (stepData?.Status === OperationStatus.STARTED) {
          // Operation is still running
          if (hasRunningOperations()) {
            // Phase 2: Wait for other operations
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

          // No other operations running - terminate
          log("⏳", `Invoke ${name || funcId} still in progress, terminating`);
          return terminate(
            context,
            TerminationReason.OPERATION_TERMINATED,
            stepId,
          );
        }

        // If stepData exists but has an unexpected status, break to avoid infinite loop
        if (stepData && stepData.Status !== undefined) {
          throw new InvokeError(
            `Unexpected operation status: ${stepData.Status}`,
          );
        }

        // This should not happen in phase 2 since phase 1 creates stepData
        throw new InvokeError(
          "No step data found in phase 2 - this should not happen",
        );
      }
    };

    // Create a promise that tracks phase 1 completion
    const startInvokePromise = startInvokeOperation()
      .then(() => {
        log("✅", "Invoke phase 1 complete:", { stepId, name: name || funcId });
      })
      .catch((error) => {
        log("❌", "Invoke phase 1 error:", { stepId, error: error.message });
        throw error; // Re-throw to fail phase 1
      });

    // Attach catch handler to prevent unhandled promise rejections
    // The error will still be thrown when the DurablePromise is awaited
    startInvokePromise.catch(() => {});

    // Return DurablePromise that will execute phase 2 when awaited
    return new DurablePromise(async () => {
      // Wait for phase 1 to complete first
      await startInvokePromise;
      // Then execute phase 2
      return await continueInvokeOperation();
    });
  }

  return invokeHandler;
};
