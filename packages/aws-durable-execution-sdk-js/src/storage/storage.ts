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
let defaultStorage: ExecutionState | undefined;

export function setCustomStorage(storage: ExecutionState): void {
  customStorage = storage;
}

export function getExecutionState(): ExecutionState {
  if (customStorage) {
    return customStorage;
  }
  if (!defaultStorage) {
    defaultStorage = new ApiStorage();
  }
  return defaultStorage;
}
