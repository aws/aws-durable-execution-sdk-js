import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  LambdaClient,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "../types";
import { log } from "../utils/logger/logger";
import { DurableExecutionApiClient } from "./durable-execution-api-client";
import { DurableExecutionClient } from "../types/durable-execution";

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
  let logSpy: jest.MockedFunction<typeof log>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mocked log function
    logSpy = log as jest.MockedFunction<typeof log>;
  });

  test("should create default LambdaClient with correct configuration when no client is passed", () => {
    // Create ApiStorage without passing a client (should use default)
    new DurableExecutionApiClient();

    // Verify that LambdaClient was constructed with the correct default configuration
    expect(LambdaClient).toHaveBeenCalledWith({
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 50000,
        requestTimeout: 55000,
        throwOnRequestTimeout: true,
      },
    });
  });

  test("should not create LambdaClient when custom client is passed", () => {
    // Clear mocks to reset call counts
    jest.clearAllMocks();

    const customClient = { send: jest.fn() };

    // Create ApiStorage with custom client (should not call LambdaClient constructor)
    new DurableExecutionApiClient(customClient as any);

    // Verify that LambdaClient constructor was not called
    expect(LambdaClient).not.toHaveBeenCalled();
  });

  // Test client configurations for describe.each
  const clientConfigurations = [
    {
      name: "default LambdaClient",
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      setup: () => {
        // Create a fresh mock client for this test
        const mockLambdaClient = { send: jest.fn() };

        // Mock the LambdaClient constructor to return our mock when called
        (LambdaClient as jest.Mock).mockImplementation(() => mockLambdaClient);

        // Create the API client - it will use either the cached client or create a new one
        const apiStorage = new DurableExecutionApiClient();

        // We need to access the actual client being used by the apiStorage instance
        // Since the client might be cached, we need to replace the send method on the actual client
        const actualClient = (apiStorage as any).client;
        if (actualClient && actualClient.send) {
          actualClient.send = mockLambdaClient.send;
        }

        return {
          apiStorage,
          mockClient: mockLambdaClient,
          isCustomClient: false,
        };
      },
    },
    {
      name: "custom LambdaClient",
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      setup: () => {
        const customMockClient = { send: jest.fn() };
        return {
          apiStorage: new DurableExecutionApiClient(customMockClient as any),
          mockClient: customMockClient,
          isCustomClient: true,
        };
      },
    },
  ];

  // Using describe.each to create separate describe blocks for each client type
  describe.each(clientConfigurations)("Testing with %s", ({ setup }) => {
    let apiStorage: DurableExecutionClient;
    let mockClient: { send: jest.Mock };

    beforeEach(() => {
      const clientSetup = setup();
      apiStorage = clientSetup.apiStorage;
      mockClient = clientSetup.mockClient;
    });

    test("should call getExecutionState with correct parameters", async () => {
      // Setup mock response
      const mockResponse = { _stepData: [] };
      mockClient.send.mockResolvedValue(mockResponse);

      // Call getExecutionState
      const result = await apiStorage.getExecutionState({
        CheckpointToken: "checkpoint-token",
        DurableExecutionArn: "durable-execution-arn",
        Marker: "next-marker",
        MaxItems: 1000,
      });

      // Verify that GetDurableExecutionStateCommand was constructed with the correct parameters
      expect(GetDurableExecutionStateCommand).toHaveBeenCalledWith({
        DurableExecutionArn: "durable-execution-arn",
        CheckpointToken: "checkpoint-token",
        Marker: "next-marker",
        MaxItems: 1000,
      });

      // Verify that send was called with the GetDurableExecutionStateCommand
      expect(mockClient.send).toHaveBeenCalledWith(
        expect.any(GetDurableExecutionStateCommand),
      );

      // Verify the result
      expect(result).toBe(mockResponse);
    });

    test("should call checkpoint with correct parameters", async () => {
      // Setup mock response
      const mockResponse = { taskToken: "new-task-token" };
      mockClient.send.mockResolvedValue(mockResponse);

      // Create checkpoint data
      const checkpointData: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: "test-durable-execution-arn",
        CheckpointToken: "task-token",
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
      const result = await apiStorage.checkpoint(checkpointData);

      // Verify that CheckpointDurableExecutionCommand was constructed with the correct parameters
      expect(CheckpointDurableExecutionCommand).toHaveBeenCalledWith({
        DurableExecutionArn: "test-durable-execution-arn",
        CheckpointToken: "task-token",
        Updates: checkpointData.Updates,
      });

      // Verify that send was called with the CheckpointDurableExecutionCommand
      expect(mockClient.send).toHaveBeenCalledWith(
        expect.any(CheckpointDurableExecutionCommand),
      );

      // Verify the result
      expect(result).toBe(mockResponse);
    });

    test("should propagate errors from client", async () => {
      // Setup mock error
      const mockError = new Error("Lambda client error");
      mockClient.send.mockRejectedValue(mockError);

      // Call getExecutionState and expect it to throw
      await expect(
        apiStorage.getExecutionState({
          CheckpointToken: "task-token",
          DurableExecutionArn: "durable-execution-arn",
          Marker: "next-token",
        }),
      ).rejects.toThrow("Lambda client error");

      // Call checkpoint and expect it to throw
      await expect(
        apiStorage.checkpoint({
          DurableExecutionArn: "",
          CheckpointToken: "task-token",
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

    test("should log getExecutionState errors with request ID", async () => {
      // Setup mock error with AWS metadata
      const mockError = {
        message: "GetDurableExecutionState failed",
        $metadata: { requestId: "test-request-id-123" },
      };
      mockClient.send.mockRejectedValue(mockError);

      // Call getExecutionState and expect it to throw
      try {
        await apiStorage.getExecutionState({
          CheckpointToken: "checkpoint-token",
          DurableExecutionArn: "test-execution-arn",
          Marker: "next-marker",
        });
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
      mockClient.send.mockRejectedValue(mockError);

      const checkpointData: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: "test-execution-arn-2",
        CheckpointToken: "checkpoint-token",
        Updates: [],
      };

      // Call checkpoint and expect it to throw
      try {
        await apiStorage.checkpoint(checkpointData);
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
      mockClient.send.mockRejectedValue(mockError);

      // Call getExecutionState and expect it to throw
      await expect(
        apiStorage.getExecutionState({
          CheckpointToken: "checkpoint-token",
          DurableExecutionArn: "test-execution-arn",
          Marker: "next-marker",
        }),
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

    test("should log getExecutionState errors to developer logger when provided", async () => {
      const mockError = {
        message: "GetDurableExecutionState failed",
        $metadata: { requestId: "test-request-id-789" },
      };
      mockClient.send.mockRejectedValue(mockError);

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
        configureDurableLoggingContext: jest.fn(),
      };

      try {
        await apiStorage.getExecutionState(
          {
            CheckpointToken: "checkpoint-token",
            DurableExecutionArn: "test-execution-arn",
            Marker: "next-marker",
          },
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
      mockClient.send.mockRejectedValue(mockError);

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
        configureDurableLoggingContext: jest.fn(),
      };

      const checkpointData: CheckpointDurableExecutionRequest = {
        DurableExecutionArn: "test-execution-arn",
        CheckpointToken: "checkpoint-token",
        Updates: [],
      };

      try {
        await apiStorage.checkpoint(checkpointData, mockLogger);
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
});
