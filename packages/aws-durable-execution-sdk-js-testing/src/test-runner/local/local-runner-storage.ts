import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  DurableExecutionClient,
} from "@aws/durable-execution-sdk-js";
import { CheckpointWorkerManager } from "./worker/checkpoint-worker-manager";
import { ApiType } from "../../checkpoint-server/worker-api/worker-api-types";

/**
 * Local storage implementation that connects to the local checkpoint server
 * instead of real AWS Lambda API for testing purposes.
 */
export class LocalRunnerClient implements DurableExecutionClient {
  async getExecutionState(
    params: GetDurableExecutionStateRequest,
  ): Promise<GetDurableExecutionStateResponse> {
    return CheckpointWorkerManager.getInstance().sendApiRequest(
      ApiType.GetDurableExecutionState,
      params,
    );
  }

  async checkpoint(
    params: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    return CheckpointWorkerManager.getInstance().sendApiRequest(
      ApiType.CheckpointDurableExecutionState,
      {
        ...params,
        // Read here, on the thread whose clock skipTime fakes. The worker schedules waits
        // and retries from this time. See CheckpointDurableExecutionStateRequest.
        clientTimestampMs: Date.now(),
      },
    );
  }
}
