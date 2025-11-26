import { LambdaClient } from "@aws-sdk/client-lambda";
import { DurableExecutionApiClient } from "./durable-execution-api-client";

// Mock the LambdaClient
jest.mock("@aws-sdk/client-lambda", () => {
  const originalModule = jest.requireActual("@aws-sdk/client-lambda");
  return {
    ...originalModule,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
  };
});

describe("DurableExecutionApiClient Caching", () => {
  beforeEach(() => {
    // Reset all mocks for each test
    jest.clearAllMocks();
  });

  test("should cache and reuse default LambdaClient across multiple instances", () => {
    // Track call count for this test
    let callCount = 0;

    // Replace the mock implementation to track calls
    (LambdaClient as jest.Mock).mockImplementation(function () {
      callCount++;
      return { send: jest.fn() };
    });

    // Create the first instance (should create a new LambdaClient)
    const firstInstance = new DurableExecutionApiClient();
    const callCountAfterFirst = callCount;

    // Create the second instance (should reuse the cached LambdaClient)
    const secondInstance = new DurableExecutionApiClient();
    const callCountAfterSecond = callCount;

    // Verify both instances exist
    expect(firstInstance).toBeInstanceOf(DurableExecutionApiClient);
    expect(secondInstance).toBeInstanceOf(DurableExecutionApiClient);

    // First instance should have triggered LambdaClient creation
    expect(callCountAfterFirst).toBe(1);

    // Second instance should NOT have triggered another LambdaClient creation (cached)
    expect(callCountAfterSecond).toBe(1);
    expect(callCountAfterSecond).toBe(callCountAfterFirst);

    // Verify the constructor was called with correct configuration
    expect(LambdaClient).toHaveBeenCalledWith({
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 50000,
        requestTimeout: 55000,
        throwOnRequestTimeout: true,
      },
    });

    // Verify the constructor was called exactly once (cached behavior)
    expect(LambdaClient).toHaveBeenCalledTimes(1);
  });

  test("should not use cached client when custom client is provided", async () => {
    // Create custom clients with mock send methods
    const customClient1 = {
      send: jest.fn().mockResolvedValue({ _stepData: [] }),
    };
    const customClient2 = {
      send: jest.fn().mockResolvedValue({ taskToken: "test-token" }),
    };

    // Create instances with custom clients (should not use cached default client)
    const firstInstance = new DurableExecutionApiClient(customClient1 as any);
    const secondInstance = new DurableExecutionApiClient(customClient2 as any);

    // Verify both instances exist
    expect(firstInstance).toBeInstanceOf(DurableExecutionApiClient);
    expect(secondInstance).toBeInstanceOf(DurableExecutionApiClient);

    // Call methods on both instances to verify they use their respective custom clients
    await firstInstance.getExecutionState({
      CheckpointToken: "test-token-1",
      DurableExecutionArn: "test-arn-1",
    });

    await secondInstance.checkpoint({
      DurableExecutionArn: "test-arn-2",
      CheckpointToken: "test-token-2",
      Updates: [],
    });

    // Verify that each instance used its own custom client
    expect(customClient1.send).toHaveBeenCalledTimes(1);
    expect(customClient2.send).toHaveBeenCalledTimes(1);

    // Verify that the default LambdaClient constructor was not called for these instances
    expect(LambdaClient).not.toHaveBeenCalled();
  });
});
