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

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: ReturnType<typeof createCheckpoint>,
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

    // Shared invoke logic for both phases
    const executeInvokeLogic = async (
      canTerminate: boolean,
    ): Promise<O | undefined> => {
      log(
        "🔗",
        `Invoke ${name || funcId} (${stepId}) - ${canTerminate ? "phase 2" : "phase 1"}`,
      );

      // Check initial step data for replay consistency validation
      const initialStepData = context.getStepData(stepId);

      // Validate replay consistency once before the loop
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
            // Phase 1: Don't wait, just return
            if (!canTerminate) {
              log(
                "⏸️",
                `Invoke ${name || funcId} has running operations (phase 1)`,
              );
              return;
            }

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

          // No other operations running
          // Phase 1: Just return without terminating
          // Phase 2: Terminate
          if (canTerminate) {
            log(
              "⏳",
              `Invoke ${name || funcId} still in progress, terminating`,
            );
            return terminate(
              context,
              TerminationReason.OPERATION_TERMINATED,
              stepId,
            );
          } else {
            log(
              "⏸️",
              `Invoke ${name || funcId} ready but not terminating (phase 1)`,
            );
            return;
          }
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

        // In phase 1, after checkpointing, just return
        // Phase 2 will handle the STARTED status
        if (!canTerminate) {
          log("⏸️", `Invoke ${name || funcId} checkpointed (phase 1)`);
          return;
        }

        // Continue the loop to re-evaluate status (will hit STARTED case)
        continue;
      }
    };

    // Create a promise that tracks phase 1 completion
    const phase1Promise = executeInvokeLogic(false)
      .then(() => {
        log("✅", "Invoke phase 1 complete:", { stepId, name: name || funcId });
      })
      .catch(() => {
        // Phase 1 errors are ignored, phase 2 will handle them
      });

    // Return DurablePromise that will execute phase 2 when awaited
    return new DurablePromise(async () => {
      // Wait for phase 1 to complete first
      await phase1Promise;
      // Then execute phase 2
      const result = await executeInvokeLogic(true);
      return result!; // Phase 2 always returns a value or throws
    });
  }

  return invokeHandler;
};
