import { CentralizedCheckpointManager } from "./utils/checkpoint/centralized-checkpoint-manager";
import { createCentralizedWaitHandler } from "./handlers/wait-handler/centralized-wait-handler";

// Mock dependencies
jest.mock("./utils/logger/logger", () => ({
  log: jest.fn(),
}));

jest.mock("./utils/replay-validation/replay-validation", () => ({
  validateReplayConsistency: jest.fn(),
}));

jest.mock("./utils/duration/duration", () => ({
  durationToSeconds: jest.fn((duration) => {
    if (typeof duration === "number") return duration;
    if (duration.seconds) return duration.seconds;
    return 1;
  }),
}));

describe("System Integration - Centralized Termination", () => {
  let checkpointManager: CentralizedCheckpointManager;
  let mockContext: any;

  beforeEach(() => {
    // Create real centralized checkpoint manager
    checkpointManager = new (CentralizedCheckpointManager as any)(
      "test-arn",
      {},
      { checkpoint: jest.fn().mockResolvedValue({}) },
      { setCheckpointTerminatingCallback: jest.fn() },
      undefined,
      "test-token",
      { emit: jest.fn() },
      { log: jest.fn() },
      new Set(),
    );

    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
    };

    // Mock the checkpoint method
    jest.spyOn(checkpointManager, "checkpoint").mockResolvedValue(undefined);

    jest.useFakeTimers();
  });

  afterEach(() => {
    checkpointManager.cleanup();
    jest.useRealTimers();
  });

  it("should demonstrate centralized termination with multiple handlers", async () => {
    const waitHandler = createCentralizedWaitHandler(
      mockContext,
      checkpointManager,
      () => `step-${Date.now()}`,
      "parent-id",
    );

    // Create multiple wait operations
    const wait1 = waitHandler("wait-1", { seconds: 1 });
    const wait2 = waitHandler("wait-2", { seconds: 2 });
    const wait3 = waitHandler("wait-3", { seconds: 3 });

    // All should be tracked by checkpoint manager
    expect(checkpointManager.getActiveHandlerCount()).toBe(3);
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Advance time to resolve first wait
    jest.advanceTimersByTime(1000);
    await wait1;

    // Two should remain
    expect(checkpointManager.getActiveHandlerCount()).toBe(2);
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Advance time to resolve second wait
    jest.advanceTimersByTime(1000);
    await wait2;

    // One should remain
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Advance time to resolve final wait
    jest.advanceTimersByTime(1000);
    await wait3;

    // None should remain - would trigger termination
    expect(checkpointManager.getActiveHandlerCount()).toBe(0);
    expect(checkpointManager.hasActiveHandlers()).toBe(false);
  });

  it("should handle concurrent handler creation and completion", async () => {
    const waitHandler = createCentralizedWaitHandler(
      mockContext,
      checkpointManager,
      () => `step-${Math.random()}`,
      "parent-id",
    );

    // Create handlers at different times
    const wait1 = waitHandler({ seconds: 2 });
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);

    // Advance time partially
    jest.advanceTimersByTime(1000);

    // Create another handler while first is still active
    const wait2 = waitHandler({ seconds: 1 });
    expect(checkpointManager.getActiveHandlerCount()).toBe(2);

    // Advance time to resolve second handler
    jest.advanceTimersByTime(1000);
    await wait2;

    // First should still be active
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);

    // Resolve first handler
    await wait1;

    // All should be complete
    expect(checkpointManager.getActiveHandlerCount()).toBe(0);
  });

  it("should demonstrate termination warmup behavior", async () => {
    const waitHandler = createCentralizedWaitHandler(
      mockContext,
      checkpointManager,
      () => `step-${Date.now()}`,
      "parent-id",
    );

    // Create and immediately resolve a handler
    const wait = waitHandler({ seconds: 0 });
    await wait;

    // Should have no active handlers
    expect(checkpointManager.hasActiveHandlers()).toBe(false);

    // Should start termination warmup
    checkpointManager.checkTermination();

    // Create new handler during warmup
    const newWait = waitHandler({ seconds: 1 });
    expect(checkpointManager.hasActiveHandlers()).toBe(true);

    // Warmup should be cancelled, new handler should be tracked
    expect(checkpointManager.getActiveHandlerCount()).toBe(1);

    // Resolve the new handler
    jest.advanceTimersByTime(1000);
    await newWait;

    // Should be ready for termination again
    expect(checkpointManager.hasActiveHandlers()).toBe(false);
  });
});
