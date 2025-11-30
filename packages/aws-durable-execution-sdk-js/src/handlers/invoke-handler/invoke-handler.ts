import {
  ExecutionContext,
  InvokeConfig,
  OperationSubType,
  DurablePromise,
  OperationLifecycleState,
} from "../../types";
import { InvokeError } from "../../errors/durable-error/durable-error";
import {
  OperationAction,
  OperationStatus,
  OperationType,
} from "@aws-sdk/client-lambda";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { defaultSerdes } from "../../utils/serdes/serdes";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";

export const createInvokeHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
): {
  <I, O>(
    funcId: string,
    input?: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  <I, O>(
    name: string,
    funcId: string,
    input?: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
} => {
  function invokeHandler<I, O>(
    funcId: string,
    input?: I,
    config?: InvokeConfig<I, O>,
  ): DurablePromise<O>;
  function invokeHandler<I, O>(
    name: string,
    funcId: string,
    input?: I,
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
    const input = isNameFirst
      ? (inputOrConfig as I | undefined)
      : (funcIdOrInput as I | undefined);
    const config = isNameFirst
      ? maybeConfig
      : (inputOrConfig as InvokeConfig<I, O>);

    const stepId = createStepId();

    // Phase 1: Start invoke operation
    let isCompleted = false;

    const phase1Promise = (async (): Promise<void> => {
      log("🔗", "Invoke phase 1:", { stepId, name: name || funcId });

      let stepData = context.getStepData(stepId);

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

      // Check if already completed
      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("⏭️", "Invoke already completed:", { stepId });
        checkAndUpdateReplayMode?.();

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.CHAINED_INVOKE,
              subType: OperationSubType.CHAINED_INVOKE,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Check if already failed
      if (
        stepData?.Status === OperationStatus.FAILED ||
        stepData?.Status === OperationStatus.TIMED_OUT ||
        stepData?.Status === OperationStatus.STOPPED
      ) {
        log("❌", "Invoke already failed:", { stepId });

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.CHAINED_INVOKE,
              subType: OperationSubType.CHAINED_INVOKE,
              parentId,
            },
          },
        );

        isCompleted = true;
        return;
      }

      // Start invoke if not already started
      if (!stepData) {
        const serializedPayload = await safeSerialize(
          config?.payloadSerdes || defaultSerdes,
          input,
          stepId,
          name,
          context.terminationManager,
          context.durableExecutionArn,
        );

        await checkpoint.checkpoint(stepId, {
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
      }

      // Mark as IDLE_NOT_AWAITED
      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId,
            name,
            type: OperationType.CHAINED_INVOKE,
            subType: OperationSubType.CHAINED_INVOKE,
            parentId,
          },
        },
      );

      log("✅", "Invoke phase 1 complete:", { stepId });
    })();

    phase1Promise.catch(() => {});

    // Phase 2: Wait for completion
    return new DurablePromise(async () => {
      await phase1Promise;

      if (isCompleted) {
        const stepData = context.getStepData(stepId);

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          const invokeDetails = stepData.ChainedInvokeDetails;
          return await safeDeserialize(
            config?.resultSerdes || defaultSerdes,
            invokeDetails?.Result,
            stepId,
            name,
            context.terminationManager,
            context.durableExecutionArn,
          );
        }

        // Handle failure
        const invokeDetails = stepData?.ChainedInvokeDetails;
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
      }

      log("🔗", "Invoke phase 2:", { stepId });

      checkpoint.markOperationAwaited(stepId);

      await checkpoint.waitForStatusChange(stepId);

      const stepData = context.getStepData(stepId);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("✅", "Invoke completed:", { stepId });
        checkAndUpdateReplayMode?.();

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
        );

        const invokeDetails = stepData.ChainedInvokeDetails;
        return await safeDeserialize(
          config?.resultSerdes || defaultSerdes,
          invokeDetails?.Result,
          stepId,
          name,
          context.terminationManager,
          context.durableExecutionArn,
        );
      }

      // Handle failure
      log("❌", "Invoke failed:", { stepId, status: stepData?.Status });

      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);

      const invokeDetails = stepData?.ChainedInvokeDetails;
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
    });
  }

  return invokeHandler;
};
