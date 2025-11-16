import { createWaitHandler } from "./wait-handler";
import { ExecutionContext } from "../../types";
import { EventEmitter } from "events";
import { DurablePromise } from "../../types/durable-promise";

describe("Wait Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: any;
  let createStepId: () => string;
  let hasRunningOperations: () => boolean;
  let getOperationsEmitter: () => EventEmitter;
  let stepIdCounter = 0;

  beforeEach(() => {
    stepIdCounter = 0;
    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
    } as any;

    mockCheckpoint = jest.fn().mockResolvedValue(undefined);
    mockCheckpoint.force = jest.fn().mockResolvedValue(undefined);
    mockCheckpoint.setTerminating = jest.fn();
    mockCheckpoint.hasPendingAncestorCompletion = jest
      .fn()
      .mockReturnValue(false);

    createStepId = () => `step-${++stepIdCounter}`;
    hasRunningOperations = jest.fn().mockReturnValue(false);
    getOperationsEmitter = () => new EventEmitter();
  });

  it("should execute wait logic in phase 1 without terminating", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise - this executes the logic but doesn't terminate
    const waitPromise = waitHandler({ seconds: 5 });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should return a DurablePromise
    expect(waitPromise).toBeInstanceOf(DurablePromise);

    // Phase 1 should have executed (checkpoint called)
    expect(mockCheckpoint).toHaveBeenCalled();
    expect(mockContext.getStepData).toHaveBeenCalled();
  });

  it("should execute wait logic again in phase 2 when awaited", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const waitPromise = waitHandler({ seconds: 5 });

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const phase1Calls = mockCheckpoint.mock.calls.length;

    // Phase 2: Await the promise - this should execute again
    try {
      await waitPromise;
    } catch (error) {
      // Expected to throw termination error
    }

    // Phase 2 execution should have happened (more checkpoint calls)
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(true);
    expect(mockCheckpoint.mock.calls.length).toBeGreaterThan(phase1Calls);
  });

  it("should work correctly with Promise.race", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create multiple wait promises
    const wait1 = waitHandler({ seconds: 5 });
    const wait2 = waitHandler({ seconds: 1 });

    // Neither should be executed yet
    expect((wait1 as DurablePromise<void>).isExecuted).toBe(false);
    expect((wait2 as DurablePromise<void>).isExecuted).toBe(false);

    // Phase 2: Use Promise.race - this should trigger execution
    try {
      await Promise.race([wait1, wait2]);
    } catch (error) {
      // Expected to throw termination error
    }

    // At least one should be executed
    const executed =
      (wait1 as DurablePromise<void>).isExecuted ||
      (wait2 as DurablePromise<void>).isExecuted;
    expect(executed).toBe(true);
  });

  it("should execute wait logic when .then is called", async () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const waitPromise = waitHandler({ seconds: 5 });
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(false);

    // Phase 2: Call .then - this should trigger execution
    const thenPromise = waitPromise.then(() => {}).catch(() => {});

    // Should be marked as executed
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(true);
  });
});
