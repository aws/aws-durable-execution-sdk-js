import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../types/durable-operation";

/**
 * pauseExecution and resumeExecution with skipTime, which swaps the timer scheduler for a
 * queue that starts every invocation as soon as it can. A wait that ends while paused must
 * still be held back rather than started straight away.
 */
beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/** Whether `promise` settles within a short window. */
const settlesSoon = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
  ]);

describe("pauseExecution and resumeExecution with skipTime", () => {
  it("holds back the invocation a finished wait would start", async () => {
    let invocations = 0;

    const durableHandler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.wait("cool-down", { hours: 1 });
        return "done";
      },
    );
    const runner = new LocalDurableTestRunner({
      handlerFunction: (event, context) => {
        invocations++;
        return durableHandler(event, context);
      },
    });

    const execution = runner.run({ payload: {} });
    await runner
      .getOperation("cool-down")
      .waitForData(WaitingOperationStatus.STARTED);
    await runner.pauseExecution();
    const invocationsWhenPaused = invocations;

    // With time skipped, the hour-long wait ends at once; its invocation must wait for resume.
    await runner
      .getOperation("cool-down")
      .waitForData(WaitingOperationStatus.COMPLETED);
    // The wait completing is seen before the invocation it schedules would start, so give
    // that invocation room to start -- and the execution room to finish -- before checking.
    expect(await settlesSoon(execution)).toBe(false);
    expect(invocations).toBe(invocationsWhenPaused);

    await runner.resumeExecution();
    const result = await execution;

    expect(result.getStatus()).toBe("SUCCEEDED");
    expect(result.getResult()).toBe("done");
  }, 30000);

  it("continues an invocation paused mid-step", async () => {
    // With skipTime the queue scheduler counts the invocation that is ending as scheduled
    // work, so the orchestrator must not take that as a sign that something else will
    // continue the execution. Nothing will; resume has to.
    const secondRuns: number[] = [];

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.step("first", async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return "a";
        });
        return context.step("second", async () => {
          secondRuns.push(1);
          return "b";
        });
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = runner.run({ payload: {} });
    await runner
      .getOperation("first")
      .waitForData(WaitingOperationStatus.STARTED);
    await runner.pauseExecution();
    expect(secondRuns).toEqual([]);

    await runner.resumeExecution();
    const result = await execution;

    expect(result.getResult()).toBe("b");
    expect(secondRuns).toEqual([1]);
  }, 30000);
});
