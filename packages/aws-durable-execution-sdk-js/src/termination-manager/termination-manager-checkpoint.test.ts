import { TerminationManager } from "./termination-manager";
import { TerminationReason } from "./types";
import {
  createCheckpoint,
  deleteCheckpoint,
} from "../utils/checkpoint/checkpoint";
import { ExecutionContext } from "../types";

describe("TerminationManager Checkpoint Integration", () => {
  let terminationManager: TerminationManager;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    deleteCheckpoint();
    terminationManager = new TerminationManager();

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

  afterEach(() => {
    deleteCheckpoint();
  });

  test("should set checkpoint terminating flag when terminate is called", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    // Checkpoint should work before termination
    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);

    // Trigger termination
    terminationManager.terminate({
      reason: TerminationReason.OPERATION_TERMINATED,
      message: "Test termination",
    });

    // Checkpoint should be blocked after termination
    await checkpoint("step-2", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.state.checkpoint).toHaveBeenCalledTimes(1);
  });

  test("should prevent force checkpoint after termination", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");
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

    // Trigger termination
    terminationManager.terminate({
      reason: TerminationReason.CHECKPOINT_FAILED,
    });

    // Queue another checkpoint
    await checkpoint("step-2", {
      Action: "START",
      Type: "STEP",
    });

    // Force checkpoint should be blocked after termination
    await checkpoint.force();
    await new Promise((resolve) => setImmediate(resolve));

    // Should not have made any additional calls after termination
    expect(mockCheckpointFn).toHaveBeenCalledTimes(callsBeforeTermination);
  });

  test("should set terminating flag immediately when terminate is called", () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    // Terminate
    terminationManager.terminate();

    // Immediately try to checkpoint (synchronously)
    const checkpointPromise = checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    // Should resolve immediately without calling API
    return checkpointPromise.then(() => {
      expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
    });
  });

  test("should handle multiple terminate calls gracefully", async () => {
    const checkpoint = createCheckpoint(mockContext, "initial-token");

    terminationManager.terminate();
    terminationManager.terminate();
    terminationManager.terminate();

    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    expect(mockContext.state.checkpoint).not.toHaveBeenCalled();
  });
});
