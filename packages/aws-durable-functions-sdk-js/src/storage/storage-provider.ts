import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
} from "@amzn/dex-internal-sdk";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "../types";

export interface ExecutionState {
  getStepData(
    taskToken: string,
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
