import { CheckpointManager } from "./checkpoint-manager";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationLifecycleState, OperationSubType } from "../../types";
import { OperationType } from "../../types/wire";
import { EventEmitter } from "events";
import { hashId } from "../step-id-utils/step-id-utils";
import { CHECKPOINT_TERMINATION_COOLDOWN_MS } from "../constants/constants";

jest.mock("../logger/logger");

describe("CheckpointManager - Centralized Termination", () => {
  let checkpointManager: CheckpointManager;
  let mockTerminationManager: jest.Mocked<TerminationManager>;
  let mockClient: any;
  let mockStepDataEmitter: EventEmitter;
  // Default: no deadline reported. Individual tests narrow this.
  let mockRemainingTimeMs: number;

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
    mockRemainingTimeMs = Infinity;

    checkpointManager = new CheckpointManager(
      "test-arn",
      {},
      mockClient,
      mockTerminationManager,
      "test-token",
      mockStepDataEmitter,
      {} as any,
      new Set<string>(),
      {},
      "",
      () => mockRemainingTimeMs,
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

    it("should return promise that resolves when resolver is called", async () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId: "step-1",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
          endTimestamp: new Date(Date.now() + 5000),
        },
      );

      const promise = checkpointManager.waitForRetryTimer("step-1");

      // Get the resolver and call it
      const ops = checkpointManager.getAllOperations();
      const op = ops.get("step-1");
      expect(op?.resolver).toBeDefined();

      op!.resolver!();

      await expect(promise).resolves.toBeUndefined();
    });

    describe("terminal status instant resolution", () => {
      it.each([
        { status: "SUCCEEDED", operationStatus: "SUCCEEDED" },
        { status: "CANCELLED", operationStatus: "CANCELLED" },
        { status: "FAILED", operationStatus: "FAILED" },
        { status: "STOPPED", operationStatus: "STOPPED" },
        { status: "TIMED_OUT", operationStatus: "TIMED_OUT" },
      ])(
        "should instantly resolve when status is $status",
        async ({ operationStatus }) => {
          const stepId = "step-1";

          // Create operation in RETRY_WAITING state
          checkpointManager.markOperationState(
            stepId,
            OperationLifecycleState.RETRY_WAITING,
            {
              metadata: {
                stepId,
                type: OperationType.STEP,
                subType: OperationSubType.STEP,
              },
              endTimestamp: new Date(Date.now() + 5000),
            },
          );

          // Set up stepData with terminal status
          const hashedStepId = hashId(stepId);
          (checkpointManager as any).stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: operationStatus,
          };

          jest.clearAllTimers();

          // Call waitForRetryTimer - should resolve immediately
          const promise = checkpointManager.waitForRetryTimer(stepId);

          await expect(promise).resolves.toBeUndefined();

          // Verify no polling was set up
          const ops = checkpointManager.getAllOperations();
          const op = ops.get(stepId);
          expect(op?.timer).toBeUndefined();
          expect(op?.resolver).toBeUndefined();
          expect(op?.pollCount).toBeUndefined();

          // Verify no timers were scheduled
          expect(jest.getTimerCount()).toBe(0);
        },
      );

      it("should instantly resolve when status is terminal even with future endTimestamp", async () => {
        const stepId = "step-1";

        // Create operation with future endTimestamp
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
            },
            endTimestamp: new Date(Date.now() + 10000), // 10 seconds in future
          },
        );

        // Set up stepData with terminal status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: "SUCCEEDED",
        };

        jest.clearAllTimers();

        // Call waitForRetryTimer - should resolve immediately despite future endTimestamp
        const promise = checkpointManager.waitForRetryTimer(stepId);

        await expect(promise).resolves.toBeUndefined();

        // Verify no polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeUndefined();
        expect(op?.resolver).toBeUndefined();
        expect(op?.pollCount).toBeUndefined();

        // Verify no timers were scheduled
        expect(jest.getTimerCount()).toBe(0);
      });

      it("should set up polling when status is not terminal", async () => {
        const stepId = "step-1";

        // Create operation in RETRY_WAITING state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
            },
            endTimestamp: new Date(Date.now() + 5000),
          },
        );

        // Set up stepData with non-terminal status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: "STARTED", // Non-terminal status
        };

        jest.clearAllTimers();

        // Call waitForRetryTimer - should set up polling
        const promise = checkpointManager.waitForRetryTimer(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });

      it("should set up polling when stepData is missing", async () => {
        const stepId = "step-1";

        // Create operation in RETRY_WAITING state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
            },
            endTimestamp: new Date(Date.now() + 5000),
          },
        );

        // Don't set up stepData - should be missing/undefined

        jest.clearAllTimers();

        // Call waitForRetryTimer - should set up polling
        const promise = checkpointManager.waitForRetryTimer(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });

      it("should set up polling when stepData status is undefined", async () => {
        const stepId = "step-1";

        // Create operation in RETRY_WAITING state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.RETRY_WAITING,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.STEP,
            },
            endTimestamp: new Date(Date.now() + 5000),
          },
        );

        // Set up stepData without status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          // Status is undefined
        };

        jest.clearAllTimers();

        // Call waitForRetryTimer - should set up polling
        const promise = checkpointManager.waitForRetryTimer(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });
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

    it("should return promise that resolves when resolver is called", async () => {
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

      const promise = checkpointManager.waitForStatusChange("step-1");

      // Get the resolver and call it
      const ops = checkpointManager.getAllOperations();
      const op = ops.get("step-1");
      expect(op?.resolver).toBeDefined();

      op!.resolver!();

      await expect(promise).resolves.toBeUndefined();
    });

    describe("terminal status instant resolution", () => {
      it.each([
        { status: "SUCCEEDED", operationStatus: "SUCCEEDED" },
        { status: "CANCELLED", operationStatus: "CANCELLED" },
        { status: "FAILED", operationStatus: "FAILED" },
        { status: "STOPPED", operationStatus: "STOPPED" },
        { status: "TIMED_OUT", operationStatus: "TIMED_OUT" },
      ])(
        "should instantly resolve when status is $status",
        async ({ operationStatus }) => {
          const stepId = "step-1";

          // Create operation in IDLE_AWAITED state
          checkpointManager.markOperationState(
            stepId,
            OperationLifecycleState.IDLE_AWAITED,
            {
              metadata: {
                stepId,
                type: OperationType.STEP,
                subType: OperationSubType.WAIT,
              },
            },
          );

          // Set up stepData with terminal status
          const hashedStepId = hashId(stepId);
          (checkpointManager as any).stepData[hashedStepId] = {
            Id: hashedStepId,
            Status: operationStatus,
          };

          jest.clearAllTimers();

          // Call waitForStatusChange - should resolve immediately
          const promise = checkpointManager.waitForStatusChange(stepId);

          await expect(promise).resolves.toBeUndefined();

          // Verify no polling was set up
          const ops = checkpointManager.getAllOperations();
          const op = ops.get(stepId);
          expect(op?.timer).toBeUndefined();
          expect(op?.resolver).toBeUndefined();
          expect(op?.pollCount).toBeUndefined();

          // Verify no timers were scheduled
          expect(jest.getTimerCount()).toBe(0);
        },
      );

      it("should instantly resolve when status is terminal even with endTimestamp", async () => {
        const stepId = "step-1";

        // Create operation with future endTimestamp
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.IDLE_AWAITED,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.WAIT,
            },
            endTimestamp: new Date(Date.now() + 10000), // 10 seconds in future
          },
        );

        // Set up stepData with terminal status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: "SUCCEEDED",
        };

        jest.clearAllTimers();

        // Call waitForStatusChange - should resolve immediately despite endTimestamp
        const promise = checkpointManager.waitForStatusChange(stepId);

        await expect(promise).resolves.toBeUndefined();

        // Verify no polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeUndefined();
        expect(op?.resolver).toBeUndefined();
        expect(op?.pollCount).toBeUndefined();

        // Verify no timers were scheduled
        expect(jest.getTimerCount()).toBe(0);
      });

      it("should set up polling when status is not terminal", async () => {
        const stepId = "step-1";

        // Create operation in IDLE_AWAITED state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.IDLE_AWAITED,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.WAIT,
            },
          },
        );

        // Set up stepData with non-terminal status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          Status: "STARTED", // Non-terminal status
        };

        jest.clearAllTimers();

        // Call waitForStatusChange - should set up polling
        const promise = checkpointManager.waitForStatusChange(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });

      it("should set up polling when stepData is missing", async () => {
        const stepId = "step-1";

        // Create operation in IDLE_AWAITED state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.IDLE_AWAITED,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.WAIT,
            },
          },
        );

        // Don't set up stepData - should be missing/undefined

        jest.clearAllTimers();

        // Call waitForStatusChange - should set up polling
        const promise = checkpointManager.waitForStatusChange(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });

      it("should set up polling when stepData status is undefined", async () => {
        const stepId = "step-1";

        // Create operation in IDLE_AWAITED state
        checkpointManager.markOperationState(
          stepId,
          OperationLifecycleState.IDLE_AWAITED,
          {
            metadata: {
              stepId,
              type: OperationType.STEP,
              subType: OperationSubType.WAIT,
            },
          },
        );

        // Set up stepData without status
        const hashedStepId = hashId(stepId);
        (checkpointManager as any).stepData[hashedStepId] = {
          Id: hashedStepId,
          // Status is undefined
        };

        jest.clearAllTimers();

        // Call waitForStatusChange - should set up polling
        const promise = checkpointManager.waitForStatusChange(stepId);

        // Verify polling was set up
        const ops = checkpointManager.getAllOperations();
        const op = ops.get(stepId);
        expect(op?.timer).toBeDefined();
        expect(op?.resolver).toBeDefined();
        expect(op?.pollCount).toBe(0);

        // Verify timer was scheduled
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        // Clean up by resolving the operation
        op?.resolver?.();
        await promise;
      });
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
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS);

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
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS / 2);

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
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS);

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

  describe("cleanup methods", () => {
    it("should clear timer and resolver in cleanupOperation", () => {
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

      // Verify timer and resolver are set
      let ops = checkpointManager.getAllOperations();
      let op = ops.get("step-1");
      expect(op?.timer).toBeDefined();
      expect(op?.resolver).toBeDefined();

      // Call private cleanupOperation method
      (checkpointManager as any).cleanupOperation("step-1");

      // Verify timer and resolver are cleared
      ops = checkpointManager.getAllOperations();
      op = ops.get("step-1");
      expect(op?.timer).toBeUndefined();
      expect(op?.resolver).toBeUndefined();
    });

    it("should handle missing operation in cleanupOperation", () => {
      expect(() => {
        (checkpointManager as any).cleanupOperation("nonexistent");
      }).not.toThrow();
    });

    it("should clear all timers and resolvers in cleanupAllOperations", () => {
      // Create multiple operations with timers
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
        OperationLifecycleState.RETRY_WAITING,
        {
          metadata: {
            stepId: "step-2",
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      jest.clearAllTimers();
      checkpointManager.waitForStatusChange("step-1");
      checkpointManager.waitForRetryTimer("step-2");

      // Verify timers and resolvers are set
      let ops = checkpointManager.getAllOperations();
      expect(ops.get("step-1")?.timer).toBeDefined();
      expect(ops.get("step-1")?.resolver).toBeDefined();
      expect(ops.get("step-2")?.timer).toBeDefined();
      expect(ops.get("step-2")?.resolver).toBeDefined();

      // Call cleanupAllOperations
      (checkpointManager as any).cleanupAllOperations();

      // Verify all timers and resolvers are cleared
      ops = checkpointManager.getAllOperations();
      expect(ops.get("step-1")?.timer).toBeUndefined();
      expect(ops.get("step-1")?.resolver).toBeUndefined();
      expect(ops.get("step-2")?.timer).toBeUndefined();
      expect(ops.get("step-2")?.resolver).toBeUndefined();
    });
  });

  describe("checkAndTerminate rules", () => {
    it("should not terminate if checkpoint queue is not empty", () => {
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

      // Add item to queue
      (checkpointManager as any).queue.push({});

      // Trigger checkAndTerminate
      (checkpointManager as any).checkAndTerminate();

      // Should not terminate
      jest.advanceTimersByTime(300);
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should not terminate if checkpoint is processing", () => {
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

      // Set processing flag
      (checkpointManager as any).isProcessing = true;

      // Trigger checkAndTerminate
      (checkpointManager as any).checkAndTerminate();

      // Should not terminate
      jest.advanceTimersByTime(300);
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should not terminate if there are pending force checkpoint promises", () => {
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

      // Add pending promise
      (checkpointManager as any).forceCheckpointPromises.push({});

      // Trigger checkAndTerminate
      (checkpointManager as any).checkAndTerminate();

      // Should not terminate
      jest.advanceTimersByTime(300);
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    it("should not terminate if any operation is EXECUTING", () => {
      checkpointManager.markOperationState(
        "step-1",
        OperationLifecycleState.EXECUTING,
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

      // Trigger checkAndTerminate
      (checkpointManager as any).checkAndTerminate();

      // Should not terminate
      jest.advanceTimersByTime(300);
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });
  });

  describe("processQueue triggers checkAndTerminate after queue drains", () => {
    it("should call checkAndTerminate when checkpoint queue finishes processing and no termination is scheduled", async () => {
      // Setup: mock the checkpoint API to succeed
      mockClient.checkpointDurableExecution.mockResolvedValue({
        checkpointToken: "new-token",
      });

      // Spy on checkAndTerminate BEFORE any operations that trigger it
      const checkAndTerminateSpy = jest.spyOn(
        checkpointManager as any,
        "checkAndTerminate",
      );

      // 1. Enqueue a checkpoint FIRST so the queue is non-empty when
      //    markOperationAwaited calls checkAndTerminate (which will see
      //    a non-empty queue and NOT schedule termination).
      const checkpointPromise = checkpointManager.checkpoint("completed-step", {
        Action: "SUCCEED" as any,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });
      checkpointPromise.catch(() => {});

      // 2. Register an operation in IDLE_NOT_AWAITED (no checkAndTerminate call)
      checkpointManager.markOperationState(
        "invoke-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "invoke-1",
            type: OperationType.CHAINED_INVOKE,
            subType: OperationSubType.CHAINED_INVOKE,
          },
        },
      );

      // 3. Transition to IDLE_AWAITED — calls checkAndTerminate, but queue
      //    is non-empty so shouldTerminate returns undefined → no timer set
      checkpointManager.markOperationAwaited("invoke-1");

      expect(checkAndTerminateSpy).toHaveBeenCalledTimes(1);

      // 4. Let the queue drain — since no terminationTimer is set,
      //    processQueue should call checkAndTerminate
      await jest.advanceTimersByTimeAsync(0);

      expect(checkAndTerminateSpy).toHaveBeenCalledTimes(2);
    });

    it("should skip checkAndTerminate when queue drains but termination is already scheduled", async () => {
      // Setup: mock the checkpoint API to succeed
      mockClient.checkpointDurableExecution.mockResolvedValue({
        checkpointToken: "new-token",
      });

      const checkAndTerminateSpy = jest.spyOn(
        checkpointManager as any,
        "checkAndTerminate",
      );

      // 1. Register an operation in IDLE_AWAITED — this calls
      //    checkAndTerminate which schedules termination (timer starts)
      checkpointManager.markOperationState(
        "invoke-1",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "invoke-1",
            type: OperationType.CHAINED_INVOKE,
            subType: OperationSubType.CHAINED_INVOKE,
          },
        },
      );

      expect(checkAndTerminateSpy).toHaveBeenCalledTimes(1);

      // 2. Enqueue a checkpoint while termination timer is ticking
      const checkpointPromise = checkpointManager.checkpoint("completed-step", {
        Action: "SUCCEED" as any,
        SubType: OperationSubType.STEP,
        Type: OperationType.STEP,
      });
      checkpointPromise.catch(() => {});

      // 3. Let the queue drain — terminationTimer is already set,
      //    so processQueue should NOT call checkAndTerminate again
      await jest.advanceTimersByTimeAsync(0);

      // checkAndTerminate should still have been called only once
      // (from markOperationState), not again from processQueue
      expect(checkAndTerminateSpy).toHaveBeenCalledTimes(1);

      // 4. Let the cooldown fire — termination should still happen
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS + 1);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.any(String),
        }),
      );
    });

    it("should terminate after queue drains when all operations are IDLE_AWAITED", async () => {
      // Setup: mock the checkpoint API to succeed
      mockClient.checkpointDurableExecution.mockResolvedValue({
        checkpointToken: "new-token",
      });

      // Simulate the parallel invoke race condition:
      // 1. A completed invoke checkpoints SUCCEED (adds to queue)
      const checkpointPromise = checkpointManager.checkpoint(
        "completed-invoke",
        {
          Action: "SUCCEED" as any,
          SubType: OperationSubType.CHAINED_INVOKE,
          Type: OperationType.CHAINED_INVOKE,
        },
      );
      checkpointPromise.catch(() => {});

      // 2. Pending invokes transition to IDLE_NOT_AWAITED (skips checkAndTerminate)
      checkpointManager.markOperationState(
        "pending-invoke-1",
        OperationLifecycleState.IDLE_NOT_AWAITED,
        {
          metadata: {
            stepId: "pending-invoke-1",
            type: OperationType.CHAINED_INVOKE,
            subType: OperationSubType.CHAINED_INVOKE,
          },
        },
      );

      // 3. Pending invokes transition to IDLE_AWAITED (calls checkAndTerminate,
      //    but queue is non-empty so shouldTerminate returns undefined)
      checkpointManager.markOperationAwaited("pending-invoke-1");

      // At this point, checkAndTerminate was called but couldn't terminate
      // because the queue was non-empty.
      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // 4. Let the queue drain (processQueue runs via setImmediate)
      await jest.advanceTimersByTimeAsync(0);

      // 5. After queue drains, processQueue should call checkAndTerminate,
      //    which now sees: queue empty, not processing, all ops IDLE_AWAITED
      //    → schedules termination → cooldown fires → terminates
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS + 1);

      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.any(String),
        }),
      );
    });

    it("should terminate after queue drains with multiple pending parallel invoke branches", async () => {
      // Simulates 4 parallel invoke branches where one completes and checkpoints
      // SUCCEED while the remaining 3 transition to IDLE_AWAITED. Verifies that
      // processQueue calls checkAndTerminate after the queue drains, allowing
      // the function to suspend while remaining branches are pending.
      mockClient.checkpointDurableExecution.mockResolvedValue({
        checkpointToken: "new-token",
      });

      // Branch A completed — its child context checkpoints SUCCEED (fire-and-forget)
      const checkpointPromise = checkpointManager.checkpoint(
        "branch-a-child-ctx",
        {
          Action: "SUCCEED" as any,
          SubType: OperationSubType.RUN_IN_CHILD_CONTEXT,
          Type: OperationType.CONTEXT,
        },
      );
      checkpointPromise.catch(() => {});

      // Branches B, C, D still running — their invokes go through Phase 1 → IDLE_NOT_AWAITED
      for (const branch of [
        "branch-b-invoke",
        "branch-c-invoke",
        "branch-d-invoke",
      ]) {
        checkpointManager.markOperationState(
          branch,
          OperationLifecycleState.IDLE_NOT_AWAITED,
          {
            metadata: {
              stepId: branch,
              type: OperationType.CHAINED_INVOKE,
              subType: OperationSubType.CHAINED_INVOKE,
            },
          },
        );
      }

      // Phase 2: all pending invokes transition to IDLE_AWAITED
      // Each calls checkAndTerminate, but queue is non-empty → no termination
      for (const branch of [
        "branch-b-invoke",
        "branch-c-invoke",
        "branch-d-invoke",
      ]) {
        checkpointManager.markOperationAwaited(branch);
      }

      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();

      // Queue drains → processQueue finally block → checkAndTerminate
      await jest.advanceTimersByTimeAsync(0);
      jest.advanceTimersByTime(CHECKPOINT_TERMINATION_COOLDOWN_MS + 1);

      // Function should suspend with all 3 pending invokes in IDLE_AWAITED
      expect(mockTerminationManager.terminate).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.any(String),
        }),
      );
    });
  });

  describe("startTimerWithPolling - invocation deadline and timer limits", () => {
    /**
     * Registers an awaited wait and returns a spy scoped to the poll timer.
     *
     * The spy has to be installed after markOperationState: that call schedules the
     * termination cooldown (CHECKPOINT_TERMINATION_COOLDOWN_MS), which would otherwise be
     * indistinguishable from the poll timer these tests are about.
     */
    const spyOnPollTimerFor = (
      stepId: string,
      waitEndsInMs: number,
    ): jest.SpyInstance => {
      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          endTimestamp: new Date(Date.now() + waitEndsInMs),
        },
      );

      const spy = jest.spyOn(global, "setTimeout");
      checkpointManager.waitForStatusChange(stepId);
      return spy;
    };

    it("skips the timer when the wait outlasts the invocation", () => {
      // The timer could not fire, so the execution should suspend and resume later
      // instead. This is the case the removed hard-coded cap approximated.
      mockRemainingTimeMs = 60_000;

      const setTimeoutSpy = spyOnPollTimerFor(
        "outlasts-invocation",
        5 * 60 * 1000,
      );

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it("schedules a timer beyond the removed bound when the invocation allows it", () => {
      // The point of the change: the ceiling is now the deadline the invocation reports, so
      // this wait is awaited in-invocation when the reported time allows it. Under the
      // removed hard-coded cap it was skipped regardless.
      mockRemainingTimeMs = 60 * 60 * 1000;
      const thirtyMinutes = 30 * 60 * 1000;

      const setTimeoutSpy = spyOnPollTimerFor(
        "within-long-invocation",
        thirtyMinutes,
      );

      expect(setTimeoutSpy).toHaveBeenCalled();
      const scheduledDelay = setTimeoutSpy.mock.calls[0][1] as number;
      expect(scheduledDelay).toBeGreaterThan(15 * 60 * 1000);
      expect(scheduledDelay).toBeLessThanOrEqual(thirtyMinutes);
      setTimeoutSpy.mockRestore();
    });

    it("skips the timer when the delay exceeds what setTimeout can represent", () => {
      // A compute with no deadline reports Infinity, so the invocation is no longer what
      // bounds this -- without the explicit clamp Node would set the duration to 1 and fire
      // almost immediately, turning a 60-day wait into a poll loop.
      mockRemainingTimeMs = Infinity;

      const setTimeoutSpy = spyOnPollTimerFor(
        "beyond-timer-range",
        60 * 24 * 60 * 60 * 1000,
      );

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    // The poll loop itself: when a timer fires, whether another poll is worth starting is
    // decided by the invocation's remaining time rather than a fixed budget measured from
    // the first poll. The timer is scheduled with the default (no deadline) and the
    // remaining time is set just before it fires, which models an invocation running down
    // and keeps this independent of the scheduling guard above. forceCheckpoint is stubbed
    // because a real one would bring in the checkpoint queue and the termination cooldown,
    // neither of which these tests are about.
    const runPollWithRemaining = async (
      stepId: string,
      remainingTimeMs: number,
    ): Promise<jest.SpyInstance> => {
      // Polling only matters while the invocation is alive for some other reason: a lone
      // awaited wait makes shouldTerminate suspend after the cooldown, which clears the poll
      // timer before it can fire. A concurrently EXECUTING operation blocks termination
      // (Rule 4), which is the situation in which polling does the work.
      checkpointManager.markOperationState(
        `${stepId}-concurrent`,
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: `${stepId}-concurrent`,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );

      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          endTimestamp: new Date(Date.now() + 1000),
        },
      );

      const forceCheckpointSpy = jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockResolvedValue();

      checkpointManager.waitForStatusChange(stepId);

      mockRemainingTimeMs = remainingTimeMs;
      await jest.advanceTimersByTimeAsync(1000);

      return forceCheckpointSpy;
    };

    it("polls while the invocation still has time left", async () => {
      const forceCheckpointSpy = await runPollWithRemaining(
        "time-remaining",
        60_000,
      );

      expect(forceCheckpointSpy).toHaveBeenCalled();
    });

    it("keeps polling long after the removed bound would have stopped", async () => {
      // The headline behaviour change, and the reason elapsed polling time is no longer
      // tracked: the removed budget stopped a loop after a fixed elapsed duration regardless
      // of how much invocation was left. Polling long enough to cross that duration is what
      // distinguishes this from the test above.
      mockRemainingTimeMs = 60 * 60 * 1000;
      const stepId = "past-old-budget";

      checkpointManager.markOperationState(
        `${stepId}-concurrent`,
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: `${stepId}-concurrent`,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );
      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          endTimestamp: new Date(Date.now() + 1000),
        },
      );

      const forceCheckpointSpy = jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockResolvedValue();

      checkpointManager.waitForStatusChange(stepId);

      await jest.advanceTimersByTimeAsync(16 * 60 * 1000);
      const pollsInFirst16Minutes = forceCheckpointSpy.mock.calls.length;

      forceCheckpointSpy.mockClear();
      await jest.advanceTimersByTimeAsync(60 * 1000);

      expect(pollsInFirst16Minutes).toBeGreaterThan(0);
      expect(forceCheckpointSpy).toHaveBeenCalled();
    });

    it("resolves the waiting promise once the status changes", async () => {
      // The success path polling exists for: a status change observed by a poll releases the
      // handler. Previously uncovered.
      mockRemainingTimeMs = 60_000;
      const stepId = "status-changes";

      checkpointManager.markOperationState(
        `${stepId}-concurrent`,
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: `${stepId}-concurrent`,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );
      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          endTimestamp: new Date(Date.now() + 1000),
        },
      );

      // Stand in for the backend reporting completion on the next refresh.
      jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockImplementation(async () => {
          (checkpointManager as any).stepData[hashId(stepId)] = {
            Status: "SUCCEEDED",
          };
        });

      let resolved = false;
      void checkpointManager.waitForStatusChange(stepId).then(() => {
        resolved = true;
      });

      await jest.advanceTimersByTimeAsync(1000);

      expect(resolved).toBe(true);
      const op = checkpointManager.getAllOperations().get(stepId);
      expect(op?.timer).toBeUndefined();
    });

    it("stops polling once too little invocation time remains", async () => {
      // Below MIN_REMAINING_TIME_TO_POLL_MS: not enough left to receive a result and act on
      // it, so the timer is cleared and the promise is left unresolved for suspension.
      const forceCheckpointSpy = await runPollWithRemaining(
        "deadline-imminent",
        500,
      );

      expect(forceCheckpointSpy).not.toHaveBeenCalled();
      const op = checkpointManager.getAllOperations().get("deadline-imminent");
      expect(op?.timer).toBeUndefined();
    });

    it("schedules a timer with no deadline when the delay is representable", () => {
      mockRemainingTimeMs = Infinity;
      const fiveMinutes = 5 * 60 * 1000;

      const setTimeoutSpy = spyOnPollTimerFor(
        "no-deadline-short-wait",
        fiveMinutes,
      );

      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(setTimeoutSpy.mock.calls[0][1]).toBeLessThanOrEqual(fiveMinutes);
      setTimeoutSpy.mockRestore();
    });
  });

  describe("dispose", () => {
    const armPollTimerFor = (
      stepId: string,
      manager = checkpointManager,
    ): void => {
      manager.markOperationState(
        `${stepId}-concurrent`,
        OperationLifecycleState.EXECUTING,
        {
          metadata: {
            stepId: `${stepId}-concurrent`,
            type: OperationType.STEP,
            subType: OperationSubType.STEP,
          },
        },
      );
      manager.markOperationState(stepId, OperationLifecycleState.IDLE_AWAITED, {
        metadata: {
          stepId,
          type: OperationType.WAIT,
          subType: OperationSubType.WAIT,
        },
        endTimestamp: new Date(Date.now() + 1000),
      });
      manager.waitForStatusChange(stepId);
    };

    it("clears armed timers so they cannot fire into a later invocation", async () => {
      // The gap this closes: a handler completing normally never terminates, so nothing
      // else clears its timers.
      const forceCheckpointSpy = jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockResolvedValue();
      armPollTimerFor("armed-then-disposed");

      expect(
        checkpointManager.getAllOperations().get("armed-then-disposed")?.timer,
      ).toBeDefined();

      checkpointManager.dispose();

      expect(
        checkpointManager.getAllOperations().get("armed-then-disposed")?.timer,
      ).toBeUndefined();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(forceCheckpointSpy).not.toHaveBeenCalled();
    });

    it("refuses to arm new timers once disposed", async () => {
      const forceCheckpointSpy = jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockResolvedValue();

      checkpointManager.dispose();
      armPollTimerFor("armed-after-disposal");

      expect(
        checkpointManager.getAllOperations().get("armed-after-disposal")?.timer,
      ).toBeUndefined();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(forceCheckpointSpy).not.toHaveBeenCalled();
    });

    it("cancels a scheduled termination", async () => {
      // A lone awaited wait schedules termination after the cooldown. If the invocation ends
      // first, that timer would otherwise fire and terminate an invocation that is already
      // over.
      checkpointManager.markOperationState(
        "lone-wait",
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId: "lone-wait",
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
        },
      );

      checkpointManager.dispose();
      await jest.advanceTimersByTimeAsync(
        CHECKPOINT_TERMINATION_COOLDOWN_MS * 5,
      );

      expect(mockTerminationManager.terminate).not.toHaveBeenCalled();
    });

    it("is idempotent", () => {
      checkpointManager.dispose();
      expect(() => checkpointManager.dispose()).not.toThrow();
    });

    it("keeps polling when a second execution starts in the same process", async () => {
      // The reason this is per-manager state rather than a module-level "current
      // invocation" marker. A process-wide marker identifies the newest invocation, so a
      // second execution starting would make the first one's manager stale: it would stop
      // polling and stop arming timers while its operation stayed awaited with an
      // unresolved resolver -- a hang. Executions already run concurrently in one process:
      // the local test runner's factory creates nested runners for exactly that. This is not
      // reachable through a single deployed invocation, which is why it needs a test rather
      // than review vigilance.
      const firstForceCheckpoint = jest
        .spyOn(checkpointManager, "forceCheckpoint")
        .mockResolvedValue();
      armPollTimerFor("first-execution");

      // A second execution begins while the first is still live.
      const secondManager = new CheckpointManager(
        "second-arn",
        {},
        mockClient,
        mockTerminationManager,
        "second-token",
        new EventEmitter(),
        {} as never,
        new Set<string>(),
        {},
        "",
        () => mockRemainingTimeMs,
      );
      armPollTimerFor("second-execution", secondManager);

      // The first execution must be unaffected, both by the second starting...
      await jest.advanceTimersByTimeAsync(1000);
      expect(firstForceCheckpoint).toHaveBeenCalled();

      // ...and by it finishing.
      firstForceCheckpoint.mockClear();
      secondManager.dispose();
      armPollTimerFor("first-execution-again");
      await jest.advanceTimersByTimeAsync(1000);
      expect(firstForceCheckpoint).toHaveBeenCalled();
    });
  });
});
