import {
  CheckpointOperation,
  OperationInvocationIdMap,
} from "../../../checkpoint-server/storage/checkpoint-manager";
import { InvocationResult } from "../../../checkpoint-server/storage/execution-manager";
import { Operation } from "@aws-sdk/client-lambda";
import {
  API_PATHS,
  HTTP_METHODS,
  getStartInvocationPath,
  getPollCheckpointDataPath,
  getUpdateCheckpointDataPath,
} from "../../../checkpoint-server/constants";
import { ExecutionId } from "../../../checkpoint-server/utils/tagged-strings";

/**
 * Client for interacting with the checkpoint server API
 */
export class CheckpointApiClient {
  constructor(private readonly baseUrl: string) {}

  getServerUrl() {
    return this.baseUrl;
  }

  /**
   * Start a new durable invocation
   */
  async startDurableExecution(payload?: string): Promise<InvocationResult> {
    return this.makeRequest<InvocationResult>({
      path: API_PATHS.START_DURABLE_EXECUTION,
      method: HTTP_METHODS.POST,
      body: JSON.stringify({ payload }),
    });
  }

  /**
   * Poll for checkpoint data
   */
  async pollCheckpointData(
    executionId: ExecutionId,
    signal?: AbortSignal
  ): Promise<{
    operations: CheckpointOperation[];
    operationInvocationIdMap: OperationInvocationIdMap;
  }> {
    return this.makeRequest({
      path: getPollCheckpointDataPath(executionId),
      method: HTTP_METHODS.GET,
      signal,
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
    operationData: Operation;
  }): Promise<void> {
    return this.makeRequest({
      path: getUpdateCheckpointDataPath(params.executionId, params.operationId),
      method: HTTP_METHODS.POST,
      body: JSON.stringify({
        operationData: params.operationData,
      }),
    });
  }

  /**
   * Start a new invocation for an existing execution
   */
  async startInvocation(executionId: ExecutionId): Promise<InvocationResult> {
    return this.makeRequest<InvocationResult>({
      path: getStartInvocationPath(executionId),
      method: HTTP_METHODS.POST,
    });
  }

  /**
   * Make an HTTP request to the checkpoint server with retry logic
   */
  private async makeRequest<T>({
    path,
    method,
    body,
    signal,
  }: {
    path: string;
    method: string;
    body?: string;
    signal?: AbortSignal;
  }): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      body,
      headers: {
        "Content-Type": "application/json",
      },
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `Error making HTTP request to ${path}: status: ${response.status}, ${errorText}`
      );
      throw error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return response.json() as T;
  }
}
