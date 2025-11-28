import { Operation, ErrorObject, Event } from "@aws-sdk/client-lambda";
import { CheckpointOperation } from "../../../checkpoint-server/storage/checkpoint-manager";
import { InvocationResult } from "../../../checkpoint-server/storage/execution-manager";
import {
  ExecutionId,
  InvocationId,
} from "../../../checkpoint-server/utils/tagged-strings";
import { CheckpointWorkerManager } from "../worker/checkpoint-worker-manager";
import { CheckpointApiClient } from "./checkpoint-api-client";
import { ApiType } from "../../../checkpoint-server/worker-api/worker-api-types";

export class CheckpointWorkerApiClient implements CheckpointApiClient {
  constructor(private readonly workerManager: CheckpointWorkerManager) {}

  /**
   * Start a new durable invocation
   */
  async startDurableExecution(payload?: string): Promise<InvocationResult> {
    return this.workerManager.sendApiRequest(ApiType.StartDurableExecution, {
      payload,
    });
  }

  /**
   * Poll for checkpoint data
   */
  async pollCheckpointData(executionId: ExecutionId): Promise<{
    operations: CheckpointOperation[];
  }> {
    return this.workerManager.sendApiRequest(ApiType.PollCheckpointData, {
      executionId,
    });
  }

  /**
   * Update checkpoint data for a specific operation with the intended status.
   *
   * @param params Object containing update parameters
   * @param params.executionId The execution ID containing the operation
   * @param params.operationId The specific operation ID to update
   * @param params.status Optional operation status to set
   * @throws {Error} When the API request fails or returns a non-success status
   */
  async updateCheckpointData(params: {
    executionId: ExecutionId;
    operationId: string;
    operationData: Partial<Operation>;
    payload?: string;
    error?: ErrorObject;
  }): Promise<void> {
    await this.workerManager.sendApiRequest(
      ApiType.UpdateCheckpointData,
      params,
    );

    return;
  }

  /**
   * Start a new invocation for an existing execution
   */
  async startInvocation(executionId: ExecutionId): Promise<InvocationResult> {
    return this.workerManager.sendApiRequest(ApiType.StartInvocation, {
      executionId,
    });
  }

  async completeInvocation(
    executionId: ExecutionId,
    invocationId: InvocationId,
    error: ErrorObject | undefined,
  ): Promise<Event> {
    return this.workerManager.sendApiRequest(ApiType.CompleteInvocation, {
      executionId,
      invocationId,
      error,
    });
  }
}
