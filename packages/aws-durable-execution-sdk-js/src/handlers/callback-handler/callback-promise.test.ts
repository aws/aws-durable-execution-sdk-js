import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { createCallbackPromise } from "./callback-promise";
import { ExecutionContext, OperationLifecycleState } from "../../types";
import { OperationStatus } from "../../types/wire";
import {
  CallbackError,
  CallbackExternalError,
  CallbackTimeoutError,
} from "../../errors/durable-error/durable-error";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";

describe("createCallbackPromise", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockCheckAndUpdateReplayMode: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      getStepData: vi.fn(),
      terminationManager: {
        terminate: vi.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpoint = {
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
    } as any;

    mockCheckAndUpdateReplayMode = vi.fn();
  });

  it("should handle succeeded callback with callback ID", async () => {
    const mockSerdes = {
      deserialize: vi.fn().mockResolvedValue("deserialized-result"),
    };

    (mockContext.getStepData as Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: {
        CallbackId: "callback-123",
        Result: "serialized-result",
      },
    });

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
    expect(mockSerdes.deserialize).toHaveBeenCalledWith("serialized-result", {
      entityId: "test-step-id",
      durableExecutionArn: "test-arn",
    });
    expect(mockCheckAndUpdateReplayMode).toHaveBeenCalled();
  });

  it("keeps the callback EXECUTING until its result is deserialized", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: {
        CallbackId: "callback-123",
        Result: "serialized-result",
      },
    });

    // Record the lifecycle calls made before deserialization finishes.
    let callsDuringDeserialize: unknown[][] = [];
    const recordingSerdes = {
      deserialize: vi.fn(async () => {
        callsDuringDeserialize = [
          ...(mockCheckpoint.markOperationState as Mock).mock.calls,
        ];
        return "deserialized-result";
      }),
    };

    await createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      recordingSerdes,
      mockCheckAndUpdateReplayMode,
    );

    expect(callsDuringDeserialize).toEqual([
      ["test-step-id", OperationLifecycleState.EXECUTING, undefined],
    ]);
    expect((mockCheckpoint.markOperationState as Mock).mock.calls).toEqual([
      ["test-step-id", OperationLifecycleState.EXECUTING, undefined],
      ["test-step-id", OperationLifecycleState.COMPLETED],
    ]);
  });

  it("should throw error when callback data is missing", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: undefined,
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: vi.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow(
      "No callback data found for completed callback: test-step-id",
    );
  });

  it("should handle failed callback with error details", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
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
      { deserialize: vi.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackExternalError);

    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(CallbackExternalError);
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
    (mockContext.getStepData as Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.FAILED,
      CallbackDetails: {},
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: vi.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackExternalError);
    await expect(promise).rejects.toThrow("Callback failed");
  });

  it("should handle timed out callback", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Id: "test-id",
      Status: OperationStatus.TIMED_OUT,
      CallbackDetails: {},
    });

    const promise = createCallbackPromise(
      mockContext,
      mockCheckpoint,
      "test-step-id",
      "test-step",
      { deserialize: vi.fn() },
      mockCheckAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackTimeoutError);
    await expect(promise).rejects.toThrow("Callback timed out");
    // CallbackTimeoutError is part of the CallbackError hierarchy
    await expect(promise).rejects.toThrow(CallbackError);
  });
});
