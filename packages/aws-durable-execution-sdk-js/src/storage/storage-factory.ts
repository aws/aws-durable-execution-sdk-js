import { ApiStorage } from "./api-storage";
import { LocalRunnerStorage } from "./local-runner-storage";
import { ExecutionState } from "./storage-provider";

export class ExecutionStateFactory {
  static createExecutionState(isLocalRunner?: boolean): ExecutionState {
    if (isLocalRunner) {
      return new LocalRunnerStorage();
    }

    return new ApiStorage();
  }
}
