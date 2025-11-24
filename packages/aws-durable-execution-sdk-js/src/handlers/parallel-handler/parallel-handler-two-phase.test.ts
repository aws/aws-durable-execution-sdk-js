import { createParallelHandler } from "./parallel-handler";
import { DurableLogger, ExecutionContext, ParallelFunc } from "../../types";
import { DurablePromise } from "../../types/durable-promise";

describe("Parallel Handler Two-Phase Execution", () => {
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
        successfulItems: [{ index: 0, result: "branch-result" }],
        failedItems: [],
      };
    });
  });

  it("should start execution in phase 1 immediately (before await)", async () => {
    const parallelHandler = createParallelHandler(
      mockContext,
      mockExecuteConcurrently,
    );

    const branch1: ParallelFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("branch1-result");

    const branches = [branch1];

    // Phase 1: Create the promise - this should start execution immediately
    const parallelPromise = parallelHandler(branches);

    // Should return a DurablePromise
    expect(parallelPromise).toBeInstanceOf(DurablePromise);

    // Wait briefly for phase 1 to start executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Phase 1 should have started execution (before we await the promise)
    expect(executionStarted).toBe(true);
    expect(mockExecuteConcurrently).toHaveBeenCalled();

    // Now await the promise to verify it completes
    const result = await parallelPromise;
    expect(result).toBeDefined();
  });

  it("should mark promise as executed only when awaited", async () => {
    const parallelHandler = createParallelHandler(
      mockContext,
      mockExecuteConcurrently,
    );

    const branch1: ParallelFunc<string, DurableLogger> = jest
      .fn()
      .mockResolvedValue("result");

    const branches = [branch1];

    // Phase 1: Create the promise
    const parallelPromise = parallelHandler(branches);

    // Wait for phase 1 to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promise should not be marked as executed yet (not awaited)
    expect((parallelPromise as DurablePromise<any>).isExecuted).toBe(false);

    // Phase 2: Await the promise
    await parallelPromise;

    // Now it should be marked as executed
    expect((parallelPromise as DurablePromise<any>).isExecuted).toBe(true);
  });
});
