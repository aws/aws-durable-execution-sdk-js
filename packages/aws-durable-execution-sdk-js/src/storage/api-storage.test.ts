import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  LambdaClient,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "../types";
import { ApiStorage } from "./api-storage";
import { log } from "../utils/logger/logger";

// Mock the logger
jest.mock("../utils/logger/logger", () => ({
  log: jest.fn(),
}));

// Mock the LambdaClient
jest.mock("@aws-sdk/client-lambda", () => {
  const originalModule = jest.requireActual("@aws-sdk/client-lambda");
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
  let apiStorage: ApiStorage;
  let mockLambdaClient: { send: jest.Mock };
  let logSpy: jest.MockedFunction<typeof log>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mocked log function
    logSpy = log as jest.MockedFunction<typeof log>;

    // Get the mocked LambdaClient instance before creating ApiStorage
    mockLambdaClient = {
      send: jest.fn(),
    };
    (LambdaClient as jest.Mock).mockImplementation(() => mockLambdaClient);

    // Create a new instance of ApiStorage
    apiStorage = new ApiStorage();
  });

  afterEach(() => {
    // No cleanup needed for mocked functions
  });

  test("should initialize with correct endpoint and region", () => {
    // Verify that LambdaClient was constructed with the correct parameters
    expect(LambdaClient).toHaveBeenCalledWith();
  });

  test("should call getStepData with correct parameters", async () => {
    // Setup mock response
    const mockResponse = { _stepData: [] };
    mockLambdaClient.send.mockResolvedValue(mockResponse);

    // Call getStepData
    const result = await apiStorage.getStepData(
      "checkpoint-token",
      "durable-execution-arn",
      "next-marker",
    );

    // Verify that GetDurableExecutionStateCommand was constructed with the correct parameters
    expect(GetDurableExecutionStateCommand).toHaveBeenCalledWith({
      DurableExecutionArn: "durable-execution-arn",
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
      DurableExecutionArn: "test-durable-execution-arn",
      CheckpointToken: "",
      Updates: [
        {
          Id: "test-step-1",
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
      DurableExecutionArn: "test-durable-execution-arn",
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
    const mockError = new Error("Lambda client error");
    mockLambdaClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    await expect(
      apiStorage.getStepData(
        "task-token",
        "durable-execution-arn",
        "next-token",
      ),
    ).rejects.toThrow("Lambda client error");

    // Call checkpoint and expect it to throw
    await expect(
      apiStorage.checkpoint("task-token", {
        DurableExecutionArn: "",
        CheckpointToken: "",
        Updates: [
          {
            Id: "test-step-2",
            SubType: OperationSubType.STEP,
            Type: OperationType.STEP,
            Action: OperationAction.START,
          },
        ],
      }),
    ).rejects.toThrow("Lambda client error");
  });

  test("should log getStepData errors with request ID", async () => {
    // Setup mock error with AWS metadata
    const mockError = {
      message: "GetDurableExecutionState failed",
      $metadata: { requestId: "test-request-id-123" },
    };
    mockLambdaClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    try {
      await apiStorage.getStepData(
        "checkpoint-token",
        "test-execution-arn",
        "next-marker",
      );
    } catch (_error) {
      // Expected to throw
    }

    // Verify error was logged
    expect(logSpy).toHaveBeenCalledWith(
      "❌",
      "GetDurableExecutionState failed",
      expect.objectContaining({
        requestId: "test-request-id-123",
        DurableExecutionArn: "test-execution-arn",
      }),
    );
  });

  test("should log checkpoint errors with request ID", async () => {
    // Setup mock error with AWS metadata
    const mockError = {
      message: "CheckpointDurableExecution failed",
      $metadata: { requestId: "test-request-id-456" },
    };
    mockLambdaClient.send.mockRejectedValue(mockError);

    const checkpointData: CheckpointDurableExecutionRequest = {
      DurableExecutionArn: "test-execution-arn-2",
      CheckpointToken: "",
      Updates: [],
    };

    // Call checkpoint and expect it to throw
    try {
      await apiStorage.checkpoint("checkpoint-token", checkpointData);
    } catch (_error) {
      // Expected to throw
    }

    // Verify error was logged
    expect(logSpy).toHaveBeenCalledWith(
      "❌",
      "CheckpointDurableExecution failed",
      expect.objectContaining({
        requestId: "test-request-id-456",
        DurableExecutionArn: "test-execution-arn-2",
      }),
    );
  });

  test("should handle errors without request ID metadata", async () => {
    // Setup mock error without metadata
    const mockError = new Error("Network error");
    mockLambdaClient.send.mockRejectedValue(mockError);

    // Call getStepData and expect it to throw
    await expect(
      apiStorage.getStepData(
        "checkpoint-token",
        "test-execution-arn",
        "next-marker",
      ),
    ).rejects.toThrow("Network error");

    // Verify error was logged
    expect(logSpy).toHaveBeenCalledWith(
      "❌",
      "GetDurableExecutionState failed",
      expect.objectContaining({
        requestId: undefined,
        DurableExecutionArn: "test-execution-arn",
      }),
    );
  });

  test("should log getStepData errors to developer logger when provided", async () => {
    const mockError = {
      message: "GetDurableExecutionState failed",
      $metadata: { requestId: "test-request-id-789" },
    };
    mockLambdaClient.send.mockRejectedValue(mockError);

    const mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    try {
      await apiStorage.getStepData(
        "checkpoint-token",
        "test-execution-arn",
        "next-marker",
        mockLogger,
      );
    } catch (_error) {
      // Expected to throw
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to get durable execution state",
      mockError,
      { requestId: "test-request-id-789" },
    );
  });

  test("should log checkpoint errors to developer logger when provided", async () => {
    const mockError = {
      message: "CheckpointDurableExecution failed",
      $metadata: { requestId: "test-request-id-999" },
    };
    mockLambdaClient.send.mockRejectedValue(mockError);

    const mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    const checkpointData: CheckpointDurableExecutionRequest = {
      DurableExecutionArn: "test-execution-arn",
      CheckpointToken: "",
      Updates: [],
    };

    try {
      await apiStorage.checkpoint(
        "checkpoint-token",
        checkpointData,
        mockLogger,
      );
    } catch (_error) {
      // Expected to throw
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to checkpoint durable execution",
      mockError,
      { requestId: "test-request-id-999" },
    );
  });
});
