import { ErrorObject, Operation, Event } from "@aws-sdk/client-lambda";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import { InvocationResult } from "../../../checkpoint-server/storage/execution-manager";
import { SerializedCheckpointOperation } from "../../../checkpoint-server/types/operation-event";
import {
  ExecutionId,
  InvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import {
  StartDurableExecutionRequest,
  StartInvocationRequest,
} from "../../../checkpoint-server/worker-api/worker-api-request";

export interface SerializedPollCheckpointResponse {
  operations: SerializedCheckpointOperation[];
}

/**
 * Client for interacting with the checkpoint server API
 */
export interface CheckpointApiClient {
  /**
   * Start a new durable invocation
   */
  startDurableExecution(
    params: StartDurableExecutionRequest,
  ): Promise<InvocationResult>;

  /**
   * Poll for checkpoint data
   */
  pollCheckpointData(
    executionId: ExecutionId,
    signal?: AbortSignal,
  ): Promise<{
    operations: CheckpointOperation[];
  }>;

  /**
   * Update checkpoint data for a specific operation with the intended status.
   *
   * @param params Object containing update parameters
   * @param params.executionId The execution ID containing the operation
   * @param params.operationId The specific operation ID to update
   * @param params.status Optional operation status to set
   * @throws {Error} When the API request fails or returns a non-success status
   */
  updateCheckpointData(params: {
    executionId: ExecutionId;
    operationId: string;
    operationData: Partial<Operation>;
    payload?: string;
    error?: ErrorObject;
  }): Promise<void>;

  /**
   * Start a new invocation for an existing execution
   */
  startInvocation(params: StartInvocationRequest): Promise<InvocationResult>;

  completeInvocation(
    executionId: ExecutionId,
    invocationId: InvocationId,
    error: ErrorObject | undefined,
  ): Promise<Event>;
}
