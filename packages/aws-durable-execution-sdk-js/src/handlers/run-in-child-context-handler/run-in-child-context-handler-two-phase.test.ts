import { createRunInChildContextHandler } from "./run-in-child-context-handler";
import { ExecutionContext } from "../../types";
import { DurablePromise } from "../../types/durable-promise";
import { Context } from "aws-lambda";

describe("Run In Child Context Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: any;
  let mockParentContext: Context;
  let createStepId: () => string;
  let getParentLogger: () => any;
  let createChildContext: jest.Mock;
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

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      force: jest.fn().mockResolvedValue(undefined),
      setTerminating: jest.fn(),
      markAncestorFinished: jest.fn(),
    };

    mockParentContext = {
      getRemainingTimeInMillis: jest.fn().mockReturnValue(30000),
    } as any;

    createStepId = (): string => `child-${++stepIdCounter}`;
    getParentLogger = jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });

    createChildContext = jest.fn().mockReturnValue({
      step: jest.fn().mockResolvedValue("child-result"),
    } as any);
  });

  it("should execute child context logic in phase 1 immediately", async () => {
    const handler = createRunInChildContextHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      getParentLogger,
      createChildContext,
    );

    const childFn = jest.fn().mockResolvedValue("result");

    // Phase 1: Create the promise - this executes the logic immediately
    const childPromise = handler(childFn);

    // Should return a DurablePromise
    expect(childPromise).toBeInstanceOf(DurablePromise);

    // Wait briefly for phase 1 to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 1 should have executed the child function (before we await the promise)
    expect(childFn).toHaveBeenCalled();
    expect(mockCheckpoint.checkpoint).toHaveBeenCalled();

    // Now await the promise to verify it completes
    await childPromise;
  });

  it("should return cached result in phase 2 when awaited", async () => {
    const handler = createRunInChildContextHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      getParentLogger,
      createChildContext,
    );

    const childFn = jest.fn().mockResolvedValue("test-result");

    // Phase 1: Create the promise
    const childPromise = handler(childFn);

    // Wait briefly for phase 1 to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Child function should have been called before we await the promise
    const phase1Calls = childFn.mock.calls.length;
    expect(phase1Calls).toBeGreaterThan(0);

    // Phase 2: Await the promise - should return cached result
    const result = await childPromise;

    // Should return the result from phase 1
    expect(result).toBe("test-result");

    // Child function should not be called again in phase 2
    expect(childFn.mock.calls.length).toBe(phase1Calls);

    // Promise should be marked as executed
    expect((childPromise as DurablePromise<string>).isExecuted).toBe(true);
  });

  it("should mark promise as executed only after being awaited", async () => {
    const handler = createRunInChildContextHandler(
      mockContext,
      mockCheckpoint,
      mockParentContext,
      createStepId,
      getParentLogger,
      createChildContext,
    );

    const childFn = jest.fn().mockResolvedValue("result");

    // Phase 1: Create the promise
    const childPromise = handler(childFn);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promise should not be marked as executed yet (not awaited)
    expect((childPromise as DurablePromise<string>).isExecuted).toBe(false);

    // Phase 2: Await the promise
    await childPromise;

    // Now it should be marked as executed
    expect((childPromise as DurablePromise<string>).isExecuted).toBe(true);
  });
});
