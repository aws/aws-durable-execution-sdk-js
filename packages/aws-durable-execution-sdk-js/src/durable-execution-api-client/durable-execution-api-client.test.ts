import {
  vi,
  describe,
  test,
  expect,
  beforeEach,
  type MockedFunction,
  type Mock,
} from "vitest";
import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  GetDurableExecutionStateCommand,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { OperationSubType } from "../types";
import { log } from "../utils/logger/logger";
import { DurableExecutionApiClient } from "./durable-execution-api-client";
import { resolveDefaultLambdaClient } from "./lambda-module";
import { DurableExecutionClient } from "../types/durable-execution";

// Mock the logger
vi.mock("../utils/logger/logger", () => ({
  log: vi.fn(),
}));

describe("ApiStorage", () => {
  let logSpy: MockedFunction<typeof log>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get the mocked log function
    logSpy = log as MockedFunction<typeof log>;
  });

  // Test client configurations for describe.each
  const clientConfigurations = [
    {
      name: "default LambdaClient",
      setup: async () => {
        // Create a fresh mock client for this test
        const mockLambdaClient = { send: vi.fn() };

        // Create the API client without a client, so it uses the default client
        const apiStorage = new DurableExecutionApiClient();

        // The default client is a real LambdaClient. It is created on first use and
        // cached at module scope. So resolve it through the loader and redirect its send
        // method at this test's mock. Then no request leaves the process. Going through
        // the loader rather than issuing a request keeps the assertions below from
        // seeing an extra call.
        const actualClient = await resolveDefaultLambdaClient();
        actualClient.send = mockLambdaClient.send;

        return {
          apiStorage,
          mockClient: mockLambdaClient,
          isCustomClient: false,
        };
      },
    },
    {
      name: "custom LambdaClient",
      setup: async () => {
        const customMockClient = { send: vi.fn() };
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
    let mockClient: { send: Mock };

    beforeEach(async () => {
      const clientSetup = await setup();
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

      // Verify that send was called once with a GetDurableExecutionStateCommand
      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const [command] = mockClient.send.mock.calls[0];
      expect(command).toBeInstanceOf(GetDurableExecutionStateCommand);

      // Verify that the command was constructed with the correct parameters
      expect(command.input).toEqual({
        DurableExecutionArn: "durable-execution-arn",
        CheckpointToken: "checkpoint-token",
        Marker: "next-marker",
        MaxItems: 1000,
      });

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

      // Verify that send was called once with a CheckpointDurableExecutionCommand
      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const [command] = mockClient.send.mock.calls[0];
      expect(command).toBeInstanceOf(CheckpointDurableExecutionCommand);

      // Verify that the command was constructed with the correct parameters
      expect(command.input).toEqual({
        DurableExecutionArn: "test-durable-execution-arn",
        CheckpointToken: "task-token",
        Updates: checkpointData.Updates,
      });

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
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        configureDurableLoggingContext: vi.fn(),
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
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        configureDurableLoggingContext: vi.fn(),
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
