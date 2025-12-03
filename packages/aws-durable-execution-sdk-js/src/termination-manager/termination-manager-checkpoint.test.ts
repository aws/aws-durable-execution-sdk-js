import { TerminationManager } from "./termination-manager";
import { TerminationReason } from "./types";
import { CheckpointManager } from "../utils/checkpoint/checkpoint-manager";
import { CheckpointFunction } from "../testing/mock-checkpoint";
import { DurableLogger, ExecutionContext } from "../types";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../utils/logger/default-logger";

// Helper function to create checkpoint function from manager
const createCheckpoint = (
  context: ExecutionContext,
  token: string,
  emitter: any,
  logger: any,
): any => {
  const manager = new CheckpointManager(
    context.durableExecutionArn,
    {},
    context.durableExecutionClient,
    context.terminationManager,
    token,
    emitter,
    logger,
    new Set<string>(),
  );
  const checkpoint = (stepId: string, data: any): Promise<any> =>
    manager.checkpoint(stepId, data);
  checkpoint.force = (): Promise<any> => manager.forceCheckpoint();
  checkpoint.setTerminating = (): void => manager.setTerminating();
  checkpoint.hasPendingAncestorCompletion = (): boolean => false;
  return checkpoint;
};

describe("TerminationManager Checkpoint Integration", () => {
  let terminationManager: TerminationManager;
  let mockContext: ExecutionContext;
  let mockEmitter: EventEmitter;
  let mockLogger: DurableLogger;

  beforeEach(() => {
    terminationManager = new TerminationManager();
    mockEmitter = new EventEmitter();

    mockContext = {
      durableExecutionArn: "test-arn",
      durableExecutionClient: {
        getExecutionState: jest.fn(),
        checkpoint: jest.fn().mockResolvedValue({
          CheckpointToken: "new-token",
          NewExecutionState: { Operations: [] },
        }),
      },
      _stepData: {},
      terminationManager,
      requestId: "",
      tenantId: "",
      pendingCompletions: new Set(),
      getStepData: jest.fn(),
    } satisfies ExecutionContext;

    mockLogger = createDefaultLogger(mockContext);
  });

  afterEach(() => {});

  test("should set checkpoint terminating flag when terminate is called", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

    // Checkpoint should work before termination
    await checkpoint("step-1", {
      Action: "START",
      Type: "STEP",
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockContext.durableExecutionClient.checkpoint).toHaveBeenCalledTimes(
      1,
    );

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
    expect(mockContext.durableExecutionClient.checkpoint).toHaveBeenCalledTimes(
      1,
    );
  });

  test("should prevent force checkpoint after termination", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;
    const mockCheckpointFn = mockContext.durableExecutionClient
      .checkpoint as jest.Mock;

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
      mockLogger,
    ) as unknown as CheckpointFunction;

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
    expect(
      mockContext.durableExecutionClient.checkpoint,
    ).not.toHaveBeenCalled();
  });

  test("should handle multiple terminate calls gracefully", async () => {
    const checkpoint = createCheckpoint(
      mockContext,
      "initial-token",
      mockEmitter,
      mockLogger,
    ) as unknown as CheckpointFunction;

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
    expect(
      mockContext.durableExecutionClient.checkpoint,
    ).not.toHaveBeenCalled();
  });
});
