import { createCentralizedWaitHandler } from "./centralized-wait-handler";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { ExecutionContext } from "../../types";
import { OperationStatus } from "@aws-sdk/client-lambda";

// Mock dependencies
jest.mock("../../utils/logger/logger", () => ({
  log: jest.fn(),
}));

jest.mock("../../utils/replay-validation/replay-validation", () => ({
  validateReplayConsistency: jest.fn(),
}));

jest.mock("../../utils/duration/duration", () => ({
  durationToSeconds: jest.fn((duration) => {
    if (typeof duration === "number") return duration;
    if (duration.seconds) return duration.seconds;
    return 1;
  }),
}));

describe("CentralizedWaitHandler", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let mockCheckpointManager: jest.Mocked<CentralizedCheckpointManager>;
  let createStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;
  let waitHandler: ReturnType<typeof createCentralizedWaitHandler>;

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

    waitHandler = createCentralizedWaitHandler(
      mockContext,
      mockCheckpointManager,
      createStepId,
      "parent-id",
      checkAndUpdateReplayMode,
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should create wait handler with name and duration", () => {
    const promise = waitHandler("test-wait", { seconds: 5 });

    expect(promise).toBeDefined();
    expect(promise.handlerId).toBe("test-step-id");
  });

  it("should create wait handler with duration only", () => {
    const promise = waitHandler({ seconds: 3 });

    expect(promise).toBeDefined();
    expect(promise.handlerId).toBe("test-step-id");
  });

  it("should return immediately if wait already completed", async () => {
    mockContext.getStepData.mockReturnValue({
      Id: "test-step-id",
      Type: "WAIT",
      StartTimestamp: Date.now(),
      Status: OperationStatus.SUCCEEDED,
    } as any);

    const promise = waitHandler({ seconds: 5 });
    const result = await promise;

    expect(result).toBeUndefined();
    expect(checkAndUpdateReplayMode).toHaveBeenCalled();
    expect(mockCheckpointManager.scheduleResume).not.toHaveBeenCalled();
  });

  it("should checkpoint START for new wait", async () => {
    mockContext.getStepData.mockReturnValue(undefined);

    // Mock scheduleResume to immediately resolve
    mockCheckpointManager.scheduleResume.mockImplementation((resolver) => {
      setTimeout(() => resolver.resolve(undefined), 0);
    });

    const promise = waitHandler("test-wait", { seconds: 2 });

    // Start the promise execution
    const resultPromise = promise;

    // Fast forward to let checkpoint happen
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "START",
        SubType: "WAIT",
        Type: "WAIT",
        Name: "test-wait",
        WaitOptions: {
          WaitSeconds: 2,
        },
      },
    );
  });

  it("should schedule resume with checkpoint manager", async () => {
    mockContext.getStepData.mockReturnValue(undefined);

    const promise = waitHandler("test-wait", { seconds: 5 });

    // Start execution
    promise.then(() => {}).catch(() => {});

    // Wait for async execution
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCheckpointManager.scheduleResume).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: "test-step-id",
        scheduledTime: expect.any(Number),
        metadata: expect.objectContaining({
          name: "test-wait",
          seconds: 5,
        }),
        resolve: expect.any(Function),
        reject: expect.any(Function),
      }),
    );
  });

  it("should resolve when checkpoint manager calls resolver", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    let capturedResolver: any;

    mockCheckpointManager.scheduleResume.mockImplementation((resolver) => {
      capturedResolver = resolver;
    });

    const promise = waitHandler({ seconds: 1 });
    const resultPromise = promise;

    // Wait for setup
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate checkpoint manager resolving the promise
    expect(capturedResolver).toBeDefined();
    capturedResolver.resolve(undefined);

    // Should resolve
    await expect(resultPromise).resolves.toBeUndefined();

    // Should checkpoint completion
    expect(mockCheckpointManager.checkpoint).toHaveBeenCalledWith(
      "test-step-id",
      {
        Id: "test-step-id",
        ParentId: "parent-id",
        Action: "SUCCEED",
      },
    );
  });

  it("should calculate correct scheduled time", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    const startTime = Date.now();

    const promise = waitHandler({ seconds: 10 });
    promise.then(() => {}).catch(() => {});

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCheckpointManager.scheduleResume).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledTime: expect.any(Number),
      }),
    );

    const call = mockCheckpointManager.scheduleResume.mock.calls[0][0];
    const scheduledTime = call.scheduledTime;

    // Should be approximately 10 seconds from now
    expect(scheduledTime).toBeGreaterThan(startTime + 9000);
    expect(scheduledTime).toBeLessThan(startTime + 11000);
  });

  it("should handle rejection from checkpoint manager", async () => {
    mockContext.getStepData.mockReturnValue(undefined);
    let capturedResolver: any;

    mockCheckpointManager.scheduleResume.mockImplementation((resolver) => {
      capturedResolver = resolver;
    });

    const promise = waitHandler({ seconds: 1 });
    const resultPromise = promise;

    await new Promise((resolve) => setImmediate(resolve));

    const testError = new Error("Checkpoint failed");
    capturedResolver.reject(testError);

    await expect(resultPromise).rejects.toThrow("Checkpoint failed");
  });
});
