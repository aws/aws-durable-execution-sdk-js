import { CheckpointManager } from "./checkpoint-manager";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationLifecycleState, OperationSubType } from "../../types";
import { OperationType } from "@aws-sdk/client-lambda";
import { EventEmitter } from "events";

jest.mock("../logger/logger");

describe("CheckpointManager - Centralized Termination", () => {
  let checkpointManager: CheckpointManager;
  let mockTerminationManager: jest.Mocked<TerminationManager>;
  let mockClient: any;
  let mockStepDataEmitter: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockTerminationManager = {
      terminate: jest.fn(),
    } as any;

    mockClient = {
      checkpointDurableExecution: jest.fn().mockResolvedValue({}),
    };

    mockStepDataEmitter = new EventEmitter();

    checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockClient,
      mockTerminationManager,
      undefined,
      "test-token",
      mockStepDataEmitter,
      {} as any,
      new Set(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("markOperationState", () => {
    it("should create new operation on first call", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      expect(checkpointManager.getOperationState("step-1")).toBe(
        OperationLifecycleState.IDLE_NOT_AWAITED,
      );
    });

    it("should throw error if metadata missing on first call", () => {
      expect(() => {
        checkpointManager.markOperationState(
          "step-1",
          OperationLifecycleState.IDLE_NOT_AWAITED,
        );
      }).toThrow("metadata required on first call for step-1");
    });

    it("should update existing operation state", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
      );

      expect(checkpointManager.getOperationState("step-1")).toBe(
        OperationLifecycleState.IDLE_AWAITED,
      );
    });

    it("should mark operation as COMPLETED", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.COMPLETED,
      );

      // Operation is marked as COMPLETED (cleanup happens later)
      expect(checkpointManager.getOperationState("step-1")).toBe(
        OperationLifecycleState.COMPLETED,
      );
    });
  });

  describe("markOperationAwaited", () => {
    it("should transition IDLE_NOT_AWAITED to IDLE_AWAITED", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationAwaited("step-1");

      expect(checkpointManager.getOperationState("step-1")).toBe(
        OperationLifecycleState.IDLE_AWAITED,
      );
    });

    it("should handle missing operation gracefully", () => {
      expect(() => {
        checkpointManager.markOperationAwaited("nonexistent");
      }).not.toThrow();
    });
  });

  describe("waitForRetryTimer", () => {
    it("should throw if operation not found", () => {
      expect(() => {
        checkpointManager.waitForRetryTimer("nonexistent");
      }).toThrow("Operation nonexistent not found");
    });

    it("should throw if operation not in RETRY_WAITING state", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      expect(() => {
        checkpointManager.waitForRetryTimer("step-1");
      }).toThrow(
        "Operation step-1 must be in RETRY_WAITING state, got IDLE_NOT_AWAITED",
      );
    });
  });

  describe("waitForStatusChange", () => {
    it("should throw if operation not found", () => {
      expect(() => {
        checkpointManager.waitForStatusChange("nonexistent");
      }).toThrow("Operation nonexistent not found");
    });

    it("should throw if operation not in IDLE_AWAITED state", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      expect(() => {
        checkpointManager.waitForStatusChange("step-1");
      }).toThrow(
        "Operation step-1 must be in IDLE_AWAITED state, got IDLE_NOT_AWAITED",
      );
    });
  });

  describe("termination cooldown", () => {
    it("should schedule termination with cooldown when all operations idle", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      // Advance past cooldown
      jest.advanceTimersByTime(200);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
      });
    });

    it("should cancel termination if new operation starts during cooldown", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      // Advance partway through cooldown
      jest.advanceTimersByTime(100);

      // Start new operation
      checkpointManager.markOperationState(
        "step-2",
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: "step-2",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      // Advance past original cooldown
      jest.advanceTimersByTime(200);

      // Should not have terminated
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });
  });

  describe("termination reason priority", () => {
    it("should prioritize RETRY_SCHEDULED over WAIT_SCHEDULED", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationState(
        "step-2",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-2",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      jest.advanceTimersByTime(200);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.RETRY_SCHEDULED,
      });
    });

    it("should prioritize WAIT_SCHEDULED over CALLBACK_PENDING", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      checkpointManager.markOperationState(
        "step-2",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-2",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT_FOR_CALLBACK,
          },
        },
      );

      jest.advanceTimersByTime(200);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
      });
    });

    it("should use CALLBACK_PENDING when no retry or wait", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT_FOR_CALLBACK,
          },
        },
      );

      jest.advanceTimersByTime(200);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
      });
    });
  });

  describe("getAllOperations", () => {
    it("should return all tracked operations", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationState(
        "step-2",
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: "step-2",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      const ops = checkpointManager.getAllOperations();
      expect(ops.size).toBe(2);
      expect(ops.has("step-1")).toBe(true);
      expect(ops.has("step-2")).toBe(true);
    });
  });

  describe("polling mechanism", () => {
    beforeEach(() => {
      // Mock stepData for status checking
      (checkpointManager as any).stepData = {};
      // Clear any pending timers from previous tests
      jest.clearAllTimers();
    });

    it("should initialize polling with timer", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      jest.clearAllTimers();

      checkpointManager.waitForStatusChange("step-1");

      // Should schedule a timer
      expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);

      // Check operation has timer set
      const ops = checkpointManager.getAllOperations();
      const op = ops.get("step-1");
      expect(op?.timer).toBeDefined();
    });

    it("should initialize poll count and start time", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      jest.clearAllTimers();

      checkpointManager.waitForStatusChange("step-1");

      const ops = checkpointManager.getAllOperations();
      const op = ops.get("step-1");
      expect(op?.pollCount).toBe(0);
      expect(op?.pollStartTime).toBeDefined();
    });

    it("should use endTimestamp for initial delay calculation", () => {
      const stepId = "step-1";
      const futureTime = new Date(Date.now() + 5000);

      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
          endTimestamp: futureTime,
        },
      );

      jest.clearAllTimers();

      checkpointManager.waitForRetryTimer(stepId);

      // Should have a timer scheduled
      const ops = checkpointManager.getAllOperations();
      const op = ops.get(stepId);
      expect(op?.timer).toBeDefined();
      expect(op?.endTimestamp).toEqual(futureTime);
    });

    it("should handle Date object endTimestamp", () => {
      const stepId = "step-1";
      const futureTime = new Date(Date.now() + 3000);

      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
          endTimestamp: futureTime,
        },
      );

      jest.clearAllTimers();

      checkpointManager.waitForRetryTimer(stepId);

      const ops = checkpointManager.getAllOperations();
      const op = ops.get(stepId);
      expect(op?.timer).toBeDefined();
    });

    it("should set resolver function for promise", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.WAIT,
          },
        },
      );

      jest.clearAllTimers();

      checkpointManager.waitForStatusChange("step-1");

      const ops = checkpointManager.getAllOperations();
      const op = ops.get("step-1");
      expect(op?.resolver).toBeDefined();
      expect(typeof op?.resolver).toBe("function");
    });
  });
});
