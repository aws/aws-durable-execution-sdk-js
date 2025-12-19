import {
  CallbackDetails,
  InvalidParameterValueException,
  OperationAction,
  OperationType,
} from "@aws-sdk/client-lambda";
import { CallbackManager, CompleteCallbackStatus } from "../callback-manager";
import { CheckpointManager } from "../checkpoint-manager";
import {
  createExecutionId,
  createCallbackId,
  ExecutionId,
  CallbackId,
} from "../../utils/tagged-strings";

// Mock the callback-id utilities
jest.mock("../../utils/callback-id", () => ({
  encodeCallbackId: jest.fn(),
  decodeCallbackId: jest.fn(),
}));

// Mock the tagged-strings utilities
jest.mock("../../utils/tagged-strings", () => ({
  createCallbackId: jest.fn((id: string) => id as CallbackId),
  createExecutionId: jest.fn((id: string) => id as ExecutionId),
}));

// Import the mocked functions
import { encodeCallbackId, decodeCallbackId } from "../../utils/callback-id";

describe("CallbackManager", () => {
  let callbackManager: CallbackManager;
  let mockCheckpointManager: CheckpointManager;
  const mockExecutionId = createExecutionId("test-execution-id");

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockCheckpointManager = new CheckpointManager(mockExecutionId);
    callbackManager = new CallbackManager(
      mockExecutionId,
      mockCheckpointManager,
    );

    // Setup default mock implementations
    (encodeCallbackId as jest.Mock).mockReturnValue("encoded-callback-id");
    (decodeCallbackId as jest.Mock).mockReturnValue({
      executionId: mockExecutionId,
      operationId: "test-operation-id",
      token: "test-token",
    });
  });

  afterEach(() => {
    callbackManager.cleanup();
    jest.useRealTimers();
  });

  describe("createCallback", () => {
    it("should create a callback ID and return it", () => {
      const operationId = "test-operation-id";

      const result = callbackManager.createCallback(operationId);

      expect(encodeCallbackId).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId,
      });
      expect(result).toBe("encoded-callback-id");
    });

    it("should create callback with timeout when timeoutSeconds is provided", () => {
      const operationId = "test-operation-id";
      const timeoutSeconds = 30;

      const result = callbackManager.createCallback(
        operationId,
        timeoutSeconds,
      );

      expect(result).toBe("encoded-callback-id");
      expect(encodeCallbackId).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId,
      });

      // Verify a timer was set (we can't directly test setTimeout without mocking it)
      // Instead we test the timeout functionality below
      expect(result).toBeDefined();
    });

    it("should create callback with heartbeat timeout when heartbeatTimeoutSeconds is provided", () => {
      const operationId = "test-operation-id";
      const heartbeatTimeoutSeconds = 60;

      const result = callbackManager.createCallback(
        operationId,
        undefined,
        heartbeatTimeoutSeconds,
      );

      expect(result).toBe("encoded-callback-id");
      expect(encodeCallbackId).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId,
      });
    });

    it("should create callback with both timeout values when both are provided", () => {
      const operationId = "test-operation-id";
      const timeoutSeconds = 30;
      const heartbeatTimeoutSeconds = 60;

      const result = callbackManager.createCallback(
        operationId,
        timeoutSeconds,
        heartbeatTimeoutSeconds,
      );

      expect(result).toBe("encoded-callback-id");
      expect(encodeCallbackId).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId,
      });
    });

    it("should create callback without timers when no timeout values are provided", () => {
      const operationId = "test-operation-id";

      const result = callbackManager.createCallback(operationId);

      expect(result).toBe("encoded-callback-id");
      expect(encodeCallbackId).toHaveBeenCalledWith({
        executionId: mockExecutionId,
        operationId,
      });
    });

    it("should call completeCallback with TIMED_OUT status when timeout triggers", () => {
      const operationId = "test-operation-id";
      const timeoutSeconds = 30;

      // Setup operation data
      mockCheckpointManager.registerUpdates([
        {
          Id: operationId,
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
      ]);

      // Spy on completeCallback
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );

      // Create callback with timeout
      callbackManager.createCallback(operationId, timeoutSeconds);

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(timeoutSeconds * 1000);

      // Verify completeCallback was called with TIMED_OUT status
      expect(completeCallbackSpy).toHaveBeenCalledWith(
        {
          CallbackId: "encoded-callback-id",
          Error: {
            ErrorMessage: "Callback timed out",
          },
        },
        CompleteCallbackStatus.TIMED_OUT,
      );
    });
  });

  describe("completeCallback", () => {
    beforeEach(() => {
      // Setup mock operation data
      mockCheckpointManager.registerUpdates([
        {
          Id: "test-operation-id",
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
      ]);
    });

    it("should throw error when CallbackId is missing", () => {
      const callbackDetails: CallbackDetails = {};

      expect(() => {
        callbackManager.completeCallback(
          callbackDetails,
          CompleteCallbackStatus.SUCCEEDED,
        );
      }).toThrow(InvalidParameterValueException);
    });

    it("should throw error when operation is not found", () => {
      const callbackDetails: CallbackDetails = {
        CallbackId: "test-callback-id",
      };

      mockCheckpointManager.cleanup();

      expect(() => {
        callbackManager.completeCallback(
          callbackDetails,
          CompleteCallbackStatus.SUCCEEDED,
        );
      }).toThrow(InvalidParameterValueException);
    });

    it("should complete callback successfully", () => {
      const callbackDetails: CallbackDetails = {
        CallbackId: "test-callback-id",
      };

      const result = callbackManager.completeCallback(
        callbackDetails,
        CompleteCallbackStatus.SUCCEEDED,
      );

      expect(createCallbackId).toHaveBeenCalledWith("test-callback-id");
      expect(decodeCallbackId).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.operation.Status).toBe(CompleteCallbackStatus.SUCCEEDED);
    });

    it("should clear timers when callback is completed", () => {
      const operationId = "test-operation-id";

      // Create callback with timeout first
      const callbackId = callbackManager.createCallback(operationId, 30);

      // Complete the callback - this should clear the timer
      const callbackDetails: CallbackDetails = {
        CallbackId: callbackId,
      };

      const result = callbackManager.completeCallback(
        callbackDetails,
        CompleteCallbackStatus.SUCCEEDED,
      );
      expect(result).toBeDefined();

      // Set up spy AFTER completing the callback to monitor if timer still fires
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );

      // Fast-forward time - timeout should not trigger since it was cleared
      jest.advanceTimersByTime(35 * 1000);

      // Verify completeCallback was not called again (timer was cleared)
      expect(completeCallbackSpy).not.toHaveBeenCalled();
    });

    it("should update operation data map with completed operation", () => {
      const callbackDetails: CallbackDetails = {
        CallbackId: "test-callback-id",
        Result: "test-result",
      };

      const result = callbackManager.completeCallback(
        callbackDetails,
        CompleteCallbackStatus.SUCCEEDED,
      );

      // Verify the correct structure with CallbackDetails property
      expect(result.operation.CallbackDetails).toEqual(callbackDetails);
    });

    it("should properly set CallbackDetails when completing callback", () => {
      const callbackDetails: CallbackDetails = {
        CallbackId: "test-callback-id",
        Result: "test-result",
      };

      const result = callbackManager.completeCallback(
        callbackDetails,
        CompleteCallbackStatus.SUCCEEDED,
      );

      expect(result.operation.CallbackDetails).toEqual(callbackDetails);
      expect(result.operation.Status).toBe(CompleteCallbackStatus.SUCCEEDED);
    });

    it("should handle callback details with error", () => {
      const errorObject = {
        ErrorMessage: "Test error message",
        ErrorType: "TestError",
      };

      const callbackDetails: CallbackDetails = {
        CallbackId: "test-callback-id",
        Error: errorObject,
      };

      const result = callbackManager.completeCallback(
        callbackDetails,
        CompleteCallbackStatus.FAILED,
      );

      expect(result.operation.CallbackDetails).toEqual(callbackDetails);
      expect(result.operation.Status).toBe(CompleteCallbackStatus.FAILED);
    });
  });

  describe("heartbeatCallback", () => {
    beforeEach(() => {
      mockCheckpointManager.registerUpdates([
        {
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
          Id: "test-operation-id",
          CallbackOptions: {
            HeartbeatTimeoutSeconds: 60,
          },
        },
      ]);
    });

    it("should throw error when operation is not found", () => {
      const callbackId = createCallbackId("test-callback-id");

      mockCheckpointManager.cleanup();

      expect(() => {
        callbackManager.heartbeatCallback(callbackId);
      }).toThrow("Could not find operation");
    });

    it("should throw error when operation does not require heartbeat", () => {
      const callbackId = createCallbackId("test-callback-id");

      mockCheckpointManager.cleanup();
      mockCheckpointManager.registerUpdates([
        {
          Id: "test-operation-id",
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
          CallbackOptions: {},
        },
      ]);

      expect(() => {
        callbackManager.heartbeatCallback(callbackId);
      }).toThrow("Could not find callback that requires heartbeat");
    });

    it("should reset heartbeat timer", () => {
      const callbackId = createCallbackId("test-callback-id");

      // Should not throw
      expect(() => {
        callbackManager.heartbeatCallback(callbackId);
      }).not.toThrow();
    });

    it("should trigger completeCallback with TIMED_OUT when heartbeat timer expires", () => {
      const operationId = "test-operation-id";
      const heartbeatTimeoutSeconds = 60;

      // Create callback with heartbeat timeout
      callbackManager.createCallback(
        operationId,
        undefined,
        heartbeatTimeoutSeconds,
      );

      // Spy on completeCallback
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );

      // Fast-forward time to trigger heartbeat timeout
      jest.advanceTimersByTime(heartbeatTimeoutSeconds * 1000);

      // Verify completeCallback was called with TIMED_OUT status
      expect(completeCallbackSpy).toHaveBeenCalledWith(
        {
          CallbackId: "encoded-callback-id",
          Error: {
            ErrorMessage: "Callback timed out on heartbeat",
          },
        },
        CompleteCallbackStatus.TIMED_OUT,
      );
    });
  });

  describe("cleanup", () => {
    it("should clear all timers and maps when cleanup is called", () => {
      const operationId1 = "operation-1";
      const operationId2 = "operation-2";

      // Setup mock operation data
      mockCheckpointManager.registerUpdates([
        {
          Id: operationId1,
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
        {
          Id: operationId2,
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
      ]);

      // Fix: Make encodeCallbackId return unique IDs for different operations
      (encodeCallbackId as jest.Mock).mockImplementation(({ operationId }) => {
        return `encoded-callback-${operationId}`;
      });

      // Fix: Make decodeCallbackId extract operationId from the encoded ID
      (decodeCallbackId as jest.Mock).mockImplementation(
        (callbackId: string) => {
          const operationId = callbackId.replace("encoded-callback-", "");
          return {
            executionId: mockExecutionId,
            operationId: operationId,
            token: "test-token",
          };
        },
      );

      // Spy on completeCallback BEFORE creating callbacks
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );

      // Create callbacks with different timeout configurations
      callbackManager.createCallback(operationId1, 30, 60); // both timeouts
      callbackManager.createCallback(operationId2, 45); // only regular timeout

      // Cleanup should not throw and should clear all timers
      expect(() => {
        callbackManager.cleanup();
      }).not.toThrow();

      // After cleanup, advance time to ensure no timers fire
      jest.advanceTimersByTime(100 * 1000);

      // Verify completeCallback was not called after cleanup
      expect(completeCallbackSpy).not.toHaveBeenCalled();
    });

    it("should handle cleanup when no timers exist", () => {
      expect(() => {
        callbackManager.cleanup();
      }).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete callback flow with timers", () => {
      const operationId = "integration-test-id";

      // Setup operation data
      mockCheckpointManager.registerUpdates([
        {
          Id: operationId,
          Action: OperationAction.START,
          Type: OperationType.CALLBACK,
        },
      ]);

      // Override decodeCallbackId for this test to return the correct operation ID
      (decodeCallbackId as jest.Mock).mockReturnValueOnce({
        executionId: mockExecutionId,
        operationId: operationId,
        token: "integration-token",
      });

      // Create callback with timeout
      const callbackId = callbackManager.createCallback(operationId, 30);
      expect(callbackId).toBeDefined();

      // Complete callback before timeout
      const result = callbackManager.completeCallback(
        { CallbackId: callbackId },
        CompleteCallbackStatus.SUCCEEDED,
      );

      // Verify the flow
      expect(result).toBeDefined();
      expect(result.operation.Status).toBe(CompleteCallbackStatus.SUCCEEDED);

      // Verify timeout doesn't trigger after completion
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );
      jest.advanceTimersByTime(35 * 1000);
      expect(completeCallbackSpy).not.toHaveBeenCalled();
    });

    it("should handle multiple callbacks independently", () => {
      const operationIds = ["op-1", "op-2", "op-3"];

      // Setup operation data for all
      operationIds.forEach((id) => {
        mockCheckpointManager.registerUpdates([
          {
            Id: id,
            Action: OperationAction.START,
            Type: OperationType.CALLBACK,
          },
        ]);
      });

      // Fix: Make each callback get a unique ID
      (encodeCallbackId as jest.Mock).mockImplementation(({ operationId }) => {
        return `encoded-callback-${operationId}`;
      });

      // Fix: Extract operationId from the encoded callback ID
      (decodeCallbackId as jest.Mock).mockImplementation(
        (callbackId: string) => {
          const operationId = callbackId.replace("encoded-callback-", "");
          return {
            executionId: mockExecutionId,
            operationId: operationId,
            token: `test-token-${operationId}`,
          };
        },
      );

      // Create multiple callbacks with different timeouts
      const callbackIds = [
        callbackManager.createCallback(operationIds[0], 10),
        callbackManager.createCallback(operationIds[1], 20),
        callbackManager.createCallback(operationIds[2], 30),
      ];

      expect(callbackIds).toHaveLength(3);
      callbackIds.forEach((id) => {
        expect(id).toBeDefined();
      });

      // Spy on completeCallback
      const completeCallbackSpy = jest.spyOn(
        callbackManager,
        "completeCallback",
      );

      // Advance time partially - only first callback should timeout
      jest.advanceTimersByTime(15 * 1000);
      expect(completeCallbackSpy).toHaveBeenCalledTimes(1);

      // Advance more - second callback should timeout
      jest.advanceTimersByTime(10 * 1000);
      expect(completeCallbackSpy).toHaveBeenCalledTimes(2);

      // Advance more - third callback should timeout
      jest.advanceTimersByTime(10 * 1000);
      expect(completeCallbackSpy).toHaveBeenCalledTimes(3);
    });
  });
});
