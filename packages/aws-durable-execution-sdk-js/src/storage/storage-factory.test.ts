import { ApiStorage } from "./api-storage";
import { ExecutionStateFactory, setCustomStorage } from "./storage-factory";

describe("ExecutionStateFactory", () => {
  afterEach(() => {
    // Reset custom storage after each test
    setCustomStorage(undefined as any);
  });

  test("should create ApiStorage by default", () => {
    // Create the execution state
    const executionState = ExecutionStateFactory.createExecutionState();

    // Verify that it's an instance of ApiStorage
    expect(executionState).toBeInstanceOf(ApiStorage);
  });

  test("should return custom storage when set", () => {
    const customStorage = new ApiStorage();
    setCustomStorage(customStorage);

    const executionState = ExecutionStateFactory.createExecutionState();
    expect(executionState).toBe(customStorage);
  });
});
