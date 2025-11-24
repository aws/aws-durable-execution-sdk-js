import { createWaitForConditionHandler } from "./wait-for-condition-handler";
import {
  DurableLogger,
  ExecutionContext,
  WaitForConditionCheckFunc,
} from "../../types";
import { EventEmitter } from "events";
import { DurablePromise } from "../../types/durable-promise";
import { createDefaultLogger } from "../../utils/logger/default-logger";

describe("WaitForCondition Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: any;
  let createStepId: () => string;
  let addRunningOperation: jest.Mock;
  let removeRunningOperation: jest.Mock;
  let hasRunningOperations: () => boolean;
  let getOperationsEmitter: () => EventEmitter;
  let stepIdCounter = 0;

  beforeEach(() => {
    stepIdCounter = 0;
    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      durableExecutionArn: "test-arn",
      terminationManager: {
        shouldTerminate: jest.fn().mockReturnValue(false),
        terminate: jest.fn(),
      },
    } as any;

    mockCheckpoint = jest.fn().mockResolvedValue(undefined);
    mockCheckpoint.force = jest.fn().mockResolvedValue(undefined);
    mockCheckpoint.setTerminating = jest.fn();
    mockCheckpoint.hasPendingAncestorCompletion = jest
      .fn()
      .mockReturnValue(false);

    createStepId = (): string => `step-${++stepIdCounter}`;

    addRunningOperation = jest.fn();
    removeRunningOperation = jest.fn();
    hasRunningOperations = jest.fn().mockReturnValue(false) as () => boolean;
    getOperationsEmitter = (): EventEmitter => new EventEmitter();
  });

  it("should execute check function in phase 1 immediately", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<number, DurableLogger> = jest
      .fn()
      .mockResolvedValue(10);

    // Phase 1: Create the promise - this executes the logic immediately
    const promise = waitForConditionHandler(checkFn, {
      initialState: 0,
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });

    // Should return a DurablePromise
    expect(promise).toBeInstanceOf(DurablePromise);

    // Wait briefly for phase 1 to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 1 should have executed the check function (before we await the promise)
    expect(checkFn).toHaveBeenCalled();
    expect(mockCheckpoint).toHaveBeenCalled();

    // Now await the promise to verify it completes
    await promise;
  });

  it("should return cached result in phase 2 when awaited", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
      undefined,
    );

    const checkFn: WaitForConditionCheckFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("completed");

    // Phase 1: Create the promise
    const promise = waitForConditionHandler(checkFn, {
      initialState: "initial",
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });

    // Wait briefly for phase 1 to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Check function should have been called before we await the promise
    expect(checkFn).toHaveBeenCalledTimes(1);

    // Phase 2: Await the promise to get the result
    const result = await promise;

    expect(result).toBe("completed");
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("should execute check function before await", async () => {
    const waitForConditionHandler = createWaitForConditionHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      createDefaultLogger(),
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
      undefined,
    );

    let executionOrder: string[] = [];
    const checkFn: WaitForConditionCheckFunc<number, DurableLogger> = jest.fn(
      async () => {
        executionOrder.push("check-executed");
        return 42;
      },
    );

    // Phase 1: Create the promise
    executionOrder.push("promise-created");
    const promise = waitForConditionHandler(checkFn, {
      initialState: 0,
      waitStrategy: (_state) => ({ shouldContinue: false }),
    });
    executionOrder.push("after-handler-call");

    // Wait briefly for phase 1 to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Check should have executed before we await
    expect(checkFn).toHaveBeenCalled();

    executionOrder.push("before-await");
    const result = await promise;
    executionOrder.push("after-await");

    // Verify execution order: check should execute before await
    expect(executionOrder).toEqual([
      "promise-created",
      "check-executed",
      "after-handler-call",
      "before-await",
      "after-await",
    ]);
    expect(result).toBe(42);
  });
});
