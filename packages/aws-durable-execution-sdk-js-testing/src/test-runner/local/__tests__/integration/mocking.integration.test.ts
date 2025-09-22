import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import {
  DurableContext,
  withDurableFunctions,
} from "aws-durable-execution-sdk-js";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * Integration tests for LocalDurableTestRunner mocking functionality that test
 * end-to-end execution with various mocking scenarios.
 */
describe("LocalDurableTestRunner mocking Integration", () => {
  it("should handle basic mocking with mockResolvedValue and mockImplementation", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const stepResult = await context.runInChildContext(
          "parent-context",
          async (childContext) => {
            await childContext.wait("child-wait", 1000);

            return Promise.resolve({ userId: 123, name: "John Doe" });
          }
        );

        await context.step("failing-step", () =>
          Promise.reject(new Error("there was an error"))
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

    const parentContextStep = runner.getOperation("parent-context");
    const waitStep = runner.getOperation("child-wait");
    const failingStep = runner.getOperation("failing-step");

    parentContextStep.mockResolvedValue({
      userId: 456,
      name: "Jane Doe",
    });
    failingStep.mockImplementation(() => Promise.resolve());

    const result = await runner.run({ payload: { test: "step-operations" } });

    expect(result.getResult()).toEqual({
      user: {
        userId: 456,
        name: "Jane Doe",
      },
      final: "processed",
    });

    // Should have tracked only parent operation since child was mocked
    const operations = result.getOperations();
    expect(operations.length).toEqual(2);

    // Verify MockOperation data for context operation
    expect(parentContextStep.getContextDetails()?.result).toEqual({
      userId: 456,
      name: "Jane Doe",
    });

    // Verify wait step was not run
    expect(waitStep.getStatus()).toBeUndefined();
    expect(failingStep.getStepDetails()?.result).toBeUndefined();
  });

  it("should handle mockRejectedValue for error scenarios", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        try {
          await context.step("error-step", () =>
            Promise.resolve({ success: true })
          );
          return { status: "success" };
        } catch (error) {
          return {
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const errorStep = runner.getOperation("error-step");
    errorStep.mockRejectedValue(new Error("Mocked error"));

    const result = await runner.run({ payload: { test: "error-mocking" } });

    expect(result.getResult()).toEqual({
      status: "error",
      message: "Mocked error",
    });

    const operations = result.getOperations();
    expect(operations.length).toEqual(1);
  });

  it("should handle mockRejectedValueOnce for single-use error mocking", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const results: unknown[] = [];

        try {
          const result1 = await context.step(
            "retry-step",
            () => {
              return Promise.resolve({ success: true });
            },
            {
              retryStrategy: () => ({ shouldRetry: false }),
            }
          );
          results.push(result1);
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        try {
          const result2 = await context.step("retry-step-2", () => {
            return Promise.resolve({ success: true });
          });
          results.push(result2);
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        return { results };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const retryStep = runner.getOperation("retry-step");
    const retryStep2 = runner.getOperation("retry-step-2");

    retryStep.mockRejectedValueOnce(new Error("First attempt failed"));
    retryStep2.mockResolvedValue({ attempt: 999, success: true });

    const result = await runner.run({ payload: { test: "once-mocking" } });

    expect(result.getResult()).toEqual({
      results: [
        { error: "First attempt failed" },
        { attempt: 999, success: true },
      ],
    });
  });

  it("should handle mockImplementationOnce for single-use custom implementation", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const result1 = await context.step("custom-step", () =>
          Promise.resolve({ default: "implementation" })
        );

        const result2 = await context.step("custom-step-2", () =>
          Promise.resolve({ default: "implementation" })
        );

        return { first: result1, second: result2 };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const customStep = runner.getOperation("custom-step");
    const customStep2 = runner.getOperation("custom-step-2");

    customStep.mockImplementationOnce(() =>
      Promise.resolve({ custom: "once-implementation" })
    );
    customStep2.mockResolvedValue({ standard: "mock" });

    const result = await runner.run({
      payload: { test: "once-implementation" },
    });

    expect(result.getResult()).toEqual({
      first: { custom: "once-implementation" },
      second: { standard: "mock" },
    });
  });

  it("should handle getOperationByNameAndIndex for name and index-based mocking", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const result1 = await context.step("step-name", () =>
          Promise.resolve({ order: 1 })
        );

        const result2 = await context.step("step-name", () =>
          Promise.resolve({ order: 2 })
        );

        return { results: [result1, result2] };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Mock by index - first occurrence (index 0) and second occurrence (index 1)
    const firstStep = runner.getOperationByNameAndIndex("step-name", 0);
    const secondStep = runner.getOperationByNameAndIndex("step-name", 1);

    firstStep.mockResolvedValue({ order: "first-mocked" });
    secondStep.mockResolvedValue({ order: "second-mocked" });

    const result = await runner.run({ payload: { test: "index-mocking" } });

    expect(result.getResult()).toEqual({
      results: [{ order: "first-mocked" }, { order: "second-mocked" }],
    });
  });

  it("should throw error when trying to use unsupported ID-based mocking", () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableFunctions(() => Promise.resolve({})),
      skipTime: true,
    });

    const operationById = runner.getOperationById("some-id");

    expect(() => {
      operationById.mockResolvedValue({ test: "value" });
    }).toThrow("Mocking for ids is not supported");
  });

  it("should handle complex nested context mocking", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const outerResult = await context.runInChildContext(
          "outer-context",
          async (outerChildContext) => {
            const innerResult = await outerChildContext.runInChildContext(
              "inner-context",
              async (innerChildContext) => {
                await innerChildContext.wait("deep-wait", 5000);
                return { level: "inner", data: "deep-data" };
              }
            );

            const stepResult = await outerChildContext.step("outer-step", () =>
              Promise.resolve({ level: "outer", inner: innerResult })
            );

            return stepResult;
          }
        );

        return { final: outerResult };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const innerContext = runner.getOperation("inner-context");
    const outerStep = runner.getOperation("outer-step");
    const deepWait = runner.getOperation("deep-wait");

    // Mock the inner context to return custom data
    innerContext.mockResolvedValue({
      level: "mocked-inner",
      data: "mocked-deep-data",
    });
    outerStep.mockResolvedValue({
      level: "mocked-outer",
      inner: { custom: "data" },
    });

    const result = await runner.run({ payload: { test: "nested-mocking" } });

    expect(result.getResult()).toEqual({
      final: { level: "mocked-outer", inner: { custom: "data" } },
    });

    // Verify the mocked operations
    expect(innerContext.getContextDetails()).toBeDefined();
    expect(outerStep.getStepDetails()).toBeDefined();

    // Deep wait should not have been executed
    expect(deepWait.getStatus()).toBeUndefined();
  });

  it("should handle multiple mocks on the same operation type", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const results: unknown[] = [];

        for (let i = 0; i < 3; i++) {
          const result = await context.step("repeated-step", () =>
            Promise.resolve({ iteration: i, original: true })
          );
          results.push(result);
        }

        return { results };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Mock each occurrence by index
    const step0 = runner.getOperationByNameAndIndex("repeated-step", 0);
    const step1 = runner.getOperationByNameAndIndex("repeated-step", 1);
    const step2 = runner.getOperationByNameAndIndex("repeated-step", 2);

    step0.mockResolvedValue({ iteration: 0, mocked: true });
    step1.mockResolvedValue({ iteration: 1, mocked: true });
    step2.mockResolvedValue({ iteration: 2, mocked: true });

    const result = await runner.run({ payload: { test: "multiple-mocks" } });

    expect(result.getResult()).toEqual({
      results: [
        { iteration: 0, mocked: true },
        { iteration: 1, mocked: true },
        { iteration: 2, mocked: true },
      ],
    });

    // Verify all mocked operations have results
    expect(step0.getStepDetails()).toBeDefined();
    expect(step1.getStepDetails()).toBeDefined();
    expect(step2.getStepDetails()).toBeDefined();
  });

  it("should throw error when trying to mock wait operations", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        await context.step("before-wait", () =>
          Promise.resolve({
            completed: "before-wait",
          })
        );

        await context.wait("wait", 10000);

        const stepResult = await context.step("after-wait", () =>
          Promise.resolve({ completed: "after-wait" })
        );

        return { waitCompleted: true, step: stepResult };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const beforeWait = runner.getOperation("before-wait");
    const wait = runner.getOperation("wait");
    const afterWait = runner.getOperation("after-wait");

    wait.mockResolvedValue({ completed: "mocked-after-wait" });

    await expect(
      runner.run({ payload: { test: "wait-mocking" } })
    ).rejects.toThrow("Wait step cannot be mocked");

    expect(beforeWait.getStepDetails()?.result).toEqual({
      completed: "before-wait",
    });
    expect(wait.getStatus()).toBeUndefined();
    expect(afterWait.getStatus()).toBeUndefined();
  });

  it("should throw error when accessing results from non-executed mocked operations", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        await context.step("executed-step", () =>
          Promise.resolve({ executed: true })
        );

        return { success: true };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    const executedStep = runner.getOperation<{ executed: string }>(
      "executed-step"
    );
    const nonExecutedStep = runner.getOperation<never>("non-executed-step");

    executedStep.mockResolvedValue({ executed: "mocked" });

    const result = await runner.run({ payload: { test: "error-handling" } });

    expect(result.getResult()).toEqual({ success: true });

    // Should be able to get result from executed step
    expect(executedStep.getStepDetails()).toBeDefined();

    // Should have undefined status when trying to get result from non-executed step
    expect(nonExecutedStep.getStatus()).toBeUndefined();
  });

  it("should handle mixed selection strategies in the same test", async () => {
    const handler = withDurableFunctions(
      async (event: unknown, context: DurableContext) => {
        const stepByName = await context.step("named-step", () =>
          Promise.resolve({ type: "named" })
        );

        const stepByIndex = await context.step("indexed-step", () =>
          Promise.resolve({ type: "indexed" })
        );

        return { named: stepByName, indexed: stepByIndex };
      }
    );

    const runner = new LocalDurableTestRunner({
      handlerFunction: handler,
      skipTime: true,
    });

    // Use different selection methods
    const namedStep = runner.getOperation<{ type: string }>("named-step");
    const indexedStep = runner.getOperationByIndex<{ type: string }>(1);

    namedStep.mockResolvedValue({ type: "mocked-named" });
    indexedStep.mockResolvedValue({ type: "mocked-indexed" });

    const result = await runner.run({ payload: { test: "mixed-selection" } });

    expect(result.getResult()).toEqual({
      named: { type: "mocked-named" },
      indexed: { type: "mocked-indexed" },
    });

    // Verify both operations have results
    expect(namedStep.getStepDetails()).toBeDefined();
    expect(indexedStep.getStepDetails()).toBeDefined();
  });
});
