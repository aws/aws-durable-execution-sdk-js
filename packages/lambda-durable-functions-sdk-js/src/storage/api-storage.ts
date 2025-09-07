import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@amzn/dex-internal-sdk";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "../types";
import { getCredentialsProvider } from "./credentials-provider";
import { ExecutionState } from "./storage-provider";

/**
 * Implementation of ExecutionState that uses the new @amzn/dex-internal-sdk
 */
export class ApiStorage implements ExecutionState {
  protected client: LambdaClient;

  constructor(client?: LambdaClient) {
    if (client) {
      this.client = client;
    } else {
      const endpoint = process.env.DEX_ENDPOINT || "";
      const region = process.env.DEX_REGION || "us-east-1";

      if (!endpoint) {
        console.warn("DEX_ENDPOINT environment variable not set, using empty string");
      }

      this.client = new LambdaClient({
        endpoint,
        region,
        credentials: getCredentialsProvider(),
      });
    }
  }

  /**
   * Gets step data from the durable execution
   * @param checkpointToken The checkpoint token
   * @param nextMarker The pagination token
   * @returns Response with operations data
   */
  async getStepData(
    checkpointToken: string,
    nextMarker: string,
  ): Promise<GetDurableExecutionStateResponse> {
    const response = await this.client.send(
      new GetDurableExecutionStateCommand({
        CheckpointToken: checkpointToken,
        Marker: nextMarker,
        MaxItems: 1000,
      }),
    );

    return response;
  }

  /**
   * Checkpoints the durable execution with operation updates
   * @param checkpointToken The checkpoint token
   * @param data The checkpoint data
   * @returns Checkpoint response
   */
  async checkpoint(
    checkpointToken: string,
    data: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    const response = await this.client.send(
      new CheckpointDurableExecutionCommand({
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
