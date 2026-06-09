import { createCallbackPromise } from "./callback-promise";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { CallbackError } from "../../errors/durable-error/durable-error";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { safeDeserialize } from "../../errors/serdes-errors/serdes-errors";

jest.mock("../../errors/serdes-errors/serdes-errors");
jest.mock("../../utils/logger/logger");

const mockSafeDeserialize = safeDeserialize as jest.MockedFunction<
  typeof safeDeserialize
>;

describe("createCallbackPromise", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
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

    mockCheckpoint = {
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
    } as any;

    mockCheckAndUpdateReplayMode = jest.fn();
  });

  it("should handle succeeded callback with callback ID", async () => {
    const mockSerdes = { deserialize: jest.fn() };

    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: {
        CallbackId: "callback-123",
        Result: "serialized-result",
      },
    });

    mockSafeDeserialize.mockResolvedValue("deserialized-result");

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      mockSerdes,
      mockCheckAndUpdateReplayMode,
    );

    const result = await promise;

    expect(result).toBe("deserialized-result");
    expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith(
      "test-step-id",
    );
    expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith(
      "test-step-id",
    );
    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "test-step-id",
      OperationLifecycleState.COMPLETED,
    );
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

  it("should throw error when callback data is missing", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: undefined,
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: jest.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow(
      "No callback data found for completed callback: test-step-id",
    );
  });

  it("should handle failed callback with error details", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: "test-id",
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
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: jest.fn() },
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

    expect(mockCheckpoint.markOperationState).toHaveBeenCalledWith(
      "test-step-id",
      OperationLifecycleState.COMPLETED,
    );
  });

  it("should handle failed callback without error details", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.FAILED,
      CallbackDetails: {},
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: jest.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow("Callback failed");
  });

  it("should handle timed out callback", async () => {
    (mockContext.getStepData as jest.Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.TIMED_OUT,
      CallbackDetails: {},
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: jest.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow("Callback failed");
  });
});
