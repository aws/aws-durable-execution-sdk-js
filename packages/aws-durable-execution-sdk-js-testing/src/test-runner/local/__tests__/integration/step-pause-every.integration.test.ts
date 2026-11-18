import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRetryStrategy,
  DurableContext,
  JitterStrategy,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";
import { OperationStatus } from "@aws/durable-execution-sdk-js";
import { realSetTimeout } from "../../real-timers/real-timers";

/**
 * A step whose retry decision has `pause: true` pauses its own execution through the local
 * runner's client. The runner then starts no invocation until the test resumes the execution.
 */
beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/** Whether `promise` settles within a short window, measured in real time. */
const settlesSoon = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) =>
      realSetTimeout(() => resolve(false), 200),
    ),
  ]);

describe("A retry decision with pause: true with the local runner", () => {
  it("pauses after every second failed attempt and continues after resume", async () => {
    const attempts: number[] = [];

    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) =>
          context.step(
            "flaky",
            async ({ attempt }) => {
              attempts.push(attempt);
              if (attempt < 3) {
                throw new Error(`attempt ${attempt} failed`);
              }
              return "done";
            },
            {
              retryStrategy: createRetryStrategy({
                maxAttempts: 6,
                initialDelay: { seconds: 1 },
                jitter: JitterStrategy.NONE,
                pauseEvery: 2,
              }),
            },
          ),
      ),
    });

    const execution = runner.run({ payload: {} });
    await runner.getOperation("flaky").waitForData();

    // With time skipped, the retry delay ends at once. The third attempt must still wait
    // for the resume.
    expect(await settlesSoon(execution)).toBe(false);
    expect(attempts).toEqual([1, 2]);
    // The retry delay elapses while paused, so the step is ready for its next attempt.
    expect(runner.getOperation("flaky").getStatus()).toBe(
      OperationStatus.READY,
    );

    await runner.resumeExecution();
    const result = await execution;

    expect(result.getResult()).toBe("done");
    expect(attempts).toEqual([1, 2, 3]);
  }, 30000);
});
