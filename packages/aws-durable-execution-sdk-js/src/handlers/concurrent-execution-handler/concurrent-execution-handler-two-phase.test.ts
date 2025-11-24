import { createConcurrentExecutionHandler } from "./concurrent-execution-handler";
import {
  ExecutionContext,
  ConcurrentExecutionItem,
  ConcurrentExecutor,
} from "../../types";
import { DurablePromise } from "../../types/durable-promise";

describe("Concurrent Execution Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockRunInChildContext: jest.Mock;
  let mockStep: jest.Mock;
  let executionStarted = false;

  beforeEach(() => {
    executionStarted = false;
    mockContext = {
      getStepData: jest.fn().mockReturnValue(null),
      durableExecutionArn: "test-arn",
      terminationManager: {
        shouldTerminate: jest.fn().mockReturnValue(false),
        terminate: jest.fn(),
      },
    } as any;

    // Mock runInChildContext to track when execution starts
    mockRunInChildContext = jest
      .fn()
      .mockImplementation(async (name, fn, _config) => {
        executionStarted = true;
        // Create a mock child context with runInChildContext method
        const mockChildContext = {
          runInChildContext: jest
            .fn()
            .mockImplementation(async (childName, childFn) => {
              return await childFn({} as any);
            }),
        };
        return await fn(mockChildContext);
      });

    mockStep = jest.fn().mockImplementation(async (name, fn) => {
      return await fn();
    });
  });

  it("should start execution in phase 1 immediately (before await)", async () => {
    const concurrentHandler = createConcurrentExecutionHandler(
      mockContext,
      mockRunInChildContext,
      mockStep,
    );

    const items: ConcurrentExecutionItem<string>[] = [
      { id: "item1", data: "test1", index: 0 },
    ];

    const executor: ConcurrentExecutor<string, string> = jest
      .fn()
      .mockResolvedValue("processed");

    // Phase 1: Create the promise - this should start execution immediately
    const concurrentPromise = concurrentHandler(
      "test-concurrent",
      items,
      executor,
    );

    // Should return a DurablePromise
    expect(concurrentPromise).toBeInstanceOf(DurablePromise);

    // Wait briefly for phase 1 to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 1 should have started execution (before we await the promise)
    expect(executionStarted).toBe(true);

    // Now await the promise to verify it completes
    const result = await concurrentPromise;
    expect(result).toBeDefined();
  });

  it("should mark promise as executed only when awaited", async () => {
    const concurrentHandler = createConcurrentExecutionHandler(
      mockContext,
      mockRunInChildContext,
      mockStep,
    );

    const items: ConcurrentExecutionItem<string>[] = [
      { id: "item1", data: "test1", index: 0 },
    ];

    const executor: ConcurrentExecutor<string, string> = jest
      .fn()
      .mockResolvedValue("result");

    // Phase 1: Create the promise
    const concurrentPromise = concurrentHandler(
      "test-concurrent",
      items,
      executor,
    );

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promise should not be marked as executed yet (not awaited)
    expect((concurrentPromise as DurablePromise<any>).isExecuted).toBe(false);

    // Phase 2: Await the promise
    await concurrentPromise;

    // Now it should be marked as executed
    expect((concurrentPromise as DurablePromise<any>).isExecuted).toBe(true);
  });
});
