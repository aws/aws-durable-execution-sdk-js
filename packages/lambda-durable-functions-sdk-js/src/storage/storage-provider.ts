import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
} from "@aws-sdk/client-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "../types";

export interface ExecutionState {
  getStepData(
    taskToken: string,
    durableExecutionArn: string,
    nextToken: string,
  ): Promise<GetDurableExecutionStateResponse>;
  checkpoint(
    taskToken: string,
    data: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse>;
  complete?(
    event: DurableExecutionInvocationInput,
    response: DurableExecutionInvocationOutput | null,
  ): void;
}
