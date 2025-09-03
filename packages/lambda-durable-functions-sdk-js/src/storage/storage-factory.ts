import { ApiStorage } from "./api-storage";
import { PlaygroundLocalRunnerStorage } from "./local-runner-storage";
import { RecordDefinitionStorage } from "./record-definition-storage";
import { ExecutionState } from "./storage-provider";

export class ExecutionStateFactory {
  static createExecutionState(isLocalRunner?: boolean): ExecutionState {
    const isRecordDefinitionMode =
      process.env.DURABLE_RECORD_DEFINITION_MODE === "true";

    if (isRecordDefinitionMode) {
      return new RecordDefinitionStorage();
    }

    if (isLocalRunner) {
      return new PlaygroundLocalRunnerStorage();
    }

    return new ApiStorage();
  }
}
