import { ApiStorage } from "./api-storage";
import { LocalRunnerStorage } from "./local-runner-storage";
import { ExecutionStateFactory } from "./storage-factory";

describe("ExecutionStateFactory", () => {
  test("should create ApiStorage by default", () => {
    // Create the execution state
    const executionState = ExecutionStateFactory.createExecutionState();

    // Verify that it's an instance of ApiStorage
    expect(executionState).toBeInstanceOf(ApiStorage);
  });

  test("should create LocalRunnerStorage when isLocalRunner is true", () => {
    // Create the execution state with LocalRunner flag
    const executionState = ExecutionStateFactory.createExecutionState(true);

    // Verify that it's an instance of LocalRunnerStorage
    expect(executionState).toBeInstanceOf(LocalRunnerStorage);
  });

  test("should create ApiStorage when isLocalRunner is false", () => {
    // Create the execution state with LocalRunner flag set to false
    const executionState = ExecutionStateFactory.createExecutionState(false);

    // Verify that it's an instance of ApiStorage
    expect(executionState).toBeInstanceOf(ApiStorage);
  });
});
