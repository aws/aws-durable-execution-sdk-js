import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { EventType, ExecutionStatus } from "@aws-sdk/client-lambda";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * The end of an execution, through the real checkpoint worker.
 *
 * The runner used to wait a fixed 100 ms after every execution, so the long poll could
 * deliver the last checkpoint updates. It now asks the checkpoint server for them instead.
 * These tests check both halves: no update is lost, and no fixed wait is left.
 */
describe("execution completion", () => {
  it("records the final updates of a successful execution", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const first = await context.step("first", async () => 1);
        const second = await context.step("second", async () => 2);
        return first + second;
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toBe(3);
    expect(runner.getOperation("second").getStepDetails()?.result).toBe(2);
    const eventTypes = result.getHistoryEvents().map((e) => e.EventType);
    expect(
      eventTypes.filter((t) => t === EventType.StepSucceeded),
    ).toHaveLength(2);
    expect(eventTypes).toContain(EventType.ExecutionSucceeded);
  });

  it("records the final updates when the handler fails", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.step("before-failure", async () => "ok");
        throw new Error("handler failed");
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(result.getError()).toMatchObject({
      errorMessage: "handler failed",
    });
    const eventTypes = result.getHistoryEvents().map((e) => e.EventType);
    expect(eventTypes).toContain(EventType.StepSucceeded);
    expect(eventTypes).toContain(EventType.ExecutionFailed);
  });

  it("does not wait a fixed time after each execution", async () => {
    const handler = withDurableExecution(async () => "done");
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    // Warm up, so module loading and the worker's first request are not timed.
    await runner.run();

    const runs = 10;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      runner.reset();
      const result = await runner.run();
      expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    }
    const elapsedMs = performance.now() - start;

    // The old fixed wait alone made these runs take at least runs * 100 ms. A trivial
    // execution takes a few milliseconds, so half of that leaves a wide margin on slow
    // machines while still failing if the wait comes back.
    expect(elapsedMs).toBeLessThan(runs * 50);
  });
});
