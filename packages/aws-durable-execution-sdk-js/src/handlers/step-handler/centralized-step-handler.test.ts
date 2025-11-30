import { createCentralizedStepHandler } from "./centralized-step-handler";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { ExecutionContext, StepSemantics } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

jest.mock("../../utils/replay-validation/replay-validation", () => ({
  validateReplayConsistency: jest.fn(),
}));

jest.mock("../../utils/serdes/serdes", () => ({
  defaultSerdes: {
    serialize: jest.fn((value) => JSON.stringify(value)),
    deserialize: jest.fn((value) => JSON.parse(value)),
  },
}));

jest.mock("../../utils/retry/retry-presets/retry-presets", () => ({
  retryPresets: {
    default: {
      maxAttempts: 3,
      shouldRetry: jest.fn((error, attempt) => ({
        shouldRetry: attempt < 3,
        delayMs: 1000,
      })),
    },
  },
}));

jest.mock("../../utils/error-object/error-object", () => ({
  createErrorObjectFromError: jest.fn((error) => ({ message: error.message })),
}));

describe("CentralizedStepHandler", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let mockCheckpointManager: jest.Mocked<CentralizedCheckpointManager>;
  let createStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;
  let stepHandler: ReturnType<typeof createCentralizedStepHandler>;

  beforeEach(() => {
    mockContext = {
      getStepData: jest.fn(),
    } as any;

    mockCheckpointManager = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      scheduleResume: jest.fn(),
    } as any;

    createStepId = jest.fn(() => "test-step-id");
    checkAndUpdateReplayMode = jest.fn();

    stepHandler = createCentralizedStepHandler(
      mockContext,
      mockCheckpointManager,
      {} as any, // parentContext
      createStepId,
      "parent-id",
      checkAndUpdateReplayMode,
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return immediately if step already completed", async () => {
    mockContext.getStepData.mockReturnValue({
      Id: "test-step-id",
      Type: "STEP",
      StartTimestamp: Date.now(),
      Status: OperationStatus.SUCCEEDED,
      Result: '"test result"',
    } as any);

    const stepFunc = jest.fn().mockResolvedValue("should not be called");
    const promise = stepHandler("test-step", stepFunc);
    const result = await promise;

    expect(result).toBe("test result");
    expect(stepFunc).not.toHaveBeenCalled();
    expect(checkAndUpdateReplayMode).toHaveBeenCalled();
  });

  it("should checkpoint START for new step", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const stepFunc = jest.fn().mockResolvedValue("test result");

    const promise = stepHandler("test-step", stepFunc);
    await promise;

    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "START",
        SubType: "STEP",
        Type: "STEP",
        Name: "test-step",
      },
    );
  });

  it("should execute step function and checkpoint success", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const stepFunc = jest.fn().mockResolvedValue("test result");

    const promise = stepHandler("test-step", stepFunc);
    const result = await promise;

    expect(stepFunc).toHaveBeenCalled();
    expect(result).toBe("test result");

    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "SUCCEED",
        Result: '"test result"',
      },
    );
  });

  it("should handle step failure without retry", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const error = new Error("Step failed");
    const stepFunc = jest.fn().mockRejectedValue(error);

    // Mock retry strategy to not retry
    const {
      retryPresets,
    } = require("../../utils/retry/retry-presets/retry-presets");
    retryPresets.default.shouldRetry.mockReturnValue({ shouldRetry: false });

    const promise = stepHandler("test-step", stepFunc);

    await expect(promise).rejects.toThrow("Step failed");

    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "FAIL",
        Error: { message: "Step failed" },
      },
    );
  });

  it("should handle retry with centralized scheduling", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const error = new Error("Step failed");
    const stepFunc = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("success on retry");

    // Mock retry strategy to retry once
    const {
      retryPresets,
    } = require("../../utils/retry/retry-presets/retry-presets");
    retryPresets.default.shouldRetry
      .mockReturnValueOnce({ shouldRetry: true, delayMs: 1000 })
      .mockReturnValueOnce({ shouldRetry: false });

    // Mock scheduleResume to immediately resolve
    mockCheckpointManager.scheduleResume.mockImplementation(
      (handlerId, resolve, reject, scheduledTime) => {
        setTimeout(() => resolve(undefined), 0);
      },
    );

    const promise = stepHandler("test-step", stepFunc);
    const result = await promise;

    expect(result).toBe("success on retry");
    expect(stepFunc).toHaveBeenCalledTimes(2);

    // Should checkpoint retry
    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "RETRY",
        NextAttemptTimestamp: expect.any(Number),
        AttemptNumber: 1,
      },
    );

    // Should schedule resume
    expect(mockCheckpointManager.scheduleResume).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: "test-step-id-retry-1",
        scheduledTime: expect.any(Number),
        metadata: expect.objectContaining({
          stepId: "test-step-id",
          name: "test-step",
          attempt: 1,
          retryDelay: 1000,
        }),
      }),
    );
  });

  it("should use AtLeastOncePerRetry semantics", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const stepFunc = jest.fn().mockResolvedValue("test result");

    const promise = stepHandler("test-step", stepFunc, {
      semantics: StepSemantics.AtLeastOncePerRetry,
    });

    await promise;

    // Should fire-and-forget checkpoint (not wait for completion)
    expect(mockCheckpointManager.checkpoint).toHaveBeenCalled();
  });

  it("should use custom retry strategy", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const error = new Error("Step failed");
    const stepFunc = jest.fn().mockRejectedValue(error);

    const customRetry = jest.fn().mockReturnValue({ shouldRetry: false });

    const promise = stepHandler("test-step", stepFunc, {
      retryStrategy: customRetry,
    });

    await expect(promise).rejects.toThrow("Step failed");
    expect(customRetry).toHaveBeenCalledWith(error, 1);
  });
});
