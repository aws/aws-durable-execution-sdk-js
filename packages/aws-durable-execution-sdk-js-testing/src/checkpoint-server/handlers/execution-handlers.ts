import { ErrorObject, Event } from "@aws-sdk/client-lambda";
import {
  createExecutionId,
  ExecutionId,
  InvocationId,
} from "../utils/tagged-strings";
import {
  ExecutionManager,
  InvocationResult,
} from "../storage/execution-manager";

/**
 * Starts a durable execution. Returns the data needed for the handler invocation event.
 */
export function processStartDurableExecution(
  payload: string | undefined,
  executionManager: ExecutionManager,
): InvocationResult {
  return executionManager.startExecution({
    payload,
    executionId: createExecutionId(),
  });
}

/**
 * Starts an invocation of a durable execution. Returns the data for an individual invocation for an
 * in-progress execution.
 */
export function processStartInvocation(
  executionIdParam: string,
  executionManager: ExecutionManager,
): InvocationResult {
  return executionManager.startInvocation(createExecutionId(executionIdParam));
}

export function processCompleteInvocation(
  executionId: ExecutionId,
  invocationId: InvocationId,
  error: ErrorObject | undefined,
  executionManager: ExecutionManager,
): Event {
  return executionManager.completeInvocation(executionId, invocationId, error);
}
