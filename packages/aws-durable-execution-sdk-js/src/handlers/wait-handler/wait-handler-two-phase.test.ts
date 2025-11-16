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

  it("should create DurablePromise without executing wait logic immediately", () => {
    const waitHandler = createWaitHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      hasRunningOperations,
      getOperationsEmitter,
    );

    // Phase 1: Create the promise
    const waitPromise = waitHandler({ seconds: 5 });

    // Should return a DurablePromise
    expect(waitPromise).toBeInstanceOf(DurablePromise);
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(false);

    // Should not have called checkpoint yet
    expect(mockCheckpoint).not.toHaveBeenCalled();
    expect(mockContext.getStepData).not.toHaveBeenCalled();
  });

  it("should execute wait logic only when promise is awaited", async () => {
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

    // Phase 2: Await the promise - this should trigger execution
    try {
      await waitPromise;
    } catch (error) {
      // Expected to throw termination error
    }

    // Now the execution should have happened
    expect((waitPromise as DurablePromise<void>).isExecuted).toBe(true);
    expect(mockCheckpoint).toHaveBeenCalled();
    expect(mockContext.getStepData).toHaveBeenCalled();
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
