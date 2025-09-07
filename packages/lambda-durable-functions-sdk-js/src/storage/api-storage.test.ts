import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  LambdaClient,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@amzn/dex-internal-sdk";
import { TEST_CONSTANTS } from "../testing/test-constants";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
  InvocationStatus,
  OperationSubType,
} from "../types";
import { ApiStorage } from "./api-storage";

// Mock the LambdaClient
jest.mock("@amzn/dex-internal-sdk", () => {
  const originalModule = jest.requireActual("@amzn/dex-internal-sdk");
  return {
    ...originalModule,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    CheckpointDurableExecutionCommand: jest.fn(),
    GetDurableExecutionStateCommand: jest.fn(),
  };
});

describe("ApiStorage", () => {
  const endpoint: string = "https://custom-endpoint.com";
  let apiStorage: ApiStorage;
  let mockLambdaClient: { send: jest.Mock };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set environment variables for ApiStorage
    process.env.DEX_ENDPOINT = endpoint;
    process.env.DEX_REGION = "us-east-1";

    // Create a new instance of ApiStorage
    apiStorage = new ApiStorage();

    // Get the mocked LambdaClient instance
    mockLambdaClient = (LambdaClient as jest.Mock).mock.results[0].value;
  });

  test("should initialize with correct endpoint and region", () => {
    // Verify that LambdaClient was constructed with the correct parameters
    expect(LambdaClient).toHaveBeenCalledWith({
      endpoint: expect.any(String),
      region: expect.any(String),
      credentials: expect.any(Function),
    });
  });

  test("should use environment variables for endpoint and region if available", () => {
    // Save original environment
    const originalEnv = process.env;

    try {
      // Set environment variables
      process.env.DEX_ENDPOINT = "https://custom-endpoint.com";
      process.env.DEX_REGION = "eu-west-1";

      // Create a new instance
      new ApiStorage();

      // Verify that LambdaClient was constructed with the environment variables
      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://custom-endpoint.com",
        region: "eu-west-1",
        credentials: expect.any(Function),
      });
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test("should use default region when DEX_REGION is not set", () => {
    // Save original environment
    const originalEnv = process.env;

    try {
      // Set only endpoint, not region
      process.env.DEX_ENDPOINT = "https://custom-endpoint.com";
      delete process.env.DEX_REGION;

      // Create a new instance
      new ApiStorage();

      // Verify that LambdaClient was constructed with default region
      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://custom-endpoint.com",
        region: "us-east-1",
        credentials: expect.any(Function),
      });
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test.skip("should throw error when environment variable is missing", () => {
    // Save original environment
    const originalEnv = process.env;

    try {
      delete process.env.DEX_ENDPOINT;

      // Should throw error when creating instance without environment variables
      expect(() => new ApiStorage()).toThrow(
        "DEX_ENDPOINT environment variable must be set",
      );
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test("should call getStepData with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { _stepData: [] };
    mockLambdaClient.send.mockResolvedValue(mockResponse);

    // Call getStepData
    const result = await apiStorage.getStepData(
      "checkpoint-token",
      "next-marker",
    );

    // Verify that GetDurableExecutionStateCommand was constructed with the correct parameters
    expect(GetDurableExecutionStateCommand).toHaveBeenCalledWith({
      CheckpointToken: "checkpoint-token",
      Marker: "next-marker",
      MaxItems: 1000,
    });

    // Verify that send was called with the GetDurableExecutionStateCommand
    expect(mockLambdaClient.send).toHaveBeenCalledWith(
      expect.any(GetDurableExecutionStateCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should call checkpoint with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { taskToken: "new-task-token" };
    mockLambdaClient.send.mockResolvedValue(mockResponse);

    // Create checkpoint data
    const checkpointData: CheckpointDurableExecutionRequest = {
      CheckpointToken: "",
      Updates: [
        {
          SubType: OperationSubType.STEP,
          Type: OperationType.STEP,
          Action: OperationAction.START,
        },
      ],
    };

    // Call checkpoint
    const result = await apiStorage.checkpoint("task-token", checkpointData);

    // Verify that CheckpointDurableExecutionCommand was constructed with the correct parameters
    expect(CheckpointDurableExecutionCommand).toHaveBeenCalledWith({
      CheckpointToken: "task-token",
      Updates: checkpointData.Updates,
    });

    // Verify that send was called with the CheckpointDurableExecutionCommand
    expect(mockLambdaClient.send).toHaveBeenCalledWith(
      expect.any(CheckpointDurableExecutionCommand),
    );

    // Verify the result
    expect(result).toBe(mockResponse);
  });

  test("should propagate errors from LambdaClient", async () => {
    // Setup mock error
    const mockError = new Error("SWF client error");
    mockLambdaClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    await expect(
      apiStorage.getStepData("task-token", "next-token"),
    ).rejects.toThrow("SWF client error");

    // Call checkpoint and expect it to throw
    await expect(
      apiStorage.checkpoint("task-token", {
        CheckpointToken: "",
        Updates: [
          {
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ],
      }),
    ).rejects.toThrow("SWF client error");
  });

  test("should call complete method without errors", () => {
    // Setup mock event and response
    const mockEvent: DurableExecutionInvocationInput = {
      CheckpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
      DurableExecutionArn: "test-arn",
      InitialExecutionState: {
        Operations: [],
        NextMarker: "",
      },
    };
    const mockResponse: DurableExecutionInvocationOutput = {
      Status: InvocationStatus.SUCCEEDED,
      Result: "",
    };

    // Call complete method - should not throw
    expect(() => {
      apiStorage.complete?.(mockEvent, mockResponse);
    }).not.toThrow();

    // Call complete method with undefined response - should not throw
    expect(() => {
      apiStorage.complete?.(mockEvent, null);
    }).not.toThrow();
  });
});
