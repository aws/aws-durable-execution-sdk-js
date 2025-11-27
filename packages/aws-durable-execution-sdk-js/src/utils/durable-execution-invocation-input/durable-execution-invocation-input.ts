import { Operation } from "@aws-sdk/client-lambda";
import { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionInvocationInput } from "../../types";

/**
 * Custom DurableExecutionInvocationInput which uses a custom durable
 * execution client instead of the API-based LambdaClient.
 *
 * @internal
 */
export class DurableExecutionInvocationInputWithClient
  implements DurableExecutionInvocationInput
{
  public readonly InitialExecutionState: {
    Operations: Operation[];
    NextMarker: string;
  };
  public readonly DurableExecutionArn: string;
  public readonly CheckpointToken: string;
  constructor(
    params: DurableExecutionInvocationInput,
    public readonly durableExecutionClient: DurableExecutionClient,
  ) {
    this.InitialExecutionState = params.InitialExecutionState;
    this.DurableExecutionArn = params.DurableExecutionArn;
    this.CheckpointToken = params.CheckpointToken;
  }
}
