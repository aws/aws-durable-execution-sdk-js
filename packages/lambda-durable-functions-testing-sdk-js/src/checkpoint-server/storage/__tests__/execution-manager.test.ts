import { randomUUID } from "node:crypto";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
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
          `encoded-${JSON.stringify(data)}` as CheckpointToken
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
        };

        // Mock the initialize method of CheckpointStorage
        const initializeSpy = jest
          .spyOn(CheckpointManager.prototype, "initialize")
          .mockReturnValue(mockInitialOperation);

        // Call the method
        const result = executionManager.startExecution(params);

        // Verify results
        expect(result).toEqual({
          checkpointToken: `encoded-{"executionId":"test-execution-id","token":"mocked-uuid","invocationId":"mocked-uuid"}`,
          executionId,
          invocationId: "mocked-uuid",
          operations: [mockInitialOperation],
        });

        // Verify CheckpointStorage was initialized with correct payload
        expect(initializeSpy).toHaveBeenCalledWith('{"key":"value"}');

        // Verify the execution was stored in the manager
        const storage = executionManager.getCheckpointsByExecution(executionId);
        expect(storage).toBeDefined();

        // Clean up
        initializeSpy.mockRestore();
      });

      it("should create a new execution with default payload when not provided", () => {
        const executionId = createExecutionId("test-execution-id");
        const params: StartExecutionParams = {
          executionId,
        };

        const initializeSpy = jest.spyOn(
          CheckpointManager.prototype,
          "initialize"
        );

        executionManager.startExecution(params);

        // Default payload should be used
        expect(initializeSpy).toHaveBeenCalledWith(undefined);

        initializeSpy.mockRestore();
      });
    });

    describe("startInvocation", () => {
      it("should return undefined if execution ID doesn't exist", () => {
        const nonExistentId = createExecutionId("non-existent");

        const result = executionManager.startInvocation(nonExistentId);

        expect(result).toBeUndefined();
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
        expect(result?.executionId).toBe(executionId);
        expect(result?.invocationId).toBe("new-invocation-uuid");
        expect(result?.operations).toBeInstanceOf(Array);
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
            ])
          ),
        });

        // Start a new invocation
        const result = executionManager.startInvocation(executionId);

        // Check that we got all operations
        expect(result?.operations).toHaveLength(2);
        expect(result?.operations[0]).toBe(mockOps[0]);
        expect(result?.operations[1]).toBe(mockOps[1]);
      });
    });

    describe("getCheckpointsByExecution", () => {
      it("should return undefined for non-existent execution ID", () => {
        const result = executionManager.getCheckpointsByExecution(
          createExecutionId("non-existent")
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
          "valid-token" as CheckpointToken
        );

        expect(result).toBeUndefined();
      });

      it("should return undefined when token decoding fails", () => {
        const result = executionManager.getCheckpointsByToken(
          "invalid-token" as CheckpointToken
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
          "valid-token" as CheckpointToken
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

        const resultByCallback = executionManager.getCheckpointsByCallbackId(callbackId);
        const resultByExecution = executionManager.getCheckpointsByExecution(executionId);

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
  });
});
