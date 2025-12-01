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

    // Verify the invocations were tracked - should be exactly 2 invocations
    // Centralized termination implements a cool-down period prior to termination.
    // This cool-down phase reduces the total number of invocations needed while increasing
    // the number of operations performed in each invocation.
    const invocations = result.getInvocations();
    expect(invocations).toHaveLength(2);

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

    // Assert history events
    expect(result.getHistoryEvents()).toEqual([
      {
        EventType: "ExecutionStarted",
        EventId: 1,
        Id: expect.any(String),
        EventTimestamp: expect.any(Date),
        ExecutionStartedDetails: {
          Input: {
            Payload: "{}",
          },
        },
      },
      {
        EventType: "WaitStarted",
        SubType: "Wait",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "wait-invocation-1",
        EventTimestamp: expect.any(Date),
        WaitStartedDetails: {
          Duration: 1,
          ScheduledEndTimestamp: expect.any(Date),
        },
      },
      {
        EventType: "WaitSucceeded",
        SubType: "Wait",
        EventId: 3,
        Id: "c4ca4238a0b92382",
        Name: "wait-invocation-1",
        EventTimestamp: expect.any(Date),
        WaitSucceededDetails: { Duration: 1 },
      },
      {
        EventType: "InvocationCompleted",
        EventId: 4,
        EventTimestamp: expect.any(Date),
        InvocationCompletedDetails: {
          StartTimestamp: expect.any(Date),
          EndTimestamp: expect.any(Date),
          Error: {},
          RequestId: expect.any(String),
        },
      },
      {
        EventType: "StepStarted",
        SubType: "Step",
        EventId: 5,
        Id: "c81e728d9d4c2f63",
        Name: "process-data-step",
        EventTimestamp: expect.any(Date),
        StepStartedDetails: {},
      },
      {
        EventType: "StepSucceeded",
        SubType: "Step",
        EventId: 6,
        Id: "c81e728d9d4c2f63",
        Name: "process-data-step",
        EventTimestamp: expect.any(Date),
        StepSucceededDetails: {
          Result: {
            Payload: JSON.stringify(resultData.result),
          },
          RetryDetails: {},
        },
      },
      {
        EventType: "WaitStarted",
        SubType: "Wait",
        EventId: 7,
        Id: "eccbc87e4b5ce2fe",
        Name: "wait-invocation-2",
        EventTimestamp: expect.any(Date),
        WaitStartedDetails: {
          Duration: 1,
          ScheduledEndTimestamp: expect.any(Date),
        },
      },
      {
        EventType: "WaitSucceeded",
        SubType: "Wait",
        EventId: 8,
        Id: "eccbc87e4b5ce2fe",
        Name: "wait-invocation-2",
        EventTimestamp: expect.any(Date),
        WaitSucceededDetails: { Duration: 1 },
      },
      {
        EventType: "InvocationCompleted",
        EventId: 9,
        EventTimestamp: expect.any(Date),
        InvocationCompletedDetails: {
          StartTimestamp: expect.any(Date),
          EndTimestamp: expect.any(Date),
          Error: {},
          RequestId: expect.any(String),
        },
      },
      {
        EventType: "ExecutionSucceeded",
        EventId: 10,
        Id: expect.any(String),
        EventTimestamp: expect.any(Date),
        ExecutionSucceededDetails: {
          Result: {
            Payload: JSON.stringify(resultData),
          },
        },
      },
    ]);
  });

  it("should complete with mocking", async () => {
    const mockedFunction = jest.fn();

    const otherCode = {
      property: () => "not mocked",
    };

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
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
