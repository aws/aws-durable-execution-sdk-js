import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { ExecutionState } from "@aws/durable-execution-sdk-js";

/**
 * Local storage implementation that connects to the local checkpoint server
 * instead of real AWS Lambda API for testing purposes.
 */
export class LocalRunnerStorage implements ExecutionState {
  private client: LambdaClient;

  constructor() {
    const endpoint =
      process.env.DURABLE_LOCAL_RUNNER_ENDPOINT ?? "http://localhost:3000";
    const region = process.env.DURABLE_LOCAL_RUNNER_REGION ?? "us-east-1";

    this.client = new LambdaClient({
      endpoint,
      region,
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
  }

  async getStepData(
    params: GetDurableExecutionStateRequest,
  ): Promise<GetDurableExecutionStateResponse> {
    const response = await this.client.send(
      new GetDurableExecutionStateCommand(params),
    );

    return response;
  }

  async checkpoint(
    params: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    const response = await this.client.send(
      new CheckpointDurableExecutionCommand(params),
    );

    return response;
  }
}
