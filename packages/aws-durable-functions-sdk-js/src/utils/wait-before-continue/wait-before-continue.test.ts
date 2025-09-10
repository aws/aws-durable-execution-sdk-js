import { waitBeforeContinue } from "./wait-before-continue";
import { ExecutionContext } from "../../types";
import { OperationStatus, Operation } from "@amzn/dex-internal-sdk";

describe("waitBeforeContinue", () => {
  let mockContext: jest.Mocked<ExecutionContext>;
  let mockHasRunningOperations: jest.Mock;
  let timers: NodeJS.Timeout[] = [];

  beforeEach(() => {
    mockContext = {
      getStepData: jest.fn(),
    } as any;
    mockHasRunningOperations = jest.fn();
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
      pollingInterval: 10, // Fast polling for test
    });

    // Complete operations after 50ms
    const timer = setTimeout(() => {
      operationsRunning = false;
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
      scheduledTimestamp: expiredTime,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
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
      pollingInterval: 10, // Fast polling for test
    });

    // Change status after 50ms
    const timer = setTimeout(() => {
      stepStatus = OperationStatus.SUCCEEDED;
    }, 50);
    timers.push(timer);

    const result = await resultPromise;
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
      scheduledTimestamp: expiredTime,
      stepId: "test-step",
      context: mockContext,
      hasRunningOperations: mockHasRunningOperations,
      checkpoint: mockCheckpoint,
    });

    expect(result.reason).toBe("timer");
    expect(result.timerExpired).toBe(true);
    expect(mockCheckpoint.force).toHaveBeenCalled();
  });
});
