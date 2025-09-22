import { ApiStorage } from "./api-storage";
import { PlaygroundLocalRunnerStorage } from "./local-runner-storage";
import { ExecutionStateFactory } from "./storage-factory";

describe("ExecutionStateFactory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original process.env after all tests
    process.env = originalEnv;
  });

  test("should create ApiStorage by default", () => {
    // Ensure the environment variables are not set
    delete process.env.DURABLE_RECORD_DEFINITION_MODE;
    // Set required environment variables for ApiStorage
    process.env.DEX_ENDPOINT = "https://test-endpoint.com";
    process.env.DEX_REGION = "us-east-1";

    // Create the execution state
    const executionState = ExecutionStateFactory.createExecutionState();

    // Verify that it's an instance of ApiStorage
    expect(executionState).toBeInstanceOf(ApiStorage);
  });

  test("should create LocalRunnerStorage when isLocalRunner is true", () => {
    // Ensure the environment variables are not set
    delete process.env.DURABLE_RECORD_DEFINITION_MODE;

    // Create the execution state with LocalRunner flag
    const executionState = ExecutionStateFactory.createExecutionState(true);

    // Verify that it's an instance of LocalRunnerStorage
    expect(executionState).toBeInstanceOf(PlaygroundLocalRunnerStorage);
  });

  test("should create ApiStorage when isLocalRunner is false", () => {
    // Ensure the environment variables are not set
    delete process.env.DURABLE_RECORD_DEFINITION_MODE;
    // Set required environment variables for ApiStorage
    process.env.DEX_ENDPOINT = "https://test-endpoint.com";
    process.env.DEX_REGION = "us-east-1";

    // Create the execution state with LocalRunner flag set to false
    const executionState = ExecutionStateFactory.createExecutionState(false);

    // Verify that it's an instance of ApiStorage
    expect(executionState).toBeInstanceOf(ApiStorage);
  });
});
