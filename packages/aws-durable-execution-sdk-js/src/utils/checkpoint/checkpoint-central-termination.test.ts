import { CheckpointManager } from "./checkpoint-manager";
import { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import { OperationLifecycleState, OperationSubType } from "../../types";
import { OperationType } from "@aws-sdk/client-lambda";
import { EventEmitter } from "events";
import { hashId } from "../step-id-utils/step-id-utils";
import {
  CHECKPOINT_TERMINATION_COOLDOWN_MS,
  MAX_POLL_DURATION_MS,
} from "../constants/constants";

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
      "test-token",
      mockStepDataEmitter,
      {} as any,
      new Set<string>(),
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
          expect(op?.pollStartTime).toBeUndefined();

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
        expect(op?.pollStartTime).toBeUndefined();

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
        expect(op?.pollStartTime).toBeDefined();

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
        expect(op?.pollStartTime).toBeDefined();

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
        expect(op?.pollStartTime).toBeDefined();

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
          expect(op?.pollStartTime).toBeUndefined();

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
        expect(op?.pollStartTime).toBeUndefined();

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
        expect(op?.pollStartTime).toBeDefined();

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
        expect(op?.pollStartTime).toBeDefined();

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
        expect(op?.pollStartTime).toBeDefined();

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

  describe("startTimerWithPolling - setTimeout overflow protection", () => {
    it("should skip setTimeout when delay exceeds MAX_POLL_DURATION_MS", () => {
      const stepId = "long-wait-step";

      // Create operation in IDLE_AWAITED state
      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          // Set endTimestamp to 364 days in the future (exceeds MAX_POLL_DURATION_MS)
          endTimestamp: new Date(Date.now() + 364 * 24 * 60 * 60 * 1000),
        },
      );

      // Spy on setTimeout to verify it's not called
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      // Call waitForStatusChange which internally calls startTimerWithPolling
      checkpointManager.waitForStatusChange(stepId);

      // Verify setTimeout was NOT called
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });

    it("should use setTimeout when delay is within MAX_POLL_DURATION_MS", () => {
      const stepId = "short-wait-step";
      const shortDelay = 5 * 60 * 1000; // 5 minutes

      // Create operation in IDLE_AWAITED state
      checkpointManager.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_AWAITED,
        {
          metadata: {
            stepId,
            type: OperationType.WAIT,
            subType: OperationSubType.WAIT,
          },
          // Set endTimestamp to 5 minutes in the future
          endTimestamp: new Date(Date.now() + shortDelay),
        },
      );

      // Spy on setTimeout to capture the delay value
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      // Call waitForStatusChange which internally calls startTimerWithPolling
      checkpointManager.waitForStatusChange(stepId);

      // Verify setTimeout was called with original delay (within tolerance)
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Number),
      );

      const actualDelay = setTimeoutSpy.mock.calls[0][1] as number;
      expect(actualDelay).toBeLessThanOrEqual(shortDelay);
      expect(actualDelay).toBeGreaterThan(shortDelay - 1000); // Allow 1s tolerance

      setTimeoutSpy.mockRestore();
    });
  });
});
