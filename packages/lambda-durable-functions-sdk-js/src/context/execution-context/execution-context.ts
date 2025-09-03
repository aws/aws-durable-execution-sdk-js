import { Operation } from "@amzn/dex-internal-sdk";
import { randomUUID } from "crypto";
import { ExecutionStateFactory } from "../../storage/storage-factory";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { DurableExecutionInvocationInput, ExecutionContext } from "../../types";
import { log } from "../../utils/logger/logger";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";

export const initializeExecutionContext = async (
  event: DurableExecutionInvocationInput,
): Promise<{ executionContext: ExecutionContext; checkpointToken: string }> => {
  const isLocalMode = process.env.DURABLE_LOCAL_MODE === "true";
  const isRecordDefinitionMode =
    process.env.DURABLE_RECORD_DEFINITION_MODE === "true";
  const isVerbose =
    process.env.DURABLE_VERBOSE_MODE === "true" || isRecordDefinitionMode;
  const isLocalRunner = event.LocalRunner || false;

  log(isVerbose, "🔵", "Initializing durable function with event:", event);
  log(isVerbose, "🔧", `Running in mode: ${isLocalMode ? "LOCAL" : "LAMBDA"}`);
  log(
    isVerbose,
    "🔧",
    `Local runner mode: ${isLocalRunner ? "ENABLED" : "DISABLED"}`,
  );
  log(
    isVerbose,
    "🔧",
    `Recording definition mode: ${isRecordDefinitionMode ? "ENABLED" : "DISABLED"}`,
  );
  log(isVerbose, "📍", "Function Input:", event);

  const checkpointToken = event.CheckpointToken;
  const durableExecutionArn = event.DurableExecutionArn;

  const state = ExecutionStateFactory.createExecutionState(isLocalRunner);

  const operationsArray = [...(event.InitialExecutionState.Operations || [])];
  let nextMarker = event.InitialExecutionState.NextMarker;

  while (nextMarker) {
    const response = await state.getStepData(checkpointToken, nextMarker);
    operationsArray.push(...(response.Operations || []));
    nextMarker = response.NextMarker || "";
  }

  const initialExecutionEvent = operationsArray[0];
  const customerHandlerEvent = JSON.parse(
    initialExecutionEvent.ExecutionDetails?.InputPayload ?? "{}",
  );

  log(isVerbose, "📝", "Operations:", operationsArray);

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

  log(isVerbose, "📝", "Loaded step data:", stepData);

  return {
    executionContext: {
      executionContextId: randomUUID(),
      customerHandlerEvent,
      state,
      _stepData: stepData,
      terminationManager: new TerminationManager(),
      isLocalMode,
      isVerbose,
      durableExecutionArn,
      getStepData(stepId: string) {
        return getStepDataUtil(stepData, stepId);
      },
    },
    checkpointToken,
  };
};
