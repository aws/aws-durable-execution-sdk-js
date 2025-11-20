import { createStepHandler } from "./step-handler";
import { ExecutionContext } from "../../types";
import { EventEmitter } from "events";
import { DurablePromise } from "../../types/durable-promise";
import { Context } from "aws-lambda";

describe("Step Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: any;
  let mockParentContext: Context;
  let createStepId: () => string;
  let createContextLogger: (stepId: string, attempt?: number) => any;
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

    mockParentContext = {
      getRemainingTimeInMillis: jest.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `step-${++stepIdCounter}`;
    createContextLogger = jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
    addRunningOperation = jest.fn();
    removeRunningOperation = jest.fn();
    hasRunningOperations = jest.fn().mockReturnValue(false) as () => boolean;
    getOperationsEmitter = (): EventEmitter => new EventEmitter();
  });

  it("should execute step logic in phase 1 immediately", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createContextLogger,
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    // Phase 1: Create the promise - this executes the logic immediately
    const stepPromise = stepHandler(stepFn);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should return a DurablePromise
    expect(stepPromise).toBeInstanceOf(DurablePromise);

    // Phase 1 should have executed the step function
    expect(stepFn).toHaveBeenCalled();
    expect(mockCheckpoint).toHaveBeenCalled();
  });

  it("should return cached result in phase 2 when awaited", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createContextLogger,
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
    );

    const stepFn = jest.fn().mockResolvedValue("test-result");

    // Phase 1: Create the promise
    const stepPromise = stepHandler(stepFn);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const phase1Calls = stepFn.mock.calls.length;

    // Phase 2: Await the promise - should return cached result
    const result = await stepPromise;

    // Should return the result from phase 1
    expect(result).toBe("test-result");

    // Step function should not be called again in phase 2
    expect(stepFn.mock.calls.length).toBe(phase1Calls);

    // Promise should be marked as executed
    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(true);
  });

  it("should mark isAwaited and invoke callback when promise is awaited", async () => {
    const stepHandler = createStepHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      createContextLogger,
      addRunningOperation,
      removeRunningOperation,
      hasRunningOperations,
      getOperationsEmitter,
    );

    const stepFn = jest.fn().mockResolvedValue("result");

    // Phase 1: Create the promise
    const stepPromise = stepHandler(stepFn);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promise should not be marked as executed yet (not awaited)
    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(false);

    // Phase 2: Await the promise
    await stepPromise;

    // Now it should be marked as executed
    expect((stepPromise as DurablePromise<string>).isExecuted).toBe(true);
  });
});
