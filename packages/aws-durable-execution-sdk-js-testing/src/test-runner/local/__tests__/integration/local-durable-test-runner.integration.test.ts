import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { OperationStatus } from "@aws-sdk/client-lambda";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("LocalDurableTestRunner Integration", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should complete execution with no environment variables set", async () => {
    process.env = {};

    const handler = withDurableExecution(
      async (event: unknown, context: DurableContext) => {
        const result = await context.step(() => Promise.resolve("completed"));
        return { success: true, step: result };
      },
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
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
      skipTime: true,
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

    // Verify the invocations were tracked - should be exactly 3 invocations
    const invocations = result.getInvocations();
    expect(invocations).toHaveLength(3);

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

    // For each invocation, get its operations
    const invocationOperations = invocations.map((inv) =>
      inv.getOperations().map((op) => op.getOperationData()?.Id),
    );

    // Verify exact operations in each invocation
    // Make sure we have the right number of invocations first
    expect(invocationOperations).toHaveLength(3);
    // - Invocation 0: first wait operation
    expect(invocationOperations[0]).toEqual([firstWaitId]);
    // - Invocation 1: step operation and second wait operation
    expect(invocationOperations[1]).toEqual([stepOpId, secondWaitId]);
    // - Invocation 2: no checkpoints performed
    expect(invocationOperations[2]).toEqual([]);

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
        EventId: 3,
        Id: "c4ca4238a0b92382",
        Name: "wait-invocation-1",
        SubType: "Wait",
        EventTimestamp: expect.any(Date),
        WaitSucceededDetails: { Duration: 1 },
      },
      {
        EventType: "StepStarted",
        SubType: "Step",
        EventId: 4,
        Id: "c81e728d9d4c2f63",
        Name: "process-data-step",
        EventTimestamp: expect.any(Date),
        StepStartedDetails: {},
      },
      {
        EventType: "StepSucceeded",
        SubType: "Step",
        EventId: 5,
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
        EventId: 6,
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
        EventId: 7,
        SubType: "Wait",
        Id: "eccbc87e4b5ce2fe",
        Name: "wait-invocation-2",
        EventTimestamp: expect.any(Date),
        WaitSucceededDetails: { Duration: 1 },
      },
      {
        EventType: "ExecutionSucceeded",
        EventId: 8,
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
