import { ApiStorage } from "./api-storage";
import { ExecutionState } from "./storage-provider";

let customStorage: ExecutionState | undefined;

export function setCustomStorage(storage: ExecutionState): void {
  customStorage = storage;
}

export class ExecutionStateFactory {
  static createExecutionState(): ExecutionState {
    if (customStorage) {
      return customStorage;
    }

    return new ApiStorage();
  }
}
