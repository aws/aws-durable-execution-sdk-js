import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableFunctions,
} from "aws-durable-execution-sdk-js";
import { OperationStatus, OperationType } from "@aws-sdk/client-lambda";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Integration tests for LocalDurableTestRunner that test end-to-end execution
 * without mocking core dependencies.
 */
describe("LocalDurableTestRunner Integration", () => {
  it("should complete execution with wait operations", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        await context.wait("wait", 100);
        return { success: true, step: "completed" };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the wait call
    const waitOperation = runner.getOperation("wait");

    const result = await runner.run({ payload: { test: "wait-operation" } });

    expect(result.getResult()).toEqual({
      success: true,
      step: "completed",
    });

    // Verify operations were tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(1);

    // Verify MockOperation data can be accessed
    expect(waitOperation.getType()).toBe(OperationType.WAIT);
  });

  it("should handle handler errors gracefully", async () => {
    const handler = withDurableFunctions(() => {
      throw new Error("Intentional handler failure");
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const result = await runner.run({ payload: { test: "error-case" } });

    // Check that error was captured in the result
    const error = result.getError();
    expect(error).toEqual({
      errorMessage: "Intentional handler failure",
      errorType: "Error",
      stackTrace: expect.any(Array),
    });
    expect(error.stackTrace?.length).toBeGreaterThan(1);
    error.stackTrace?.forEach((value) => {
      expect(typeof value).toBe("string");
    });
  });

  it("should execute simple handler without opAerations", async () => {
    const handler = withDurableFunctions((event: unknown) =>
      Promise.resolve({
        received: JSON.stringify(event),
        timestamp: Date.now(),
        message: "Handler completed successfully",
      })
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
    });

    const testPayload = {
      userId: "test-user",
      action: "simple-execution",
    };

    const result = await runner.run({ payload: testPayload });

    const resultData = result.getResult() as {
      received: unknown;
      timestamp: number;
      message: string;
    };
    expect(resultData).toMatchObject({
      received: JSON.stringify(testPayload),
      message: "Handler completed successfully",
    });
    expect(typeof resultData.timestamp).toBe("number");

    // Should have no operations for simple execution
    expect(result.getOperations()).toHaveLength(0);
    // Should have exactly one invocation for simple execution
    expect(result.getInvocations()).toHaveLength(1);
  });

  it("should handle multiple wait operations", async () => {
    const handler = withDurableFunctions(
      async (_event: unknown, context: DurableContext) => {
        await context.wait("wait-1", 50000);
        await context.wait("wait-2", 50000);

        return {
          completedWaits: 2,
          finalStep: "done",
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operations for the wait calls
    const firstWait = runner.getOperation("wait-1");
    const secondWait = runner.getOperation("wait-2");

    const result = await runner.run();

    expect(result.getResult()).toEqual({
      completedWaits: 2,
      finalStep: "done",
    });

    // Should have tracked multiple wait operations
    const operations = result.getOperations();
    expect(operations.length).toEqual(2);

    // Verify MockOperation data for both wait operations
    expect(firstWait.getWaitDetails()?.waitSeconds).toBe(50);
    expect(firstWait.getWaitDetails()?.scheduledEndTimestamp).toBeInstanceOf(
      Date
    );
    expect(secondWait.getWaitDetails()?.waitSeconds).toBe(50);
    expect(secondWait.getWaitDetails()?.scheduledEndTimestamp).toBeInstanceOf(
      Date
    );
  });

  it("should handle step operations with MockOperation assertions", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const stepResult = await context.step("fetch-user", () => {
          return Promise.resolve({ userId: 123, name: "John Doe" });
        });

        return {
          user: stepResult,
          final: "processed",
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the step call
    const fetchUserStep = runner.getOperation("fetch-user");

    const result = await runner.run({ payload: { test: "step-operations" } });

    expect(result.getResult()).toEqual({
      user: { userId: 123, name: "John Doe" },
      final: "processed",
    });

    // Should have tracked step operation
    const operations = result.getOperations();
    expect(operations.length).toEqual(1);

    // Verify MockOperation data for step operation
    expect(fetchUserStep.getStepDetails()).toBeDefined();
  });

  it("should handle step operations with undefined result after replay", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        await context.step("fetch-user", () => Promise.resolve(undefined));

        await context.runInChildContext("parent", () =>
          Promise.resolve(undefined)
        );

        await context.wait(1000);

        return "result";
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const result = await runner.run();

    expect(result.getResult()).toEqual("result");
  });

  it("should handle step operations when no replay occurs", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        await context.step("fetch-user-1", () => Promise.resolve("user-1"));
        await context.step("fetch-user-2", () => Promise.resolve("user-2"));
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    await runner.run();

    const user1Step = runner.getOperation("fetch-user-1");
    const user2Step = runner.getOperation("fetch-user-2");

    expect(user1Step.getStepDetails()?.result).toEqual("user-1");
    expect(user1Step.getStatus()).toBe(OperationStatus.SUCCEEDED);

    expect(user2Step.getStepDetails()?.result).toEqual("user-2");
    expect(user2Step.getStatus()).toBe(OperationStatus.SUCCEEDED);
  });

  it("should handle child context operations with checkpoints", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const stepResult = await context.runInChildContext(
          "parent-context",
          async (childContext) => {
            await childContext.wait("child-wait", 1000);

            return Promise.resolve({ userId: 123, name: "John Doe" });
          }
        );

        return {
          user: stepResult,
          final: "processed",
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the parent context
    const parentContextStep = runner.getOperation("parent-context");
    const waitStep = runner.getOperation("child-wait");

    const result = await runner.run({ payload: { test: "step-operations" } });

    expect(result.getResult()).toEqual({
      user: { userId: 123, name: "John Doe" },
      final: "processed",
    });

    // Should have tracked step operation
    const operations = result.getOperations();
    expect(operations.length).toEqual(2);

    // Verify MockOperation data for context operation
    expect(parentContextStep.getContextDetails()?.result).toEqual({
      userId: 123,
      name: "John Doe",
    });

    // Verify wait step
    expect(waitStep.getWaitDetails()?.waitSeconds).toEqual(1);
    expect(waitStep.getWaitDetails()?.scheduledEndTimestamp).toBeInstanceOf(
      Date
    );
  });

  it("should handle steps with retry and failure", async () => {
    const handler = withDurableFunctions(async (_, context: DurableContext) => {
      await context.step(
        "retries",
        () => Promise.reject(new Error("There was an error")),
        {
          retryStrategy: (_, attemptsMade: number) => {
            const shouldRetry = attemptsMade <= 5;
            return { shouldRetry, delaySeconds: 1 + attemptsMade };
          },
        }
      );
      return { success: true, step: "completed" };
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the wait call
    const retriesOperation = runner.getOperation("retries");

    const result = await runner.run();

    const error = result.getError();
    expect(error).toMatchObject({
      errorType: "Error",
      errorMessage: "There was an error",
      stackTrace: expect.any(Array),
    });
    expect(error.stackTrace?.length).toBeGreaterThan(1);
    error.stackTrace?.forEach((value) => {
      expect(typeof value).toBe("string");
    });

    // Verify operations were tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(1);

    // Verify retries
    const stepDetails = retriesOperation.getStepDetails();
    expect(stepDetails).toBeDefined();
    expect(stepDetails?.attempt).toEqual(5);
  });

  it("should handle steps with retry and success", async () => {
    let i = 0;
    const handler = withDurableFunctions(async (_, context: DurableContext) => {
      await context.step(
        "retries",
        () => {
          if (i++ < 3) {
            return Promise.reject(new Error(`There was an error ${i}`));
          }
          return Promise.resolve("Success!");
        },
        {
          retryStrategy: () => ({
            shouldRetry: true,
            delaySeconds: 1,
          }),
        }
      );
      return { success: true, step: "completed" };
    });

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the wait call
    const retriesOperation = runner.getOperation("retries");

    const result = await runner.run();

    expect(result.getResult()).toEqual({
      success: true,
      step: "completed",
    });

    // Verify operations were tracked
    const completedOperations = result.getOperations();
    expect(completedOperations.length).toEqual(1);

    // Verify retries
    const stepDetails = retriesOperation.getStepDetails();
    expect(stepDetails?.attempt).toEqual(3);
    expect(stepDetails?.result).toEqual("Success!");
  });

  it("should get child operations from nested child context", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const stepResult = await context.runInChildContext(
          "parent-context",
          async (childContext) => {
            await childContext.wait("child-wait-1", 1000);

            await childContext.runInChildContext(
              "child-context",
              async (grandChildContext) => {
                await grandChildContext.wait("grandchild-wait-1", 1000);
                await grandChildContext.wait("grandchild-wait-2", 1000);
                return "grandchild-context";
              }
            );

            await childContext.wait("child-wait-2", 1000);

            return "parent-context";
          }
        );

        return stepResult;
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operation for the parent context
    const parentContextStep = runner.getOperation("parent-context");

    const result = await runner.run({ payload: { test: "step-operations" } });

    expect(result.getResult()).toEqual("parent-context");

    // Should have tracked step operation
    const operations = result.getOperations();
    expect(operations.length).toEqual(6);

    const parentChildren = parentContextStep.getChildOperations();
    expect(parentChildren).toHaveLength(3);

    expect(parentChildren?.[0]!.getName()).toEqual("child-wait-1");
    expect(parentChildren?.[1]!.getName()).toEqual("child-context");
    expect(parentChildren?.[2]!.getName()).toEqual("child-wait-2");

    const childChildren = parentChildren?.[1]!.getChildOperations();
    expect(childChildren).toHaveLength(2);
    expect(childChildren?.[0]!.getName()).toEqual("grandchild-wait-1");
    expect(childChildren?.[1]!.getName()).toEqual("grandchild-wait-2");
  });

  it("should track operations across multiple invocations", async () => {
    // This test creates a workflow with multiple wait operations
    // which cause separate invocations, and verifies that invocation tracking works
    const handler = withDurableFunctions(
      async (_event: unknown, context: DurableContext) => {
        // First wait operation - this will run in invocation index 0
        await context.wait("wait-invocation-1", 1000);

        // This will execute in invocation index 1
        const stepResult = await context.step("process-data-step", () => {
          return Promise.resolve({ processed: true, timestamp: Date.now() });
        });

        // Second wait operation - this will run in invocation index 1
        await context.wait("wait-invocation-2", 1000);

        // Third invocation will only return the result
        return {
          result: stepResult,
          completed: true,
        };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Get mock operations for verification
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
      inv.getOperations().map((op) => op.getOperationData()?.Id)
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
    // TODO: update timestamps to Date objects
    expect(result.getHistoryEvents()).toEqual([
      {
        EventType: "WaitStarted",
        SubType: "Wait",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "wait-invocation-1",
        EventTimestamp: expect.any(Number),
        WaitStartedDetails: {
          Duration: 1,
          ScheduledEndTimestamp: expect.any(Number),
        },
      },
      {
        EventType: "WaitSucceeded",
        SubType: "Wait",
        EventId: 3,
        Id: "c4ca4238a0b92382",
        Name: "wait-invocation-1",
        EventTimestamp: expect.any(Number),
        WaitSucceededDetails: { Duration: 1 },
      },
      {
        EventType: "StepStarted",
        SubType: "Step",
        EventId: 4,
        Id: "c81e728d9d4c2f63",
        Name: "process-data-step",
        EventTimestamp: expect.any(Number),
        StepStartedDetails: {},
      },
      {
        EventType: "StepSucceeded",
        SubType: "Step",
        EventId: 5,
        Id: "c81e728d9d4c2f63",
        Name: "process-data-step",
        EventTimestamp: expect.any(Number),
        StepSucceededDetails: {
          Result: {
            Payload: JSON.stringify({
              processed: true,
              timestamp: resultData.result.timestamp,
            }),
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
        EventTimestamp: expect.any(Number),
        WaitStartedDetails: {
          Duration: 1,
          ScheduledEndTimestamp: expect.any(Number),
        },
      },
      {
        EventType: "WaitSucceeded",
        SubType: "Wait",
        EventId: 7,
        Id: "eccbc87e4b5ce2fe",
        Name: "wait-invocation-2",
        EventTimestamp: expect.any(Number),
        WaitSucceededDetails: { Duration: 1 },
      },
    ]);
  });

  // enable when language SDK supports concurrent waits
  it.skip("should prevent scheduled function interference in parallel wait scenario", async () => {
    // This test creates a scenario where multiple wait operations could create
    // scheduled functions that fire while invocations are still active.
    const handler = withDurableFunctions(
      async (_event: unknown, context: DurableContext) => {
        // Use parallel to create multiple wait operations that schedule functions concurrently
        const results = await context.parallel([
          () => context.wait("parallel-wait-1", 10),
          () => context.wait("parallel-wait-2", 15),
          () => context.wait("parallel-wait-3", 5),
        ]);

        // This step runs after all parallel waits complete
        await context.step("after-parallel", () =>
          Promise.resolve("completed")
        );

        return {
          parallelResults: results,
          completed: true,
        };
      }
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
