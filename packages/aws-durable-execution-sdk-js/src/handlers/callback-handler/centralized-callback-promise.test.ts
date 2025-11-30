import { createCentralizedCallbackPromise } from "./centralized-callback-promise";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { ExecutionContext } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";
import { CallbackError } from "../../errors/durable-error/durable-error";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

jest.mock("../../errors/serdes-errors/serdes-errors", () => ({
  safeDeserialize: jest.fn().mockResolvedValue("deserialized-result"),
}));

describe("CentralizedCallbackPromise", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let mockCheckpointManager: jest.Mocked<CentralizedCheckpointManager>;
  let mockSerdes: any;
  let checkAndUpdateReplayMode: jest.Mock;

  beforeEach(() => {
    mockContext = {
      getStepData: jest.fn(),
      terminationManager: {} as any,
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpointManager = {
      scheduleResume: jest.fn(),
    } as any;

    mockSerdes = {
      deserialize: jest.fn().mockReturnValue("test-result"),
    };

    checkAndUpdateReplayMode = jest.fn();
  });

  it("should return result for completed callback", async () => {
    mockContext.getStepData.mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: {
        CallbackId: "callback-123",
        Result: "serialized-result",
      },
    } as any);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    const result = await promise;

    expect(result).toBe("deserialized-result");
    expect(checkAndUpdateReplayMode).toHaveBeenCalled();
  });

  it("should throw error for completed callback without callback ID", async () => {
    mockContext.getStepData.mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      CallbackDetails: {},
    } as any);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow(
      "No callback ID found for completed callback",
    );
  });

  it("should throw error for failed callback", async () => {
    mockContext.getStepData.mockReturnValue({
      Status: OperationStatus.FAILED,
      CallbackDetails: {
        Error: {
          ErrorMessage: "Callback failed",
          ErrorType: "TestError",
          StackTrace: ["line1", "line2"],
        },
      },
    } as any);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow("Callback failed");
  });

  it("should schedule resume for missing step data", async () => {
    mockContext.getStepData.mockReturnValue(undefined);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    // Start the promise but don't await yet
    promise.then(() => {}).catch(() => {});

    // Wait for async execution
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCheckpointManager.scheduleResume).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: "test-step-id-callback-wait",
        metadata: expect.objectContaining({
          stepId: "test-step-id",
          stepName: "test-callback",
          reason: "waiting-for-callback-creation",
        }),
        resolve: expect.any(Function),
        reject: expect.any(Function),
      }),
    );
  });

  it("should schedule resume for pending callback", async () => {
    mockContext.getStepData.mockReturnValue({
      Status: OperationStatus.STARTED,
      CallbackDetails: {
        CallbackId: "callback-123",
      },
    } as any);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    // Start the promise but don't await yet
    promise.then(() => {}).catch(() => {});

    // Wait for async execution
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCheckpointManager.scheduleResume).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: "test-step-id-callback-pending",
        metadata: expect.objectContaining({
          stepId: "test-step-id",
          stepName: "test-callback",
          reason: "waiting-for-callback-completion",
        }),
        resolve: expect.any(Function),
        reject: expect.any(Function),
      }),
    );
  });

  it("should handle timed out callback", async () => {
    mockContext.getStepData.mockReturnValue({
      Status: OperationStatus.TIMED_OUT,
      CallbackDetails: {
        Error: {
          ErrorMessage: "Callback timed out",
        },
      },
    } as any);

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow("Callback timed out");
  });

  it("should throw error for unexpected status", async () => {
    mockContext.getStepData.mockReturnValue({
      Id: "test-step-id",
      Type: "CALLBACK" as any,
      StartTimestamp: new Date().toISOString(),
      Status: "UNKNOWN_STATUS" as any,
    });

    const promise = createCentralizedCallbackPromise(
      mockContext,
      mockCheckpointManager,
      "test-step-id",
      "test-callback",
      mockSerdes,
      "test message",
      checkAndUpdateReplayMode,
    );

    await expect(promise).rejects.toThrow(CallbackError);
    await expect(promise).rejects.toThrow(
      "Unexpected callback status: UNKNOWN_STATUS",
    );
  });
});
