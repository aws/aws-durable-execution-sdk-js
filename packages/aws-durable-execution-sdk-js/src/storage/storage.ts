import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "@aws-sdk/client-lambda";
import { ApiStorage } from "./api-storage";
import { DurableLogger } from "../types";

export interface ExecutionState {
  getStepData(
    params: GetDurableExecutionStateRequest,
    logger?: DurableLogger,
  ): Promise<GetDurableExecutionStateResponse>;
  checkpoint(
    params: CheckpointDurableExecutionRequest,
    logger?: DurableLogger,
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
