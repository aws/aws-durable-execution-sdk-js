import { TerminationManager } from "./termination-manager";
import { TerminationReason } from "./types";
import { createCheckpoint } from "../utils/checkpoint/checkpoint";
import { ExecutionContext } from "../types";
import { EventEmitter } from "events";

describe("TerminationManager Checkpoint Integration", () => {
  let terminationManager: TerminationManager;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;

  beforeEach(() => {
    terminationManager = new TerminationManager();
    mockEmitter = new EventEmitter();

    mockContext = {
      durableExecutionArn: "test-arn",
      state: {
        checkpoint: jest.fn().mockResolvedValue({
          CheckpointToken: "new-token",
          NewExecutionState: { Operations: [] },
        }),
      },
      _stepData: {},
      terminationManager,
    } as unknown as ExecutionContext;
  });

  afterEach(() => {});

  test("should set checkpoint terminating flag when terminate is called", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
    );

    // Checkpoint should work before termination
    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);

    // Trigger termination and set checkpoint terminating flag
    terminationManager.terminate({
      reason: TerminationReason.OPERATION_TERMINATED,
      message: "Test termination",
    });
    checkpoint.setTerminating();

    // Checkpoint should return never-resolving promise after termination
    const checkpointPromise = checkpoint("step-2", {
      Action: "START",
      Type: "STEP",
    });

    // Promise should not resolve within reasonable time
    let resolved = false;
    checkpointPromise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resolved).toBe(false);
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);
  });

  test("should prevent force checkpoint after termination", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
    );
    const mockCheckpointFn = mockContext.state.checkpoint as jest.Mock;

    // Queue a checkpoint first
    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    // Force checkpoint should work before termination
    await checkpoint.force();
    await new Promise((resolve) => setImmediate(resolve));
    const callsBeforeTermination = mockCheckpointFn.mock.calls.length;

    // Trigger termination and set checkpoint terminating flag
    terminationManager.terminate({
      reason: TerminationReason.CHECKPOINT_FAILED,
    });
    checkpoint.setTerminating();

    // Queue another checkpoint - should return never-resolving promise
    const checkpointPromise = checkpoint("step-2", {
      Action: "START",
      Type: "STEP",
    });

    // Force checkpoint should also return never-resolving promise after termination
    const forcePromise = checkpoint.force();

    // Neither promise should resolve within reasonable time
    let checkpointResolved = false;
    let forceResolved = false;

    checkpointPromise.then(() => {
      checkpointResolved = true;
    });

    forcePromise.then(() => {
      forceResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(checkpointResolved).toBe(false);
    expect(forceResolved).toBe(false);
    // Should not have made any additional calls after termination
    expect(mockCheckpointFn).toHaveBeenCalledTimes(callsBeforeTermination);
  });

  test("should set terminating flag immediately when terminate is called", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
    );

    // Terminate and set checkpoint terminating flag
    terminationManager.terminate();
    checkpoint.setTerminating();

    // Immediately try to checkpoint
    const checkpointPromise = checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    // Should return never-resolving promise without calling API
    let resolved = false;
    checkpointPromise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resolved).toBe(false);
    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });

  test("should handle multiple terminate calls gracefully", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
    );

    terminationManager.terminate();
    terminationManager.terminate();
    terminationManager.terminate();
    checkpoint.setTerminating();

    const checkpointPromise = checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    // Should return never-resolving promise without calling API
    let resolved = false;
    checkpointPromise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resolved).toBe(false);
    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });
});
