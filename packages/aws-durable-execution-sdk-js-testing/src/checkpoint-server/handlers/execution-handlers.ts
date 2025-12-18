import { ErrorObject } from "@aws-sdk/client-lambda";
import {
  createExecutionId,
  ExecutionId,
  InvocationId,
} from "../utils/tagged-strings";
import {
  ExecutionManager,
  InvocationResult,
} from "../storage/execution-manager";
import {
  StartDurableExecutionRequest,
  StartInvocationRequest,
} from "../worker-api/worker-api-request";
import { CompleteInvocationResponse } from "../worker-api/worker-api-response";

/**
 * Starts a durable execution. Returns the data needed for the handler invocation event.
 */
export function processStartDurableExecution(
  params: StartDurableExecutionRequest,
  executionManager: ExecutionManager,
): InvocationResult {
  return executionManager.startExecution({
    executionId: createExecutionId(),
    ...params,
  });
}

/**
 * Starts an invocation of a durable execution. Returns the data for an individual invocation for an
 * in-progress execution.
 */
export function processStartInvocation(
  params: StartInvocationRequest,
  executionManager: ExecutionManager,
): InvocationResult {
  return executionManager.startInvocation(params);
}

export function processCompleteInvocation(
  executionId: ExecutionId,
  invocationId: InvocationId,
  error: ErrorObject | undefined,
  executionManager: ExecutionManager,
): CompleteInvocationResponse {
  return executionManager.completeInvocation(executionId, invocationId, error);
}
