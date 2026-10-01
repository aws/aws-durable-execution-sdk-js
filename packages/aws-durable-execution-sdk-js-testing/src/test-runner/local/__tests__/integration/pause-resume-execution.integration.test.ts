import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { WaitingOperationStatus } from "../../../types/durable-operation";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * pauseExecution and resumeExecution, end to end.
 *
 * Pausing answers the running invocation's next checkpoint without a `CheckpointToken`, the
 * signal the service uses for an invocation it will accept no further checkpoints from. The
 * SDK suspends that invocation with PENDING, and the runner starts no further invocation
 * until resumed.
 */

/** A promise the test resolves by hand, to hold a step body at a known point. */
const gate = (): { opened: Promise<void>; open: () => void } => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

/** Whether `promise` settles within a short real-time window. */
const settlesSoon = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
  ]);

describe("pauseExecution and resumeExecution", () => {
  it("suspends the running invocation and continues it after resume", async () => {
    const bodyStarted = gate();
    const releaseBody = gate();
    const bodyRuns = { first: 0, second: 0 };

    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const first = await context.step("first", async () => {
          bodyRuns.first++;
          bodyStarted.open();
          await releaseBody.opened;
          return "a";
        });
        const second = await context.step("second", async () => {
          bodyRuns.second++;
          return "b";
        });
        return `${first}${second}`;
      },
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = runner.run({ payload: {} });

    // Pause while "first" is running. The pause cannot take effect until the invocation
    // next checkpoints, which is when the step body returns, so pauseExecution() is not
    // awaited until the body is let go.
    await bodyStarted.opened;
    const paused = runner.pauseExecution();
    releaseBody.open();
    await paused;

    // "first"'s SUCCEED was the checkpoint answered without a token, so it was kept; the
    // invocation stopped there, and "second" never started.
    expect(bodyRuns).toEqual({ first: 1, second: 0 });
    expect(await settlesSoon(execution)).toBe(false);
    expect(bodyRuns).toEqual({ first: 1, second: 0 });

    await runner.resumeExecution();
    const result = await execution;

    expect(result.getStatus()).toBe("SUCCEEDED");
    expect(result.getResult()).toBe("ab");
    // The resumed invocation replayed "first" from its checkpoint rather than running it.
    expect(bodyRuns).toEqual({ first: 1, second: 1 });
    expect(result.getInvocations()).toHaveLength(2);
  }, 30000);

  it("holds back invocations while paused, including ones a callback would start", async () => {
    let invocations = 0;

    const durableHandler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.waitForCallback<string>("approval", async () => undefined),
    );
    const runner = new LocalDurableTestRunner({
      handlerFunction: (event, context) => {
        invocations++;
        return durableHandler(event, context);
      },
    });

    const execution = runner.run({ payload: {} });
    const approval = runner.getOperation("approval");
    await approval.waitForData(WaitingOperationStatus.STARTED);

    // Nothing is running, so this resolves once the first invocation has suspended.
    await runner.pauseExecution();
    const invocationsWhenPaused = invocations;

    await approval.sendCallbackSuccess("approved");
    expect(await settlesSoon(execution)).toBe(false);
    expect(invocations).toBe(invocationsWhenPaused);

    await runner.resumeExecution();
    const result = await execution;

    expect(result.getStatus()).toBe("SUCCEEDED");
    expect(result.getResult()).toBe("approved");
  }, 30000);

  it("is idempotent", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.waitForCallback<string>("approval", async () => undefined),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const execution = runner.run({ payload: {} });
    const approval = runner.getOperation("approval");
    await approval.waitForData(WaitingOperationStatus.STARTED);

    await runner.pauseExecution();
    await runner.pauseExecution();
    await approval.sendCallbackSuccess("approved");
    await runner.resumeExecution();
    await runner.resumeExecution();

    expect((await execution).getResult()).toBe("approved");
  }, 30000);

  it("needs an execution in progress", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(async () => "done"),
    });

    await expect(runner.pauseExecution()).rejects.toThrow(
      /needs an execution in progress/,
    );
    await expect(runner.resumeExecution()).rejects.toThrow(
      /needs an execution in progress/,
    );

    // A finished run no longer counts as in progress.
    await runner.run({ payload: {} });
    await expect(runner.pauseExecution()).rejects.toThrow(
      /needs an execution in progress/,
    );
  });
});
