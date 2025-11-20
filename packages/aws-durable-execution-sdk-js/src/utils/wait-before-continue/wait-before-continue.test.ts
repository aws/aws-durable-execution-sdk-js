import { waitBeforeContinue } from "./wait-before-continue";
import { ExecutionContext } from "../../types";
import { OperationStatus, Operation } from "@aws-sdk/client-lambda";
import { EventEmitter } from "events";
import { OPERATIONS_COMPLETE_EVENT } from "../constants/constants";
import { STEP_DATA_UPDATED_EVENT } from "../checkpoint/checkpoint";
import { hashId } from "../step-id-utils/step-id-utils";

describe("waitBeforeContinue", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let mockHasRunningOperations: jest.Mock;
  let mockOperationsEmitter: EventEmitter;
  let timers: NodeJS.Timeout[] = [];

  beforeEach(() => {
    mockContext = {
      getStepData: jest.fn(),
    } as any;
    mockHasRunningOperations = jest.fn();
    mockOperationsEmitter = new EventEmitter();
    timers = [];
  });

  afterEach(() => {
    // Clean up any remaining timers
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
  });

  test("should resolve when operations complete", async () => {
    let operationsRunning = true;
    mockHasRunningOperations.mockImplementation(() => operationsRunning);

    const resultPromise = waitBeforeContinue({
      checkHasRunningOperations: true,
      checkStepStatus: false,
      checkTimer: false,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    // Complete operations after 50ms
    const timer = setTimeout(() => {
      operationsRunning = false;
      mockOperationsEmitter.emit(OPERATIONS_COMPLETE_EVENT);
    }, 50);
    timers.push(timer);

    const result = await resultPromise;
    expect(result.reason).toBe("operations");
  });

  test("should resolve when timer expires immediately", async () => {
    const expiredTime = new Date(Date.now() - 1000); // Already expired

    const result = await waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: false,
      checkTimer: true,
      scheduledEndTimestamp: expiredTime,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    expect(result.reason).toBe("timer");
    expect(result.timerExpired).toBe(true);
  });

  test("should resolve when timer expires in future", async () => {
    const futureTime = new Date(Date.now() + 50); // 50ms in future

    const result = await waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: false,
      checkTimer: true,
      scheduledEndTimestamp: futureTime,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    expect(result.reason).toBe("timer");
    expect(result.timerExpired).toBe(true);
  });

  test("should resolve when step status changes", async () => {
    let stepStatus: OperationStatus = OperationStatus.STARTED;
    mockContext.getStepData.mockImplementation(
      () => ({ Status: stepStatus }) as Operation,
    );

    const resultPromise = waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: true,
      checkTimer: false,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    // Change status after 50ms
    const timer = setTimeout(() => {
      stepStatus = OperationStatus.SUCCEEDED;
      mockOperationsEmitter.emit(STEP_DATA_UPDATED_EVENT, hashId("test-step"));
    }, 50);
    timers.push(timer);

    const result = await resultPromise;
    expect(result.reason).toBe("status");
  });

  test("should resolve immediately when step status already changed", async () => {
    // Status starts as STARTED
    mockContext.getStepData
      .mockReturnValueOnce({ Status: OperationStatus.STARTED } as Operation)
      // Then immediately returns SUCCEEDED on next call
      .mockReturnValueOnce({ Status: OperationStatus.SUCCEEDED } as Operation);

    const result = await waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: true,
      checkTimer: false,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    expect(result.reason).toBe("status");
  });

  test("should return timeout when no conditions are enabled", async () => {
    const result = await waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: false,
      checkTimer: false,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
    });

    expect(result.reason).toBe("timeout");
  });

  test("should call checkpoint.force when timer expires", async () => {
    const expiredTime = new Date(Date.now() - 1000); // Already expired
    const mockCheckpoint = {
      force: jest.fn().mockResolvedValue(undefined),
    } as any;

    const result = await waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: false,
      checkTimer: true,
      scheduledEndTimestamp: expiredTime,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
      checkpoint: mockCheckpoint,
    });

    expect(result.reason).toBe("timer");
    expect(result.timerExpired).toBe(true);
    expect(mockCheckpoint.force).toHaveBeenCalled();
  });

  test("should resolve when onAwaitedChange callback is invoked", async () => {
    let awaitedCallback: (() => void) | undefined;

    const resultPromise = waitBeforeContinue({
      checkHasRunningOperations: false,
      checkStepStatus: false,
      checkTimer: false,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      operationsEmitter: mockOperationsEmitter,
      onAwaitedChange: (callback) => {
        awaitedCallback = callback;
      },
    });

    // Invoke the callback after 50ms
    const timer = setTimeout(() => {
      awaitedCallback?.();
    }, 50);
    timers.push(timer);

    const result = await resultPromise;
    expect(result.reason).toBe("status");
  });
});
