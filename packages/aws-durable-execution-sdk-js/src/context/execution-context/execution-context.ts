import {
  LambdaClient,
  Operation,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  DurableExecutionInvocationInput,
  ExecutionContext,
  DurableExecutionMode,
} from "../../types";
import {
  DurableInstrumentationPlugin,
  OperationInfo,
  OperationEndInfo,
} from "../../types/plugin";
import { log } from "../../utils/logger/logger";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";

import { Context } from "aws-lambda";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";

const TERMINAL_STATUSES: OperationStatus[] = [
  OperationStatus.SUCCEEDED,
  OperationStatus.FAILED,
  OperationStatus.TIMED_OUT,
  OperationStatus.STOPPED,
  OperationStatus.CANCELLED,
];

/**
 * Checks if the given status is a terminal operation status.
 */
function isTerminalStatus(status?: string): boolean {
  return (
    status != null && TERMINAL_STATUSES.includes(status as OperationStatus)
  );
}

/**
 * Extracts an Error from an operation's error details when the operation has FAILED status.
 */
function extractErrorFromOp(operation: Operation): Error | undefined {
  if (operation.Status === OperationStatus.FAILED) {
    const errorData =
      operation.StepDetails?.Error ||
      operation.ChainedInvokeDetails?.Error ||
      operation.CallbackDetails?.Error;
    if (errorData?.ErrorMessage) {
      return new Error(errorData.ErrorMessage);
    }
  }
  return undefined;
}

export const initializeExecutionContext = async (
  event: DurableExecutionInvocationInput,
  context: Context,
  lambdaClient?: LambdaClient,
  plugin?: DurableInstrumentationPlugin,
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

  // Dispatch inter-invocation hooks for operations that updated between invocations
  if (
    event.updatedOperationIds &&
    event.updatedOperationIds.length > 0 &&
    plugin
  ) {
    const toOperationInfoFromOp = (op: Operation): OperationInfo => ({
      Id: op.Id ?? "",
      Name: op.Name,
      Type: op.Type ?? "",
      SubType: op.SubType,
      ParentId: op.ParentId,
      StartTimestamp: op.StartTimestamp,
      EndTimestamp: op.EndTimestamp,
      getParent: (): OperationInfo | undefined => {
        if (!op.ParentId) return undefined;
        const parentOp = stepData[op.ParentId];
        if (!parentOp) return undefined;
        return toOperationInfoFromOp(parentOp);
      },
    });
    const toOperationEndInfoFromOp = (op: Operation): OperationEndInfo => ({
      ...toOperationInfoFromOp(op),
      error: extractErrorFromOp(op),
    });

    for (const operationId of event.updatedOperationIds) {
      const operation = stepData[operationId];
      if (!operation) continue; // Skip if not found in stepData

      const status = operation.Status;

      if (isTerminalStatus(status)) {
        plugin.onOperationEnd?.(toOperationEndInfoFromOp(operation));
      } else if (status === OperationStatus.STARTED) {
        plugin.onOperationStart?.(toOperationInfoFromOp(operation));
      }
      // Skip PENDING or other non-actionable statuses
    }
  }

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
