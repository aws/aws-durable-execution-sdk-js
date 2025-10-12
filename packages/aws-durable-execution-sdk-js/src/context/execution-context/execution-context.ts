import { Operation } from "@aws-sdk/client-lambda";
import { ExecutionStateFactory } from "../../storage/storage-factory";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  DurableExecutionInvocationInput,
  ExecutionContext,
  DurableExecutionMode,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";

export const initializeExecutionContext = async (
  event: DurableExecutionInvocationInput,
): Promise<{
  executionContext: ExecutionContext;
  durableExecutionMode: DurableExecutionMode;
  checkpointToken: string;
}> => {
  const isLocalRunner = event.LocalRunner || false;

  log("🔵", "Initializing durable function with event:", event);
  log("🔧", `Running in mode: ${isLocalRunner ? "LOCAL" : "LAMBDA"}`);
  log("🔧", `Local runner mode: ${isLocalRunner ? "ENABLED" : "DISABLED"}`);
  log("📍", "Function Input:", event);

  const checkpointToken = event.CheckpointToken;
  const durableExecutionArn = event.DurableExecutionArn;

  const state = ExecutionStateFactory.createExecutionState(isLocalRunner);

  const operationsArray = [...(event.InitialExecutionState.Operations || [])];
  let nextMarker = event.InitialExecutionState.NextMarker;

  while (nextMarker) {
    const response = await state.getStepData(
      checkpointToken,
      durableExecutionArn,
      nextMarker,
    );
    operationsArray.push(...(response.Operations || []));
    nextMarker = response.NextMarker || "";
  }

  // Determine replay mode based on operations array length
  const durableExecutionMode =
    operationsArray.length > 1
      ? DurableExecutionMode.ReplayMode
      : DurableExecutionMode.ExecutionMode;

  log("📝", "Operations:", operationsArray);

  const stepData: Record<string, Operation> = operationsArray.reduce(
    (acc, operation: Operation) => {
      if (operation.Id) {
        // The stepData received from backend has Id and ParentId as hash, so no need to hash it again
        acc[operation.Id] = operation;
      }
      return acc;
    },
    {} as Record<string, Operation>,
  );

  log("📝", "Loaded step data:", stepData);

  return {
    executionContext: {
      state,
      _stepData: stepData,
      terminationManager: new TerminationManager(),
      durableExecutionArn,
      getStepData(stepId: string): Operation | undefined {
        return getStepDataUtil(stepData, stepId);
      },
    },
    durableExecutionMode,
    checkpointToken,
  };
};
