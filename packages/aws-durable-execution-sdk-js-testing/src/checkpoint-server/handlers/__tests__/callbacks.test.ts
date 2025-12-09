import {
  ErrorObject,
  OperationType,
  OperationAction,
} from "@aws-sdk/client-lambda";
import {
  processCallbackFailure,
  processCallbackSuccess,
  processCallbackHeartbeat,
} from "../callbacks";
import { ExecutionManager } from "../../storage/execution-manager";
import { CompleteCallbackStatus } from "../../storage/callback-manager";
import { CheckpointManager } from "../../storage/checkpoint-manager";
import {
  createExecutionId,
  createCallbackId,
  createInvocationId,
} from "../../utils/tagged-strings";

describe("callbacks handlers", () => {
  let executionManager: ExecutionManager;
  let mockExecutionId: ReturnType<typeof createExecutionId>;

  // Helper to create execution with callback
  const createExecutionWithCallback = (options?: {
    timeoutSeconds?: number;
    heartbeatTimeoutSeconds?: number;
  }) => {
    executionManager.startExecution({
      executionId: mockExecutionId,
      payload: '{"test": "data"}',
      invocationId: createInvocationId(),
    });

    const storage = executionManager.getCheckpointsByExecution(mockExecutionId);
    const operationId = `callback-${Date.now()}-${Math.random()}`;
    const callbackUpdate = {
      Id: operationId,
      Type: OperationType.CALLBACK,
      Action: OperationAction.START,
      CallbackOptions: {
        TimeoutSeconds: options?.timeoutSeconds,
        HeartbeatTimeoutSeconds: options?.heartbeatTimeoutSeconds,
      },
    };
    const operationEvents = storage!.registerUpdate(callbackUpdate);
    const callbackId = operationEvents.operation.CallbackDetails?.CallbackId;
    if (!callbackId) {
      throw new Error("Failed to create callback ID");
    }

    return { storage: storage!, callbackId, operationId };
  };

  beforeEach(() => {
    executionManager = new ExecutionManager();
    mockExecutionId = createExecutionId("test-execution-id");
  });

  afterEach(() => {
    executionManager.cleanup();
  });

  describe("processCallbackFailure", () => {
    it("should look up storage by callback ID and complete callback with error", () => {
      const { storage, callbackId } = createExecutionWithCallback();

      // Spy on the key side effects
      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByCallbackId",
      );
      const completeCallbackSpy = jest.spyOn(storage, "completeCallback");

      const errorObject: ErrorObject = {
        ErrorType: "TestError",
        ErrorMessage: "Test error message",
        StackTrace: ["line1", "line2"],
      };

      const result = processCallbackFailure(
        callbackId,
        errorObject,
        executionManager,
      );

      // Verify the execution manager was asked to look up storage by callback ID
      expect(getStorageSpy).toHaveBeenCalledWith(createCallbackId(callbackId));

      // Verify storage was told to complete the callback with failure status
      expect(completeCallbackSpy).toHaveBeenCalledWith(
        {
          CallbackId: createCallbackId(callbackId),
          Error: errorObject,
        },
        CompleteCallbackStatus.FAILED,
      );

      expect(result).toEqual({});
    });

    it("should default to empty error object when input is undefined", () => {
      const { storage, callbackId } = createExecutionWithCallback();
      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByCallbackId",
      );
      const completeCallbackSpy = jest.spyOn(storage, "completeCallback");

      const result = processCallbackFailure(
        callbackId,
        undefined,
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(createCallbackId(callbackId));
      expect(completeCallbackSpy).toHaveBeenCalledWith(
        {
          CallbackId: createCallbackId(callbackId),
          Error: {},
        },
        CompleteCallbackStatus.FAILED,
      );

      expect(result).toEqual({});
    });

    it("should throw error when execution manager cannot find storage", () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByCallbackId")
        .mockReturnValue(undefined);

      const callbackIdParam = "non-existent-callback-id";

      expect(() => {
        processCallbackFailure(callbackIdParam, undefined, executionManager);
      }).toThrow("Execution not found");

      // Verify it attempted the lookup
      expect(getStorageSpy).toHaveBeenCalledWith(
        createCallbackId(callbackIdParam),
      );
    });
  });

  describe("processCallbackSuccess", () => {
    it("should look up storage and complete callback with converted buffer result", () => {
      const { storage, callbackId } = createExecutionWithCallback();

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByCallbackId",
      );
      const completeCallbackSpy = jest.spyOn(storage, "completeCallback");

      const result = processCallbackSuccess(
        callbackId,
        Buffer.from("test result data", "utf-8"),
        executionManager,
      );

      expect(getStorageSpy).toHaveBeenCalledWith(createCallbackId(callbackId));
      expect(completeCallbackSpy).toHaveBeenCalledWith(
        {
          CallbackId: createCallbackId(callbackId),
          Result: "test result data",
        },
        CompleteCallbackStatus.SUCCEEDED,
      );

      expect(result).toEqual({});
    });

    it.each([
      {
        name: "empty buffer",
        buffer: Buffer.alloc(0),
        expected: undefined,
      },
      {
        name: "Unicode characters",
        buffer: Buffer.from("Hello 🌍 World! 特殊文字", "utf-8"),
        expected: "Hello 🌍 World! 特殊文字",
      },
    ])("should handle $name in buffer conversion", ({ buffer, expected }) => {
      const { storage, callbackId } = createExecutionWithCallback();
      const completeCallbackSpy = jest.spyOn(storage, "completeCallback");

      const result = processCallbackSuccess(
        callbackId,
        buffer,
        executionManager,
      );

      expect(completeCallbackSpy).toHaveBeenCalledWith(
        { CallbackId: createCallbackId(callbackId), Result: expected },
        CompleteCallbackStatus.SUCCEEDED,
      );

      expect(result).toEqual({});
    });

    it("should validate buffer input and execution existence", () => {
      // Test execution manager lookup behavior for invalid buffer
      const mockStorage = {
        completeCallback: jest.fn(),
        heartbeatCallback: jest.fn(),
      } as Partial<CheckpointManager> as CheckpointManager;

      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByCallbackId")
        .mockReturnValue(mockStorage);

      expect(() => {
        processCallbackSuccess(
          "test-id",
          "not a buffer" as unknown as Buffer,
          executionManager,
        );
      }).toThrow("Invalid buffer input");

      // Should still attempt storage lookup even for invalid input
      expect(getStorageSpy).toHaveBeenCalledWith(createCallbackId("test-id"));

      // Test execution manager lookup behavior for non-existent execution
      getStorageSpy.mockReturnValue(undefined);
      expect(() => {
        processCallbackSuccess(
          "non-existent",
          Buffer.from("test"),
          executionManager,
        );
      }).toThrow("Execution not found");

      expect(getStorageSpy).toHaveBeenCalledWith(
        createCallbackId("non-existent"),
      );
    });
  });

  describe("processCallbackHeartbeat", () => {
    it("should look up storage and delegate heartbeat to storage", () => {
      const { storage, callbackId } = createExecutionWithCallback({
        heartbeatTimeoutSeconds: 60,
      });

      const getStorageSpy = jest.spyOn(
        executionManager,
        "getCheckpointsByCallbackId",
      );
      const heartbeatSpy = jest.spyOn(storage, "heartbeatCallback");

      const result = processCallbackHeartbeat(callbackId, executionManager);

      expect(getStorageSpy).toHaveBeenCalledWith(createCallbackId(callbackId));
      expect(heartbeatSpy).toHaveBeenCalledWith(createCallbackId(callbackId));

      expect(result).toEqual({});
    });

    it("should throw error when execution manager cannot find storage", () => {
      const getStorageSpy = jest
        .spyOn(executionManager, "getCheckpointsByCallbackId")
        .mockReturnValue(undefined);

      const callbackIdParam = "non-existent-callback-id";

      expect(() => {
        processCallbackHeartbeat(callbackIdParam, executionManager);
      }).toThrow("Execution not found");

      // Verify it attempted the lookup
      expect(getStorageSpy).toHaveBeenCalledWith(
        createCallbackId(callbackIdParam),
      );
    });
  });
});
