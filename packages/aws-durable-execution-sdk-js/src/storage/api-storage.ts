import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "../types";
import { ExecutionState } from "./storage-provider";

/**
 * Implementation of ExecutionState that uses the new \@aws-sdk/client-lambda
 */
export class ApiStorage implements ExecutionState {
  protected client: LambdaClient;

  constructor(client?: LambdaClient) {
    this.client = client ?? new LambdaClient();
  }

  /**
   * Gets step data from the durable execution
   * @param checkpointToken - The checkpoint token
   * @param nextMarker - The pagination token
   * @returns Response with operations data
   */
  async getStepData(
    checkpointToken: string,
    durableExecutionArn: string,
    nextMarker: string,
  ): Promise<GetDurableExecutionStateResponse> {
    const response = await this.client.send(
      new GetDurableExecutionStateCommand({
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Marker: nextMarker,
        MaxItems: 1000,
      }),
    );

    return response;
  }

  /**
   * Checkpoints the durable execution with operation updates
   * @param checkpointToken - The checkpoint token
   * @param data - The checkpoint data
   * @returns Checkpoint response
   */
  async checkpoint(
    checkpointToken: string,
    data: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    const response = await this.client.send(
      new CheckpointDurableExecutionCommand({
        DurableExecutionArn: data.DurableExecutionArn,
        CheckpointToken: checkpointToken,
        ClientToken: data.ClientToken,
        Updates: data.Updates,
      }),
    );
    return response;
  }

  /**
   * Optional complete method
   */
  complete?(
    _event: DurableExecutionInvocationInput,
    _response: DurableExecutionInvocationOutput | null,
  ): void {
    // Implementation if needed
  }
}
