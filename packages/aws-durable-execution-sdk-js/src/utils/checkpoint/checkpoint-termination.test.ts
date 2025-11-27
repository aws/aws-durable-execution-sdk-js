import { CheckpointManager } from "./checkpoint-manager";
import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import { ExecutionContext } from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";

describe("CheckpointManager Termination Behavior", () => {
  let mockContext: ExecutionContext;
  let stepDataEmitter: EventEmitter;
  let checkpointHandler: CheckpointManager;

  beforeEach(() => {
    stepDataEmitter = new EventEmitter();
    mockContext = {
      durableExecutionClient: {
        checkpoint: jest.fn(),
        getExecutionState: jest.fn(),
      },
      _stepData: {},
      terminationManager: new TerminationManager(),
      durableExecutionArn: "test-arn",
      getStepData: jest.fn(),
      requestId: "",
      tenantId: "",
      pendingCompletions: new Set(),
    } satisfies ExecutionContext;

    checkpointHandler = createTestCheckpointManager(
      mockContext,
      "test-token",
      stepDataEmitter,
      createDefaultLogger(mockContext),
    );
  });

  describe("checkpoint() during termination", () => {
    it("should return never-resolving promise when terminating", async () => {
      // Set terminating state
      checkpointHandler.setTerminating();

      // Call checkpoint
      const checkpointPromise = checkpointHandler.checkpoint("test-step", {
        Action: "START",
        Type: "STEP",
      });

      // Promise should not resolve within reasonable time
      let resolved = false;
      checkpointPromise.then(() => {
        resolved = true;
      });

      // Wait a bit to ensure it doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(resolved).toBe(false);
    });

    it("should resolve normally when not terminating", async () => {
      // Mock successful checkpoint
      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockResolvedValue({
        CheckpointToken: "new-token",
        NewExecutionState: { Operations: [] },
      });

      // Call checkpoint without terminating
      const checkpointPromise = checkpointHandler.checkpoint("test-step", {
        Action: "START",
        Type: "STEP",
      });

      // Should resolve normally
      await expect(checkpointPromise).resolves.toBeUndefined();
    });
  });

  describe("forceCheckpoint() during termination", () => {
    it("should return never-resolving promise when terminating", async () => {
      // Set terminating state
      checkpointHandler.setTerminating();

      // Call forceCheckpoint
      const forcePromise = checkpointHandler.forceCheckpoint();

      // Promise should not resolve within reasonable time
      let resolved = false;
      forcePromise.then(() => {
        resolved = true;
      });

      // Wait a bit to ensure it doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(resolved).toBe(false);
    });

    it("should resolve normally when not terminating", async () => {
      // Mock successful checkpoint
      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockResolvedValue({
        CheckpointToken: "new-token",
        NewExecutionState: { Operations: [] },
      });

      // Call forceCheckpoint without terminating
      const forcePromise = checkpointHandler.forceCheckpoint();

      // Should resolve normally
      await expect(forcePromise).resolves.toBeUndefined();
    });
  });

  describe("setTerminating()", () => {
    it("should prevent new checkpoints from resolving", async () => {
      // First checkpoint should work normally
      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockResolvedValue({
        CheckpointToken: "new-token",
        NewExecutionState: { Operations: [] },
      });

      const firstCheckpoint = checkpointHandler.checkpoint("step1", {
        Action: "START",
        Type: "STEP",
      });
      await expect(firstCheckpoint).resolves.toBeUndefined();

      // Set terminating
      checkpointHandler.setTerminating();

      // Second checkpoint should never resolve
      const secondCheckpoint = checkpointHandler.checkpoint("step2", {
        Action: "START",
        Type: "STEP",
      });

      let resolved = false;
      secondCheckpoint.then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(resolved).toBe(false);
    });
  });

  describe("race condition prevention", () => {
    it("should handle termination during checkpoint processing", async () => {
      // Mock slow checkpoint
      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  CheckpointToken: "new-token",
                  NewExecutionState: { Operations: [] },
                }),
              200,
            ),
          ),
      );

      // Start checkpoint
      const checkpointPromise = checkpointHandler.checkpoint("test-step", {
        Action: "START",
        Type: "STEP",
      });

      // Set terminating while checkpoint is processing
      setTimeout(() => {
        checkpointHandler.setTerminating();
      }, 50);

      // Original checkpoint should still complete
      await expect(checkpointPromise).resolves.toBeUndefined();

      // New checkpoints should not resolve
      const newCheckpoint = checkpointHandler.checkpoint("new-step", {
        Action: "START",
        Type: "STEP",
      });

      let resolved = false;
      newCheckpoint.then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(resolved).toBe(false);
    });
  });
});
