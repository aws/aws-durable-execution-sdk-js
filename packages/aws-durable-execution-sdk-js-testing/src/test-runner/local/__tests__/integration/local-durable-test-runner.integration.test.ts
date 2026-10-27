import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../types/durable-operation";
import {
  DurableContext,
  withDurableExecution,
  OperationStatus,
} from "@aws/durable-execution-sdk-js";

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
    // Complete each callback only after its invocation has suspended. Unlike
    // skipped waits, these boundaries cannot coalesce during the idle cooldown.
    const stepBody = jest.fn(async () => ({
      processed: true,
      timestamp: Date.now(),
    }));
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const [first] = await context.createCallback("callback-invocation-1");
        await first;

        const stepResult = await context.step("process-data-step", stepBody);

        const [second] = await context.createCallback("callback-invocation-2");
        await second;

        return { result: stepResult, completed: true };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const firstCallbackOp = runner.getOperation("callback-invocation-1");
    const stepOp = runner.getOperation("process-data-step");
    const secondCallbackOp = runner.getOperation("callback-invocation-2");

    const execution = runner.run();
    for (const callback of [firstCallbackOp, secondCallbackOp]) {
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner.pauseExecution();
      await callback.sendCallbackSuccess("continue");
      await callback.waitForData(WaitingOperationStatus.COMPLETED);
      await runner.resumeExecution();
    }
    const result = await execution;

    const resultData = result.getResult() as {
      result: { processed: boolean; timestamp: number };
      completed: boolean;
    };
    expect(result.getStatus()).toBe(OperationStatus.SUCCEEDED);
    expect(resultData).toMatchObject({
      result: { processed: true },
      completed: true,
    });
    expect(typeof resultData.result.timestamp).toBe("number");
    expect(stepBody).toHaveBeenCalledTimes(1);

    const operations = result.getOperations();
    const invocations = result.getInvocations();
    expect(invocations).toHaveLength(3);
    expect(operations).toHaveLength(3);

    const firstCallbackId = firstCallbackOp.getOperationData()!.Id!;
    const stepOpId = stepOp.getOperationData()!.Id!;
    const secondCallbackId = secondCallbackOp.getOperationData()!.Id!;
    expect(firstCallbackId).not.toBe(stepOpId);
    expect(firstCallbackId).not.toBe(secondCallbackId);
    expect(stepOpId).not.toBe(secondCallbackId);

    const allOperationIds = operations.map((op) => op.getOperationData()!.Id!);
    expect(allOperationIds).toContain(firstCallbackId);
    expect(allOperationIds).toContain(stepOpId);
    expect(allOperationIds).toContain(secondCallbackId);
    for (const operation of operations) {
      expect(operation.getOperationData()!.Status).toBe(
        OperationStatus.SUCCEEDED,
      );
    }
    for (const invocation of invocations) {
      expect(invocation).toEqual({
        startTimestamp: expect.any(Date),
        endTimestamp: expect.any(Date),
        requestId: expect.any(String),
      });
    }
    expect(
      new Set(invocations.map((invocation) => invocation.requestId)).size,
    ).toBe(3);

    // Check every event and its order, including each invocation's exact tracking
    // fields. No timing-dependent event filtering or relaxed count is needed.
    expect(result.getHistoryEvents()).toEqual([
      {
        EventType: "ExecutionStarted",
        EventId: 1,
        Id: expect.any(String),
        EventTimestamp: expect.any(Date),
        ExecutionStartedDetails: { Input: { Payload: "{}" } },
      },
      {
        EventType: "CallbackStarted",
        SubType: "Callback",
        EventId: 2,
        Id: "c4ca4238a0b92382",
        Name: "callback-invocation-1",
        EventTimestamp: expect.any(Date),
        CallbackStartedDetails: {
          CallbackId:
            firstCallbackOp.getOperationData()!.CallbackDetails!.CallbackId,
          Input: {},
        },
      },
      {
        EventType: "InvocationCompleted",
        EventId: 3,
        EventTimestamp: expect.any(Date),
        InvocationCompletedDetails: {
          StartTimestamp: invocations[0].startTimestamp,
          EndTimestamp: invocations[0].endTimestamp,
          Error: {},
          RequestId: invocations[0].requestId,
        },
      },
      {
        EventType: "CallbackSucceeded",
        SubType: "Callback",
        EventId: 4,
        Id: "c4ca4238a0b92382",
        Name: "callback-invocation-1",
        EventTimestamp: expect.any(Date),
        CallbackSucceededDetails: { Result: { Payload: "continue" } },
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
          Result: { Payload: JSON.stringify(resultData.result) },
          RetryDetails: {},
        },
      },
      {
        EventType: "CallbackStarted",
        SubType: "Callback",
        EventId: 7,
        Id: "eccbc87e4b5ce2fe",
        Name: "callback-invocation-2",
        EventTimestamp: expect.any(Date),
        CallbackStartedDetails: {
          CallbackId:
            secondCallbackOp.getOperationData()!.CallbackDetails!.CallbackId,
          Input: {},
        },
      },
      {
        EventType: "InvocationCompleted",
        EventId: 8,
        EventTimestamp: expect.any(Date),
        InvocationCompletedDetails: {
          StartTimestamp: invocations[1].startTimestamp,
          EndTimestamp: invocations[1].endTimestamp,
          Error: {},
          RequestId: invocations[1].requestId,
        },
      },
      {
        EventType: "CallbackSucceeded",
        SubType: "Callback",
        EventId: 9,
        Id: "eccbc87e4b5ce2fe",
        Name: "callback-invocation-2",
        EventTimestamp: expect.any(Date),
        CallbackSucceededDetails: { Result: { Payload: "continue" } },
      },
      {
        EventType: "InvocationCompleted",
        EventId: 10,
        EventTimestamp: expect.any(Date),
        InvocationCompletedDetails: {
          StartTimestamp: invocations[2].startTimestamp,
          EndTimestamp: invocations[2].endTimestamp,
          Error: {},
          RequestId: invocations[2].requestId,
        },
      },
      {
        EventType: "ExecutionSucceeded",
        EventId: 11,
        Id: expect.any(String),
        EventTimestamp: expect.any(Date),
        ExecutionSucceededDetails: {
          Result: { Payload: JSON.stringify(resultData) },
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
        expect(context.lambdaContext.getRemainingTimeInMillis()).toBe(900_000);

        // Reviewed `@typescript-eslint/no-unsafe-return` disable before the migration -- no Biome equivalent (see biome.jsonc gap 1). The mocked function is untyped (`any`); returning its result from the step callback is intentional here.
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
      // Reviewed `@typescript-eslint/no-unsafe-member-access` (with `no-explicit-any`) disable before the migration -- no Biome equivalent (see biome.jsonc gap 1). This probes the fake-timer flag on Date, which is untyped by design.
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
  // biome-ignore lint/suspicious/noSkippedTests: pending language SDK concurrent-wait support; deliberately skipped and acknowledged -- was a reviewed `jest/no-disabled-tests` disable before the Biome migration.
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
