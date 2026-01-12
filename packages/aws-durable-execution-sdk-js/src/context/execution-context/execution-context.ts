import { LambdaClient, Operation } from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  DurableExecutionInvocationInput,
  ExecutionContext,
  DurableExecutionMode,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";

import { Context } from "aws-lambda";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";

export const initializeExecutionContext = async (
  event: DurableExecutionInvocationInput,
  context: Context,
  lambdaClient?: LambdaClient,
): Promise<{
  executionContext: ExecutionContext;
  durableExecutionMode: DurableExecutionMode;
  checkpointToken: string;
}> => {
  log("🔵", "Initializing durable function with event:", event);
  log("📍", "Function Input:", event);

  const checkpointToken = event.CheckpointToken;
  const durableExecutionArn = event.DurableExecutionArn;

  const durableExecutionClient =
    // Allow passing arbitrary durable clients if the input is a custom class
    DurableExecutionInvocationInputWithClient.isInstance(event)
      ? event.durableExecutionClient
      : new DurableExecutionApiClient(lambdaClient);

  // Create logger for initialization errors using existing logger factory
  const initLogger = createDefaultLogger({
    durableExecutionArn,
    requestId: context.awsRequestId,
    tenantId: context.tenantId,
  });

  const operationsArray = [...(event.InitialExecutionState.Operations || [])];
  let nextMarker = event.InitialExecutionState.NextMarker;

  while (nextMarker) {
    const response = await durableExecutionClient.getExecutionState(
      {
        CheckpointToken: checkpointToken,
        Marker: nextMarker,
        DurableExecutionArn: durableExecutionArn,
        MaxItems: 1000,
      },
      initLogger,
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
      durableExecutionClient,
      _stepData: stepData,
      terminationManager: new TerminationManager(),

      durableExecutionArn,
      pendingCompletions: new Set<string>(),
      getStepData(stepId: string): Operation | undefined {
        return getStepDataUtil(stepData, stepId);
      },
      tenantId: context.tenantId,
      requestId: context.awsRequestId,
    },
    durableExecutionMode,
    checkpointToken,
  };
};
