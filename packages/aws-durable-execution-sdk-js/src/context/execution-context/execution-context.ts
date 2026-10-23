import { Operation } from "../../types/wire";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  DurableExecutionInvocationInput,
  ExecutionContext,
  DurableExecutionMode,
  DurableExecutionConfig,
} from "../../types";
import { log } from "../../utils/logger/logger";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";

import { Context } from "aws-lambda";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { warnOnceIfContextStorageIsDegraded } from "../../utils/context-tracker/context-storage";
import { normalizeOperations } from "../../utils/operation/normalize-operation";
import type { InvocationLifecycle } from "../../utils/invocation-lifecycle/invocation-lifecycle";

/**
 * Chooses the transport for this invocation.
 *
 * A harness that wraps an already-configured handler cannot supply configuration, so it
 * injects through the event instead; that channel wins, since the handler's own config is
 * whatever the code under test declared. Otherwise a caller-supplied transport is used,
 * and failing that the SDK's Lambda transport.
 */
const resolveDurableExecutionClient = (
  event: DurableExecutionInvocationInput,
  config?: DurableExecutionConfig,
): DurableExecutionClient => {
  if (DurableExecutionInvocationInputWithClient.isInstance(event)) {
    if (config?.durableExecutionClient) {
      // Worth a line: a harness supplying its own transport silently shadows the one the
      // handler under test was configured with, which is confusing to debug from the
      // outside.
      log(
        "🔀",
        "Event-injected durable execution client overrides config.durableExecutionClient",
      );
    }
    return event.durableExecutionClient;
  }

  return (
    config?.durableExecutionClient ??
    new DurableExecutionApiClient(config?.client)
  );
};

export const initializeExecutionContext = async (
  event: DurableExecutionInvocationInput,
  context: Context,
  config?: DurableExecutionConfig,
  invocationLifecycle?: InvocationLifecycle,
): Promise<{
  executionContext: ExecutionContext;
  durableExecutionMode: DurableExecutionMode;
  checkpointToken: string;
}> => {
  log("🔵", "Initializing durable function with event:", event);
  log("📍", "Function Input:", event);

  const checkpointToken = event.CheckpointToken;
  const durableExecutionArn = event.DurableExecutionArn;

  const client = resolveDurableExecutionClient(event, config);
  const request = async <T>(send: () => Promise<T>): Promise<T> => {
    if (invocationLifecycle && !invocationLifecycle.allowsRequests())
      return new Promise(() => {});
    const response = await send();
    // A custom transport may ignore cancellation. Its late response cannot resume
    // pagination or handler work in an invocation that has already ended.
    if (invocationLifecycle && !invocationLifecycle.allowsRequests())
      return new Promise(() => {});
    return response;
  };
  const durableExecutionClient: DurableExecutionClient = invocationLifecycle
    ? {
        getExecutionState: (params, logger) =>
          request(() =>
            client.getExecutionState(params, logger, {
              abortSignal: invocationLifecycle.signal,
            }),
          ),
        checkpoint: (params, logger) =>
          request(() =>
            client.checkpoint(params, logger, {
              abortSignal: invocationLifecycle.signal,
            }),
          ),
      }
    : client;

  // Create logger for initialization errors using existing logger factory
  const initLogger = createDefaultLogger({
    durableExecutionArn,
    requestId: context.awsRequestId,
    tenantId: context.tenantId,
  });

  // Runtimes without AsyncLocalStorage run with degraded operation-context tracking. Say so
  // here, where a logger first exists, rather than leaving it to be inferred from log records
  // that are missing their operation metadata.
  warnOnceIfContextStorageIsDegraded(initLogger);

  const operationsArray: Operation[] = normalizeOperations(
    event.InitialExecutionState.Operations || [],
  );
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
    operationsArray.push(...normalizeOperations(response.Operations || []));
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

  // Build the set of operation IDs that were updated between invocations
  const updatedOperationIds = new Set<string>(event.UpdatedOperationIds || []);

  return {
    executionContext: {
      ...(invocationLifecycle && { invocationLifecycle }),
      durableExecutionClient,
      _stepData: stepData,
      terminationManager: new TerminationManager(),

      durableExecutionArn,
      pendingCompletions: new Set<string>(),
      getStepData(stepId: string): Operation | undefined {
        return getStepDataUtil(stepData, stepId);
      },
      isOperationUpdatedBetweenInvocation(hashedOperationId: string): boolean {
        return updatedOperationIds.has(hashedOperationId);
      },
      tenantId: context.tenantId,
      requestId: context.awsRequestId,
      // The one reduction here that is a function rather than a value, because the answer
      // changes over the life of the invocation. Where no deadline is known, a caller
      // supplies `() => Infinity`.
      getRemainingTimeMs: () => context.getRemainingTimeInMillis(),
    },
    durableExecutionMode,
    checkpointToken,
  };
};
