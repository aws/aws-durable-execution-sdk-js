import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
} from "@aws-sdk/client-lambda";
import { ApiStorage } from "./api-storage";

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
}

let customStorage: ExecutionState | undefined;

export function setCustomStorage(storage: ExecutionState): void {
  customStorage = storage;
}

export function getExecutionState(): ExecutionState {
  return customStorage || new ApiStorage();
}
