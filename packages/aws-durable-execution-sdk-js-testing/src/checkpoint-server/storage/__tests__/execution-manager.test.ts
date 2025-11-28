import { randomUUID } from "node:crypto";
import {
  OperationStatus,
  OperationType,
  EventType,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { ExecutionManager, StartExecutionParams } from "../execution-manager";
import { CheckpointManager } from "../checkpoint-manager";
import {
  encodeCheckpointToken,
  decodeCheckpointToken,
  CheckpointTokenData,
} from "../../utils/checkpoint-token";
import { CheckpointToken } from "../../utils/tagged-strings";
import {
  createExecutionId,
  createInvocationId,
  createCallbackId,
} from "../../utils/tagged-strings";
import { decodeCallbackId } from "../../utils/callback-id";

// Mock dependencies
jest.mock("node:crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mocked-uuid"),
}));

// Mock the callback-id utilities
jest.mock("../../utils/callback-id", () => ({
  decodeCallbackId: jest.fn(),
}));

// Mock the checkpoint-token functions
jest.mock("../../utils/checkpoint-token", () => {
  const original = jest.requireActual<
    typeof import("../../utils/checkpoint-token")
  >("../../utils/checkpoint-token");
  return {
    ...original,
    encodeCheckpointToken: jest
      .fn()
      .mockImplementation(
        (data): CheckpointToken =>
          `encoded-${JSON.stringify(data)}` as CheckpointToken,
      ),
    decodeCheckpointToken: jest
      .fn()
      .mockImplementation((token: string): CheckpointTokenData => {
        if (token === "invalid-token") {
          throw new Error("Invalid token");
        }
        const parts = token.split("-");
        if (parts[0] !== "encoded") {
          throw new Error("Token not properly encoded");
        }
        try {
          return JSON.parse(parts[1]) as CheckpointTokenData;
        } catch {
          throw new Error("Failed to parse token data");
        }
      }),
  };
});

