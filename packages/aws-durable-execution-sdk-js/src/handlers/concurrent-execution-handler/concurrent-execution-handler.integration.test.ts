import { createTestDurableContext } from "../../testing/create-test-durable-context";
import { BatchItemStatus, DurableContext } from "../../types";

describe("ConcurrentExecutionHandler Integration Tests", () => {
  it("should execute items concurrently with real DurableContext", async () => {
    const { context } = createTestDurableContext();

    const items = [
      { id: "item-1", data: { value: 1 }, index: 0 },
      { id: "item-2", data: { value: 2 }, index: 1 },
      { id: "item-3", data: { value: 3 }, index: 2 },
    ];

    const executionOrder: number[] = [];

    const result = await context._executeConcurrently(
      items,
      async (item: (typeof items)[0]) => {
        executionOrder.push(item.data.value);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item.data.value * 2;
      },
      { maxConcurrency: 2 },
    );

    expect(result.totalCount).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.all).toHaveLength(3);

    const successfulResults = result.succeeded();
    expect(successfulResults).toHaveLength(3);
    expect(
      successfulResults.map((r: (typeof successfulResults)[0]) => r.result),
    ).toEqual([2, 4, 6]);

    expect(
      result.all.every(
        (item: (typeof result.all)[0]) =>
          item.status === BatchItemStatus.SUCCEEDED,
      ),
    ).toBe(true);
  });

  it("should respect maxConcurrency limit", async () => {
    const { context } = createTestDurableContext();

    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      data: { value: i },
      index: i,
    }));

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const result = await context._executeConcurrently(
      items,
      async (item: (typeof items)[0]) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return item.data.value;
      },
      { maxConcurrency: 3 },
    );

    expect(result.totalCount).toBe(10);
    expect(result.successCount).toBe(10);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it("should use child context for each item execution", async () => {
    const { context } = createTestDurableContext();

    const items = [
      { id: "item-1", data: { value: 1 }, index: 0 },
      { id: "item-2", data: { value: 2 }, index: 1 },
    ];

    const childContexts: any[] = [];

    const result = await context._executeConcurrently(
      items,
      async (item: (typeof items)[0], childContext: DurableContext) => {
        childContexts.push(childContext);

        // Use child context to run a step
        const stepResult = await childContext.step(
          `process-${item.id}`,
          async () => item.data.value * 10,
        );

        return stepResult;
      },
    );

    expect(result.successCount).toBe(2);
    expect(childContexts).toHaveLength(2);
    expect(childContexts[0]).toBeDefined();
    expect(childContexts[1]).toBeDefined();

    const results = result
      .succeeded()
      .map((r: (typeof result.all)[0]) => r.result);
    expect(results).toEqual([10, 20]);
  });

  it("should support early termination with minSuccessful", async () => {
    const { context } = createTestDurableContext();

    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      data: { value: i },
      index: i,
    }));

    let executedCount = 0;

    const result = await context._executeConcurrently(
      items,
      async (item: (typeof items)[0]) => {
        executedCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item.data.value;
      },
      {
        maxConcurrency: 2,
        completionConfig: {
          minSuccessful: 3,
        },
      },
    );

    expect(result.successCount).toBeGreaterThanOrEqual(3);
    expect(result.completionReason).toBe("MIN_SUCCESSFUL_REACHED");
    expect(executedCount).toBeLessThan(10);
  });

  it("should execute items with proper isolation between child contexts", async () => {
    const { context } = createTestDurableContext();

    const items = [
      { id: "task-1", data: { multiplier: 2 }, index: 0 },
      { id: "task-2", data: { multiplier: 3 }, index: 1 },
      { id: "task-3", data: { multiplier: 4 }, index: 2 },
    ];

    const result = await context._executeConcurrently(
      "process-tasks",
      items,
      async (item: (typeof items)[0]) => {
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 10 * item.data.multiplier;
      },
      { maxConcurrency: 2 },
    );

    expect(result.totalCount).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.getResults()).toEqual([20, 30, 40]);
    expect(result.status).toBe(BatchItemStatus.SUCCEEDED);
    expect(result.hasFailure).toBe(false);
  });
});
