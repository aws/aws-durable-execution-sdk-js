import { createCentralizedWaitHandler } from "./centralized-wait-handler";
import { CentralizedCheckpointManager } from "../../utils/checkpoint/centralized-checkpoint-manager";
import { ExecutionContext } from "../../types";

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

describe("CentralizedWaitHandler Integration", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let checkpointManager: CentralizedCheckpointManager;
  let createStepId: jest.Mock;
  let waitHandler: ReturnType<typeof createCentralizedWaitHandler>;

  beforeEach(() => {
    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
    } as any;

    // Create real checkpoint manager for integration test
    checkpointManager = new (CentralizedCheckpointManager as any)();

    // Mock the checkpoint method
    jest.spyOn(checkpointManager, "checkpoint").mockResolvedValue(undefined);

    createStepId = jest.fn(() => `step-${Date.now()}`);

    waitHandler = createCentralizedWaitHandler(
      mockContext,
      checkpointManager,
      createStepId,
      "parent-id",
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    checkpointManager.cleanup();
    jest.useRealTimers();
  });

  it("should integrate with checkpoint manager for immediate resolution", async () => {
    const promise = waitHandler({ seconds: 0 }); // Immediate

    // Promise should resolve immediately since scheduledTime is in the past
    const result = await promise;

    expect(result).toBeUndefined();
    expect(checkpointManager.checkpoint).toHaveBeenCalled();
  });

  it("should integrate with checkpoint manager for delayed resolution", async () => {
    const promise = waitHandler({ seconds: 2 });

    // Start the promise
    const resultPromise = promise;

    // Should be scheduled but not resolved yet
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);

    // Fast-forward time to trigger resolution
    jest.advanceTimersByTime(2000);

    // Should resolve after timer
    const result = await resultPromise;
    expect(result).toBeUndefined();

    // Should no longer have active handlers
    expect(checkpointManager.getActiveHandlerCount()).toBe(0);
  });

  it("should handle multiple concurrent waits", async () => {
    const wait1 = waitHandler("wait-1", { seconds: 1 });
    const wait2 = waitHandler("wait-2", { seconds: 3 });

    // Both should be active
    expect(checkpointManager.getActiveHandlerCount()).toBe(2);

    // Advance time partially
    jest.advanceTimersByTime(1000);

    // First wait should resolve
    await expect(wait1).resolves.toBeUndefined();

    // Second should still be active
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);

    // Advance remaining time
    jest.advanceTimersByTime(2000);

    // Second wait should resolve
    await expect(wait2).resolves.toBeUndefined();

    // No active handlers
    expect(checkpointManager.getActiveHandlerCount()).toBe(0);
  });

  it("should demonstrate centralized termination logic", async () => {
    const wait1 = waitHandler({ seconds: 5 });
    const wait2 = waitHandler({ seconds: 10 });

    // Both active
    expect(checkpointManager.getActiveHandlerCount()).toBe(2);
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Resolve first wait
    jest.advanceTimersByTime(5000);
    await wait1;

    // One still active
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Resolve second wait
    jest.advanceTimersByTime(5000);
    await wait2;

    // None active - would trigger termination
    expect(checkpointManager.getActiveHandlerCount()).toBe(0);
    expect(checkpointManager.hasActiveHandlers()).toBe(false);
  });
});