describe("execution-manager", () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("createExecutionId", () => {
    it("should return the provided string as ExecutionId if a string is provided", () => {
      const testId = "test-execution-id";
      const result = createExecutionId(testId);

      expect(result).toBe(testId);
      expect(randomUUID).not.toHaveBeenCalled();
    });

    it("should create a new UUID if no string is provided", () => {
      const result = createExecutionId();

      expect(result).toBe("mocked-uuid");
      expect(randomUUID).toHaveBeenCalledTimes(1);
    });
  });

  describe("createInvocationId", () => {
    it("should return the provided string as InvocationId if a string is provided", () => {
      const testId = "test-invocation-id";
      const result = createInvocationId(testId);

      expect(result).toBe(testId);
      expect(randomUUID).not.toHaveBeenCalled();
    });

    it("should create a new UUID if no string is provided", () => {
      const result = createInvocationId();

      expect(result).toBe("mocked-uuid");
      expect(randomUUID).toHaveBeenCalledTimes(1);
    });
  });

  describe("ExecutionManager", () => {
    let executionManager: ExecutionManager;

    beforeEach(() => {
      executionManager = new ExecutionManager();
      (randomUUID as jest.Mock).mockReturnValue("mocked-uuid");
    });

    describe("startExecution", () => {
      it("should create a new execution with the provided parameters", () => {
        // Test data
        const executionId = createExecutionId("test-execution-id");
        const params: StartExecutionParams = {
          executionId,
          payload: '{"key":"value"}',
        };

        // Expected mock operation with properly typed id
        const mockInitialOperation = {
          Id: "mocked-uuid",
          Type: OperationType.EXECUTION,
          Status: OperationStatus.STARTED,
          ExecutionDetails: {
            InputPayload: '{"key":"value"}',
          },
          StartTimestamp: new Date(),
        };

        // Mock the initialize method of CheckpointStorage
        const initializeSpy = jest
          .spyOn(CheckpointManager.prototype, "initialize")
          .mockReturnValue({
            operation: mockInitialOperation,
            events: [],
          });

        // Call the method
        const result = executionManager.startExecution(params);

        // Verify results
        expect(result).toEqual({
          checkpointToken: `encoded-{"executionId":"test-execution-id","token":"mocked-uuid","invocationId":"mocked-uuid"}`,
          executionId,
          invocationId: "mocked-uuid",
          operationEvents: [
            {
              operation: mockInitialOperation,
              events: [],
            },
          ],
        });

        // Verify CheckpointStorage was initialized with correct payload
        expect(initializeSpy).toHaveBeenCalledWith('{"key":"value"}');

        // Verify the execution was stored in the manager
        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();
      });

      it("should create a new execution with default payload when not provided", () => {
        const executionId = createExecutionId("test-execution-id");
        const params: StartExecutionParams = {
          executionId,
        };

        const initializeSpy = jest.spyOn(
          CheckpointManager.prototype,
          "initialize",
        );

        executionManager.startExecution(params);

        // Default payload should be used
        expect(initializeSpy).toHaveBeenCalledWith(undefined);
      });
    });

    describe("startInvocation", () => {
      it("should throw error if execution ID doesn't exist", () => {
        const nonExistentId = createExecutionId("non-existent");

        expect(() => executionManager.startInvocation(nonExistentId)).toThrow(
          "Could not start invocation for invalid execution non-existent",
        );
      });

      it("should start a new invocation for an existing execution", () => {
        // First create an execution
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        // Reset mocks to track new calls
        jest.clearAllMocks();
        (randomUUID as jest.Mock).mockReturnValue("new-invocation-uuid");

        // Start a new invocation
        const result = executionManager.startInvocation(executionId);

        expect(result).toBeDefined();
        expect(result.executionId).toBe(executionId);
        expect(result.invocationId).toBe("new-invocation-uuid");
        expect(result.operationEvents).toBeInstanceOf(Array);
        expect(encodeCheckpointToken).toHaveBeenCalledWith({
          executionId,
          token: "new-invocation-uuid",
          invocationId: "new-invocation-uuid",
        });
      });

      it("should include all operations from the checkpoint storage", () => {
        // Create an execution with a mock operation
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        // Get the storage and add some operations to it
        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();

        // Set up some mock operations in the storage with valid UUID format IDs
        const mockOps = [
          {
            Id: "11111111-1111-1111-1111-111111111111" as `${string}-${string}-${string}-${string}-${string}`,
            Status: OperationStatus.STARTED,
            Type: OperationType.STEP,
          },
          {
            Id: "22222222-2222-2222-2222-222222222222" as `${string}-${string}-${string}-${string}-${string}`,
            Status: OperationStatus.SUCCEEDED,
            Type: OperationType.WAIT,
          },
        ];

        // Mock the operationDataMap getter - using non-null assertion because we've verified storage exists
        Object.defineProperty(storage!, "operationDataMap", {
          get: jest.fn().mockReturnValue(
            new Map([
              ["op1", { operation: mockOps[0], update: {} }],
              ["op2", { operation: mockOps[1], update: {} }],
            ]),
          ),
        });

        // Start a new invocation
        const result = executionManager.startInvocation(executionId);

        // Check that we got all operations
        expect(result.operationEvents).toHaveLength(2);
        expect(result.operationEvents[0]).toEqual({
          operation: mockOps[0],
          update: {},
        });
        expect(result.operationEvents[1]).toEqual({
          operation: mockOps[1],
          update: {},
        });
      });

      it("should throw error if execution is completed already", () => {
        // First create an execution
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        jest
          .spyOn(CheckpointManager.prototype, "isExecutionCompleted")
          .mockReturnValue(true);

        expect(() => executionManager.startInvocation(executionId)).toThrow(
          `Could not start invocation for completed execution ${executionId}`,
        );
      });
    });

    describe("getCheckpointsByExecution", () => {
      it("should return undefined for non-existent execution ID", () => {
        const result = executionManager.getCheckpointsByExecution(
          createExecutionId("non-existent"),
        );
        expect(result).toBeUndefined();
      });

      it("should return the checkpoint storage for an existing execution ID", () => {
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        const storage = executionManager.getCheckpointsByExecution(executionId);

        expect(storage).toBeInstanceOf(CheckpointManager);
      });
    });

    describe("getCheckpointsByToken", () => {
      it("should return undefined for non-existent execution ID in token", () => {
        // Mock decodeCheckpointToken to return a token with non-existent execution ID
        (decodeCheckpointToken as jest.Mock).mockReturnValueOnce({
          executionId: createExecutionId("non-existent"),
          invocationId: createInvocationId("test-invocation"),
          token: "test-token",
        });

        const result = executionManager.getCheckpointsByToken(
          "valid-token" as CheckpointToken,
        );

        expect(result).toBeUndefined();
      });

      it("should return undefined when token decoding fails", () => {
        const result = executionManager.getCheckpointsByToken(
          "invalid-token" as CheckpointToken,
        );

        expect(result).toBeUndefined();
      });

      it("should return storage and token data for a valid token", () => {
        // Create an execution
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        // Create token data that references the execution
        const tokenData: CheckpointTokenData = {
          executionId,
          invocationId: createInvocationId("test-invocation"),
          token: "test-token",
        };

        // Mock decodeCheckpointToken to return our token data
        (decodeCheckpointToken as jest.Mock).mockReturnValueOnce(tokenData);

        // Get checkpoints by token
        const result = executionManager.getCheckpointsByToken(
          "valid-token" as CheckpointToken,
        );

        expect(result).toBeDefined();
        expect(result?.data).toBe(tokenData);
        expect(result?.storage).toBeInstanceOf(CheckpointManager);
      });
    });

    describe("getCheckpointsByCallbackId", () => {
      it("should return undefined when callback ID decoding fails", () => {
        const callbackId = createCallbackId("invalid-callback-id");

        // Mock decodeCallbackId to throw an error
        (decodeCallbackId as jest.Mock).mockImplementationOnce(() => {
          throw new Error("Invalid callback ID format");
        });

        const result = executionManager.getCheckpointsByCallbackId(callbackId);

        expect(result).toBeUndefined();
        expect(decodeCallbackId).toHaveBeenCalledWith(callbackId);
      });

      it("should return undefined for non-existent execution ID in callback", () => {
        const callbackId = createCallbackId("valid-callback-id");

        // Mock decodeCallbackId to return callback data with non-existent execution ID
        (decodeCallbackId as jest.Mock).mockReturnValueOnce({
          executionId: createExecutionId("non-existent-execution"),
          operationId: "test-operation-id",
          token: "test-token",
        });

        const result = executionManager.getCheckpointsByCallbackId(callbackId);

        expect(result).toBeUndefined();
        expect(decodeCallbackId).toHaveBeenCalledWith(callbackId);
      });

      it("should return CheckpointManager for valid callback ID with existing execution", () => {
        // Create an execution first
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        const callbackId = createCallbackId("valid-callback-id");

        // Mock decodeCallbackId to return callback data with existing execution ID
        (decodeCallbackId as jest.Mock).mockReturnValueOnce({
          executionId,
          operationId: "test-operation-id",
          token: "test-token",
        });

        const result = executionManager.getCheckpointsByCallbackId(callbackId);

        expect(result).toBeInstanceOf(CheckpointManager);
        expect(decodeCallbackId).toHaveBeenCalledWith(callbackId);
      });

      it("should return the same CheckpointManager instance as getCheckpointsByExecution", () => {
        // Create an execution first
        const executionId = createExecutionId("test-execution-id");
        executionManager.startExecution({ executionId });

        const callbackId = createCallbackId("valid-callback-id");

        // Mock decodeCallbackId to return callback data with existing execution ID
        (decodeCallbackId as jest.Mock).mockReturnValueOnce({
          executionId,
          operationId: "test-operation-id",
          token: "test-token",
        });

        const resultByCallback =
          executionManager.getCheckpointsByCallbackId(callbackId);
        const resultByExecution =
          executionManager.getCheckpointsByExecution(executionId);

        expect(resultByCallback).toBe(resultByExecution);
        expect(resultByCallback).toBeInstanceOf(CheckpointManager);
      });

      it("should handle malformed callback ID gracefully", () => {
        const callbackId = createCallbackId("malformed-callback-id");

        // Mock decodeCallbackId to throw a specific error
        (decodeCallbackId as jest.Mock).mockImplementationOnce(() => {
          throw new Error("Failed to decode CallbackIdData");
        });

        const result = executionManager.getCheckpointsByCallbackId(callbackId);

        expect(result).toBeUndefined();
        expect(decodeCallbackId).toHaveBeenCalledWith(callbackId);
      });
    });

    describe("completeInvocation", () => {
      it("should throw an error if execution ID doesn't exist", () => {
        const executionId = createExecutionId("non-existent-execution");
        const invocationId = createInvocationId("test-invocation");

        expect(() => {
          executionManager.completeInvocation(
            executionId,
            invocationId,
            undefined,
          );
        }).toThrow(`Execution not found for executionId="${executionId}"`);
      });

      it("should successfully complete invocation without error", () => {
        // Create an execution first
        const executionId = createExecutionId("test-execution-id");
        const invocationId = createInvocationId("test-invocation-id");
        executionManager.startExecution({ executionId });

        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();

        // Mock the completeInvocation method on CheckpointManager
        const mockTimestamps = {
          startTimestamp: new Date("2023-01-01T00:00:00.000Z"),
          endTimestamp: new Date("2023-01-01T00:01:00.000Z"),
        };

        const completeInvocationSpy = jest
          .spyOn(storage!, "completeInvocation")
          .mockReturnValue(mockTimestamps);

        // Mock the eventProcessor.createHistoryEvent method
        const mockHistoryEvent = {
          EventType: EventType.InvocationCompleted,
          Timestamp: new Date(),
          InvocationCompletedDetails: {
            StartTimestamp: mockTimestamps.startTimestamp,
            EndTimestamp: mockTimestamps.endTimestamp,
            Error: {
              Payload: undefined,
            },
            RequestId: invocationId,
          },
        };

        const createHistoryEventSpy = jest
          .spyOn(storage!.eventProcessor, "createHistoryEvent")
          .mockReturnValue(mockHistoryEvent);

        // Call the method
        const result = executionManager.completeInvocation(
          executionId,
          invocationId,
          undefined,
        );

        // Verify the result
        expect(result).toBe(mockHistoryEvent);

        // Verify CheckpointManager.completeInvocation was called
        expect(completeInvocationSpy).toHaveBeenCalledWith(invocationId);

        // Verify eventProcessor.createHistoryEvent was called with correct parameters
        expect(createHistoryEventSpy).toHaveBeenCalledWith(
          EventType.InvocationCompleted,
          undefined,
          "InvocationCompletedDetails",
          {
            StartTimestamp: mockTimestamps.startTimestamp,
            EndTimestamp: mockTimestamps.endTimestamp,
            Error: {
              Payload: undefined,
            },
            RequestId: invocationId,
          },
        );
      });

      it("should successfully complete invocation with error", () => {
        // Create an execution first
        const executionId = createExecutionId("test-execution-id");
        const invocationId = createInvocationId("test-invocation-id");
        executionManager.startExecution({ executionId });

        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();

        // Mock error object
        const errorObject: ErrorObject = {
          ErrorType: "TestError",
          ErrorMessage: "This is a test error",
          StackTrace: ["line1", "line2"],
        };

        // Mock the completeInvocation method on CheckpointManager
        const mockTimestamps = {
          startTimestamp: new Date("2023-01-01T00:00:00.000Z"),
          endTimestamp: new Date("2023-01-01T00:01:00.000Z"),
        };

        const completeInvocationSpy = jest
          .spyOn(storage!, "completeInvocation")
          .mockReturnValue(mockTimestamps);

        // Mock the eventProcessor.createHistoryEvent method
        const mockHistoryEvent = {
          EventType: EventType.InvocationCompleted,
          Timestamp: new Date(),
          InvocationCompletedDetails: {
            StartTimestamp: mockTimestamps.startTimestamp,
            EndTimestamp: mockTimestamps.endTimestamp,
            Error: {
              Payload: errorObject,
            },
            RequestId: invocationId,
          },
        };

        const createHistoryEventSpy = jest
          .spyOn(storage!.eventProcessor, "createHistoryEvent")
          .mockReturnValue(mockHistoryEvent);

        // Call the method
        const result = executionManager.completeInvocation(
          executionId,
          invocationId,
          errorObject,
        );

        // Verify the result
        expect(result).toBe(mockHistoryEvent);

        // Verify CheckpointManager.completeInvocation was called
        expect(completeInvocationSpy).toHaveBeenCalledWith(invocationId);

        // Verify eventProcessor.createHistoryEvent was called with correct parameters including error
        expect(createHistoryEventSpy).toHaveBeenCalledWith(
          EventType.InvocationCompleted,
          undefined,
          "InvocationCompletedDetails",
          {
            StartTimestamp: mockTimestamps.startTimestamp,
            EndTimestamp: mockTimestamps.endTimestamp,
            Error: {
              Payload: errorObject,
            },
            RequestId: invocationId,
          },
        );
      });

      it("should propagate errors from CheckpointManager.completeInvocation", () => {
        // Create an execution first
        const executionId = createExecutionId("test-execution-id");
        const invocationId = createInvocationId("test-invocation-id");
        executionManager.startExecution({ executionId });

        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();

        // Mock the completeInvocation method to throw an error
        const completeInvocationSpy = jest
          .spyOn(storage!, "completeInvocation")
          .mockImplementation(() => {
            throw new Error("Invocation completion failed");
          });

        // Call the method and expect it to throw
        expect(() => {
          executionManager.completeInvocation(
            executionId,
            invocationId,
            undefined,
          );
        }).toThrow("Invocation completion failed");

        // Verify CheckpointManager.completeInvocation was called
        expect(completeInvocationSpy).toHaveBeenCalledWith(invocationId);
      });
    });
  });
});
