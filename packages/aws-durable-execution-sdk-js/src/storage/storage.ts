import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
} from "@aws-sdk/client-lambda";
import { ApiStorage } from "./api-storage";
import { Logger } from "../types";

export interface ExecutionState {
  getStepData(
    taskToken: string,
    durableExecutionArn: string,
    nextToken: string,
    logger?: Logger,
  ): Promise<GetDurableExecutionStateResponse>;
  checkpoint(
    taskToken: string,
    data: CheckpointDurableExecutionRequest,
    logger?: Logger,
  ): Promise<CheckpointDurableExecutionResponse>;
}

let customStorage: ExecutionState | undefined;

export function setCustomStorage(storage: ExecutionState): void {
  customStorage = storage;
}

export function getExecutionState(): ExecutionState {
  return customStorage || new ApiStorage();
}
