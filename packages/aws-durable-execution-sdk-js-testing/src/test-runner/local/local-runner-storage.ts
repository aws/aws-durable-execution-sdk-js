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
  /**
   * @param pauseExecution - Pauses the execution this client belongs to, as the SDK does
   * for a retry decision with `pause: true`. It acts like `LocalDurableTestRunner.pauseExecution()`,
   * but does not wait for the calling invocation to end. The ClientToken and Reason of the
   * request are not used locally. Without it, the client has no pause support.
   */
  constructor(readonly pauseExecution?: () => Promise<void>) {}

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
      params,
    );
  }
}
