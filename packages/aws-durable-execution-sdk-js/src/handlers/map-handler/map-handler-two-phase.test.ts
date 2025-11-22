import { createMapHandler } from "./map-handler";
import { ExecutionContext, MapFunc } from "../../types";
import { DurablePromise } from "../../types/durable-promise";

describe("Map Handler Two-Phase Execution", () => {
  let mockContext: ExecutionContext;
  let mockExecuteConcurrently: jest.Mock;
  let executionStarted = false;

  beforeEach(() => {
    executionStarted = false;
    mockContext = {
      durableExecutionArn: "test-arn",
    } as any;

    mockExecuteConcurrently = jest.fn().mockImplementation(async () => {
      executionStarted = true;
      return {
        totalCount: 1,
        successCount: 1,
        failureCount: 0,
        hasFailures: false,
        status: "SUCCEEDED",
        completionReason: "ALL_COMPLETED",
        successfulItems: [{ index: 0, result: "processed" }],
        failedItems: [],
      };
    });
  });

  it("should start execution in phase 1 immediately (before await)", async () => {
    const mapHandler = createMapHandler(mockContext, mockExecuteConcurrently);

    const items = ["item1"];
    const mapFunc: MapFunc<string, string> = jest
      .fn()
      .mockResolvedValue("processed");

    // Phase 1: Create the promise - this should start execution immediately
    const mapPromise = mapHandler(items, mapFunc);

    // Should return a DurablePromise
    expect(mapPromise).toBeInstanceOf(DurablePromise);

    // Wait briefly for phase 1 to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 1 should have started execution (before we await the promise)
    expect(executionStarted).toBe(true);
    expect(mockExecuteConcurrently).toHaveBeenCalled();

    // Now await the promise to verify it completes
    const result = await mapPromise;
    expect(result).toBeDefined();
  });

  it("should mark promise as executed only when awaited", async () => {
    const mapHandler = createMapHandler(mockContext, mockExecuteConcurrently);

    const items = ["item1"];
    const mapFunc: MapFunc<string, string> = jest
      .fn()
      .mockResolvedValue("result");

    // Phase 1: Create the promise
    const mapPromise = mapHandler(items, mapFunc);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promise should not be marked as executed yet (not awaited)
    expect((mapPromise as DurablePromise<any>).isExecuted).toBe(false);

    // Phase 2: Await the promise
    await mapPromise;

    // Now it should be marked as executed
    expect((mapPromise as DurablePromise<any>).isExecuted).toBe(true);
  });
});
