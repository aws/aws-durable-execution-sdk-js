import { createCallbackPromise } from "./callback-promise";
import { ExecutionContext } from "../../types";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { EventEmitter } from "events";
import { waitBeforeContinue } from "../../utils/wait-before-continue/wait-before-continue";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";

// Mock dependencies
jest.mock("../../utils/wait-before-continue/wait-before-continue");
jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/logger/logger");

const mockWaitBeforeContinue = waitBeforeContinue as jest.MockedFunction<
  typeof waitBeforeContinue
>;
const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("createCallbackPromise", () => {
  let mockContext: ExecutionContext;
  let mockOperationsEmitter: EventEmitter;
  let mockCheckAndUpdateReplayMode: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      getStepData: jest.fn(),
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockOperationsEmitter = new EventEmitter();
    mockCheckAndUpdateReplayMode = jest.fn();
  });

  describe("uncovered scenarios", () => {
    it("should handle no step data with running operations", async () => {
      const hasRunningOperations = jest
        .fn()
        .mockReturnValueOnce(true) // First check: has running operations
        .mockReturnValueOnce(false); // After wait: no running operations

      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(null) // First call: no step data
        .mockReturnValueOnce(null); // Second call: still no step data

      // Mock termination manager to actually terminate
      const mockTerminate = jest.fn().mockImplementation(() => {
        throw new Error("test termination message");
      });
      mockContext.terminationManager.terminate = mockTerminate;

      mockWaitBeforeContinue.mockResolvedValue({
        reason: "operations",
        canTerminate: true,
      } as any);

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow("test termination message");
      expect(mockWaitBeforeContinue).toHaveBeenCalled();
      expect(mockTerminate).toHaveBeenCalledWith({
        message: "test termination message",
        reason: "CALLBACK_PENDING",
      });
    });

    it("should handle succeeded callback without callback ID", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.SUCCEEDED,
        CallbackDetails: {
          // Missing CallbackId
          Result: "test-result",
        },
      });

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow(CallbackError);
      await expect(promise).rejects.toThrow(
        "No callback ID found for completed callback: test-step-id",
      );
    });

    it("should handle succeeded callback with deserialization", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);
      const mockSerdes = { serialize: jest.fn(), deserialize: jest.fn() };

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.SUCCEEDED,
        CallbackDetails: {
          CallbackId: "callback-123",
          Result: "serialized-result",
        },
      });

      mockSafeDeserialize.mockResolvedValue("deserialized-result");

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        mockSerdes,
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      const result = await promise;

      expect(result).toBe("deserialized-result");
      expect(mockSafeDeserialize).toHaveBeenCalledWith(
        mockSerdes,
        "serialized-result",
        "test-step-id",
        "test-step",
        mockContext.terminationManager,
        mockContext.durableExecutionArn,
      );
      expect(mockCheckAndUpdateReplayMode).toHaveBeenCalled();
    });

    it("should handle failed callback with error details", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          Error: {
            ErrorMessage: "Custom error message",
            ErrorType: "CustomError",
            ErrorData: { custom: "data" },
            StackTrace: ["line1", "line2"],
          },
        },
      });

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow(CallbackError);

      try {
        await promise;
      } catch (error) {
        expect(error).toBeInstanceOf(CallbackError);
        expect((error as CallbackError).message).toBe("Custom error message");
        expect((error as CallbackError).cause?.name).toBe("CustomError");
        expect((error as CallbackError).cause?.stack).toBe("line1\nline2");
      }
    });

    it("should handle failed callback without error details", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.FAILED,
        CallbackDetails: {
          // No Error details
        },
      });

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow(CallbackError);
      await expect(promise).rejects.toThrow("Callback failed");
    });

    it("should handle timed out callback", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: OperationStatus.TIMED_OUT,
        CallbackDetails: {},
      });

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow(CallbackError);
      await expect(promise).rejects.toThrow("Callback failed");
    });

    it("should handle unexpected callback status", async () => {
      const hasRunningOperations = jest.fn().mockReturnValue(false);

      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Id: "test-id",
        Type: OperationType.CALLBACK,
        Status: "UNKNOWN_STATUS" as any,
        CallbackDetails: {},
      });

      const promise = createCallbackPromise(
        mockContext,
        "test-step-id",
        "test-step",
        { serialize: jest.fn(), deserialize: jest.fn() },
        hasRunningOperations,
        mockOperationsEmitter,
        "test termination message",
        mockCheckAndUpdateReplayMode,
      );

      await expect(promise).rejects.toThrow(CallbackError);
      await expect(promise).rejects.toThrow(
        "Unexpected callback status: UNKNOWN_STATUS",
      );
    });
  });
});
