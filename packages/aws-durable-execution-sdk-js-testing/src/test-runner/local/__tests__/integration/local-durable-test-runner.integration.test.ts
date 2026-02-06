import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { OperationStatus } from "@aws-sdk/client-lambda";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Integration", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.useRealTimers();
  });

  it("should complete execution with no environment variables set", async () => {
    process.env = {};

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const result = await context.step(() => Promise.resolve("completed"));
        return { success: true, step: result };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run();

    expect(result.getResult()).toEqual({
      success: true,
      step: "completed",
    });
  });

  it("should track operations across multiple invocations", async () => {
    // This test creates a workflow with multiple wait operations
    // which cause separate invocations, and verifies that invocation tracking works
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        // First wait operation - this will run in invocation index 0
        await context.wait("wait-invocation-1", { seconds: 1 });

        // This will execute in invocation index 1
        const stepResult = await context.step("process-data-step", () => {
          return Promise.resolve({ processed: true, timestamp: Date.now() });
        });

        // Second wait operation - this will run in invocation index 1
        await context.wait("wait-invocation-2", { seconds: 1 });

        // Third invocation will only return the result
        return {
          result: stepResult,
          completed: true,
        };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    // Get operations for verification
    const firstWaitOp = runner.getOperation("wait-invocation-1");
    const stepOp = runner.getOperation("process-data-step");
    const secondWaitOp = runner.getOperation("wait-invocation-2");

    const result = await runner.run();

    // Verify the final result is correct
    const resultData = result.getResult() as {
      result: { processed: boolean; timestamp: number };
      completed: boolean;
    };
    expect(resultData).toMatchObject({
      result: { processed: true },
      completed: true,
    });
    expect(typeof resultData.result.timestamp).toBe("number");

    // Verify that operations were tracked
    const operations = result.getOperations();

    // Verify the invocations were tracked - with faster termination cooldown (2ms),
    // we may get an additional invocation due to timing changes
    const invocations = result.getInvocations();
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    expect(invocations.length).toBeLessThanOrEqual(3);

    // We should have 3 operations in total
    expect(operations).toHaveLength(3);

    // Get all operation IDs
    const firstWaitId = firstWaitOp.getOperationData()!.Id!;
    const stepOpId = stepOp.getOperationData()!.Id!;
    const secondWaitId = secondWaitOp.getOperationData()!.Id!;

    // Verify all three operations have unique IDs
    expect(firstWaitId).not.toBe(stepOpId);
    expect(firstWaitId).not.toBe(secondWaitId);
    expect(stepOpId).not.toBe(secondWaitId);

    // Get all operation IDs from the complete operations list
    const allOperationIds = operations.map((op) => op.getOperationData()!.Id!);

    // Verify all our operations are in the final operations list by checking IDs
    expect(allOperationIds).toContain(firstWaitId);
    expect(allOperationIds).toContain(stepOpId);
    expect(allOperationIds).toContain(secondWaitId);

    // Verify invocation structure - with faster termination cooldown, we may have 2-3 invocations
    if (invocations.length === 2) {
      expect(invocations[0]).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
      expect(invocations[1]).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
    } else if (invocations.length === 3) {
      // With faster cooldown, we may get an additional invocation
      expect(invocations[0]).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
      expect(invocations[1]).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
      expect(invocations[2]).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
    }

    // Verify essential history events are present (flexible check)
    const historyEvents = result.getHistoryEvents();

    // Check that we have the essential events
    const executionStarted = historyEvents.find(
      (e) => e.EventType === "ExecutionStarted",
    );
    const executionSucceeded = historyEvents.find(
      (e) => e.EventType === "ExecutionSucceeded",
    );
    const waitStartedEvents = historyEvents.filter(
      (e) => e.EventType === "WaitStarted",
    );
    const waitSucceededEvents = historyEvents.filter(
      (e) => e.EventType === "WaitSucceeded",
    );
    const stepStarted = historyEvents.find(
      (e) => e.EventType === "StepStarted",
    );
    const stepSucceeded = historyEvents.find(
      (e) => e.EventType === "StepSucceeded",
    );
    const invocationCompletedEvents = historyEvents.filter(
      (e) => e.EventType === "InvocationCompleted",
    );

    expect(executionStarted).toBeDefined();
    expect(executionSucceeded).toBeDefined();
    expect(waitStartedEvents).toHaveLength(2); // Two wait operations
    expect(waitSucceededEvents).toHaveLength(2); // Two wait operations
    expect(stepStarted).toBeDefined();
    expect(stepSucceeded).toBeDefined();
    expect(invocationCompletedEvents.length).toBeGreaterThanOrEqual(2); // At least 2 invocations
  });

  it("should complete with mocking", async () => {
    const mockedFunction = jest.fn();

    const otherCode = {
      property: () => "not mocked",
    };

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        expect(context.lambdaContext.getRemainingTimeInMillis()).toBe(900_000);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        const mock1: string = await context.step(() => mockedFunction());

        return mock1 + " and " + otherCode.property();
      },
    );

    jest.spyOn(otherCode, "property").mockReturnValue("my result");

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    mockedFunction.mockResolvedValue("hello world");

    const result = await runner.run();

    expect(result.getResult()).toEqual("hello world and my result");
  });

  it("should have fake timers in the global scope", async () => {
    jest.useRealTimers();

    const handler = withDurableExecution(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      return Promise.resolve((Date as unknown as any).isFake);
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run();

    expect(result.getResult()).toBe(true);
  });

  it("should reject waiting promise if execution completes", async () => {
    const handler = withDurableExecution(() => {
      return Promise.resolve("result");
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const resultPromise = runner.run();

    await expect(
      runner.getOperation("non-existent").waitForData(),
    ).rejects.toThrow(
      "Operation was not found after execution completion. Expected status: STARTED. This typically means the operation was never executed or the test is waiting for the wrong operation.",
    );

    expect((await resultPromise).getResult()).toBe("result");
  });

  // enable when language SDK supports concurrent waits
  it.skip("should prevent scheduled function interference in parallel wait scenario", async () => {
    // This test creates a scenario where multiple wait operations could create
    // scheduled functions that fire while invocations are still active.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        // Use parallel to create multiple wait operations that schedule functions concurrently
        const results = await context.parallel([
          () => context.wait("parallel-wait-1", { seconds: 10 }),
          () => context.wait("parallel-wait-2", { seconds: 15 }),
          () => context.wait("parallel-wait-3", { seconds: 5 }),
        ]);

        // This step runs after all parallel waits complete
        await context.step("after-parallel", () =>
          Promise.resolve("completed"),
        );

        return {
          parallelResults: results,
          completed: true,
        };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run();

    // Verify successful completion despite potential scheduled function interference
    expect(result.getResult()).toEqual({
      parallelResults: [null, null, null], // parallel waits don't return values
      completed: true,
    });

    // Verify all operations completed successfully
    const operations = result.getOperations();
    console.log(operations.map((operation) => operation.getOperationData()));
    expect(operations).toHaveLength(8); // 3 parallel waits + 3 parallel contexts + 1 parallel operation + 1 step

    // Check that parallel wait operations all succeeded
    const wait1 = runner.getOperation("parallel-wait-1");
    const wait2 = runner.getOperation("parallel-wait-2");
    const wait3 = runner.getOperation("parallel-wait-3");
    const afterStep = runner.getOperation("after-parallel");

    expect(wait1.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(wait2.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(wait3.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(afterStep.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(afterStep.getStepDetails()?.result).toBe("completed");
  });
});
