import { CheckpointManager } from "./checkpoint-manager";
import { createTestCheckpointManager } from "../../testing/create-test-checkpoint-manager";
import {
  ExecutionContext,
  OperationLifecycleState,
  OperationSubType,
} from "../../types";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { DurableLogger } from "../../types/durable-logger";
import { EventEmitter } from "events";
import { createDefaultLogger } from "../logger/default-logger";
import { OperationType } from "../../types/wire";
import { log } from "../logger/logger";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../constants/constants";

jest.mock("../logger/logger", () => ({
  log: jest.fn(),
}));

describe("CheckpointManager Termination Behavior", () => {
  let mockContext: ExecutionContext;
  let stepDataEmitter: EventEmitter;
  let checkpointHandler: CheckpointManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.useRealTimers();

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
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
      requestId: "",
      getRemainingTimeMs: (): number => Infinity,
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

    it("should cancel termination when checkpoint processing starts during cooldown period", async () => {
      jest.useFakeTimers();

      const mockTerminate = jest.fn();
      mockContext.terminationManager.terminate = mockTerminate;

      // Mock checkpoint API with delayed resolution to simulate network latency
      const checkpointPromise = new Promise(() => {});

      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockReturnValue(checkpointPromise);

      // Step 1: Create scenario where termination would be scheduled
      // Mark operation as awaited - with clean queue/processing state, this schedules termination
      checkpointHandler.markOperationState(
        "test-step",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "test-step",
            type: OperationType.CHAINED_INVOKE,
            subType: OperationSubType.CHAINED_INVOKE,
          },
        },
      );

      // Verify termination was actually scheduled
      expect(log).toHaveBeenCalledWith(
        "⏱️",
        "Scheduling termination",
        expect.objectContaining({
          reason: "CALLBACK_PENDING",
          cooldownMs: CHECKPOINT_TERMINATION_COOLDOWN_MS,
        }),
      );

      // Step 2: Immediately queue checkpoint
      // This adds to the checkpoint queue synchronously, which should cancel the termination
      checkpointHandler.checkpoint("test-step", {
        Action: "SUCCEED",
        Type: "CHAINED_INVOKE",
      });

      // Step 3: Advance time past the termination cooldown
      await jest.advanceTimersByTimeAsync(
        CHECKPOINT_TERMINATION_COOLDOWN_MS + 10,
      );

      // At this point, the timer callback should execute and re-check shouldTerminate()
      // It should find isProcessing=true and cancel termination
      expect(mockTerminate).not.toHaveBeenCalled();

      expect(log).toHaveBeenCalledWith(
        "🔄",
        "Termination aborted - conditions changed",
      );
    });
  });

  describe("checkpoint response without a CheckpointToken", () => {
    /**
     * Each checkpoint response carries the token for the next call, so one without a token
     * withdraws this invocation's ability to record anything further. The composed tests in
     * checkpoint-token-revoked.composed.test.ts pin the invocation's answer; these pin what
     * the manager does to produce it.
     */
    let warningLogger: DurableLogger;
    let revokingHandler: CheckpointManager;

    beforeEach(() => {
      warningLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };

      revokingHandler = createTestCheckpointManager(
        mockContext,
        "test-token",
        stepDataEmitter,
        warningLogger,
      );

      (
        mockContext.durableExecutionClient.checkpoint as jest.Mock
      ).mockResolvedValue({
        CheckpointToken: undefined,
        NewExecutionState: { Operations: [] },
      });
    });

    /** Sends one checkpoint, deliberately unawaited, and waits for the response to land. */
    const sendRevokedCheckpoint = async (stepId: string): Promise<boolean> => {
      let resolved = false;
      void revokingHandler
        .checkpoint(stepId, { Action: "START", Type: "STEP" })
        .then(() => {
          resolved = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return resolved;
    };

    it("terminates with EXECUTION_SUSPENDED_BY_SERVICE", async () => {
      const mockTerminate = jest.fn();
      mockContext.terminationManager.terminate = mockTerminate;

      await sendRevokedCheckpoint("test-step");

      expect(mockTerminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: TerminationReason.EXECUTION_SUSPENDED_BY_SERVICE,
        }),
      );
    });

    it("leaves the caller of the accepted checkpoint unresolved", async () => {
      // The checkpoint was accepted, but resolving it lets the handler carry on -- start its
      // next step, say -- after the service has stopped listening. That work would run for
      // nothing and then run again on the next invocation.
      expect(await sendRevokedCheckpoint("test-step")).toBe(false);
    });

    it("warns, so an absent token is distinguishable from a dropped field", async () => {
      await sendRevokedCheckpoint("test-step");

      expect(warningLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no CheckpointToken"),
        expect.objectContaining({ durableExecutionArn: "test-arn" }),
      );
    });

    it("sends nothing further, including for a forced checkpoint", async () => {
      // The spent token is the only one the manager holds, so any later call presents a
      // token the service has already rejected. forceCheckpoint is the case that reaches
      // the queue without enqueueing an update, so a guard on the queue alone misses it.
      const checkpointClient = mockContext.durableExecutionClient
        .checkpoint as jest.Mock;

      await sendRevokedCheckpoint("first-step");
      expect(checkpointClient).toHaveBeenCalledTimes(1);

      // Neither is awaited: both are left unresolved on purpose, as during any other
      // termination, so that the termination decides the invocation.
      void revokingHandler.checkpoint("second-step", {
        Action: "START",
        Type: "STEP",
      });
      void revokingHandler.forceCheckpoint();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(checkpointClient).toHaveBeenCalledTimes(1);
    });
  });
});
