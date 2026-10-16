import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const HOUR_SECONDS = 60 * 60;
const HOUR_MS = HOUR_SECONDS * 1000;
// Longer than the tolerance below, so a delay shortened by this time fails the test.
const SLOW_WORK_MS = 2500;

function sleep(ms: number): Promise<void> {
  // The fake clock advances with real time, so this takes about `ms` of both.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expectDuration(actualMs: number, expectedMs: number): void {
  // The fake clock also advances with real time. Keep a one-second allowance for that
  // progress, while distinguishing an hour from the milliseconds the defect produced.
  expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
  expect(actualMs).toBeLessThan(expectedMs + 1000);
}

describe("skip-time clock", () => {
  it("advances by the duration of every sequential wait", async () => {
    // Four waits, because a later wait can complete inside the invocation that started
    // it. The first two waits each start a new invocation; later ones may not.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const times = [await context.step("t0", async () => Date.now())];
        for (let i = 1; i <= 4; i++) {
          await context.wait(`wait ${i}`, { seconds: HOUR_SECONDS });
          times.push(await context.step(`t${i}`, async () => Date.now()));
        }
        return times;
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const times = await runner.run().then((result) => result.getResult());

    expect(times).toHaveLength(5);
    for (let i = 1; i < times!.length; i++) {
      expectDuration(times![i] - times![i - 1], HOUR_MS);
    }
  });

  it("advances parallel waits to their latest end, not by their sum", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("parallel start", async () =>
          Date.now(),
        );
        await context.parallel("waits", [
          async (child) => child.wait("one hour", { seconds: HOUR_SECONDS }),
          async (child) =>
            child.wait("two hours", { seconds: 2 * HOUR_SECONDS }),
          async (child) =>
            child.wait("three hours", { seconds: 3 * HOUR_SECONDS }),
        ]);
        const end = await context.step("parallel end", async () => Date.now());
        return { start, end };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const { start, end } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(end - start, 3 * HOUR_MS);
  });

  it.each([
    ["the chained branch listed first", true],
    ["the chained branch listed second", false],
  ])(
    "resumes a parallel branch at its own wait's end, with %s",
    async (_label, chainedFirst) => {
      // Branch A waits 1 h twice. Branch B waits 3 h once. A must resume at 1 h and
      // finish at 2 h, so the parallel ends at 3 h, when B ends.
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          const start = await context.step("start", async () => Date.now());
          const chained = async (child: DurableContext) => {
            await child.wait("a first", { seconds: HOUR_SECONDS });
            const resumedAt = await child.step("a resumed", async () =>
              Date.now(),
            );
            await child.wait("a second", { seconds: HOUR_SECONDS });
            return resumedAt;
          };
          const single = async (child: DurableContext) => {
            await child.wait("b", { seconds: 3 * HOUR_SECONDS });
            return 0;
          };
          const results = await context.parallel(
            "waits",
            chainedFirst ? [chained, single] : [single, chained],
          );
          const end = await context.step("end", async () => Date.now());
          const resumedAt = results.getResults()[chainedFirst ? 0 : 1];
          return { start, resumedAt, end };
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      const { start, resumedAt, end } = await runner
        .run()
        .then((result) => result.getResult());

      expectDuration(resumedAt - start, HOUR_MS);
      expectDuration(end - start, 3 * HOUR_MS);
    },
  );

  it("records start times and scheduled ends on the same clock", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        for (let i = 1; i <= 3; i++) {
          await context.wait(`wait ${i}`, { seconds: HOUR_SECONDS });
        }
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    await runner.run();

    for (let i = 1; i <= 3; i++) {
      const wait = runner.getOperation(`wait ${i}`);
      const start = wait.getStartTimestamp()!.getTime();
      const scheduledEnd = wait
        .getWaitDetails()!
        .scheduledEndTimestamp!.getTime();
      // The service sets the scheduled end to the start plus the duration.
      expectDuration(scheduledEnd - start, HOUR_MS);
    }
  });

  it("starts a wait's duration when the wait starts, not when the invocation starts", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.step("slow work", async () => {
          await sleep(SLOW_WORK_MS);
        });
        const before = await context.step("before", async () => Date.now());
        await context.wait("wait", { seconds: HOUR_SECONDS });
        const after = await context.step("after", async () => Date.now());
        return { before, after };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const { before, after } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(after - before, HOUR_MS);
  }, 15_000);

  it("starts a retry delay when the attempt fails, not when the invocation starts", async () => {
    const attempts: { startedAt: number; failedAt?: number }[] = [];
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        context.step(
          "flaky",
          async () => {
            const attempt: { startedAt: number; failedAt?: number } = {
              startedAt: Date.now(),
            };
            attempts.push(attempt);
            if (attempts.length === 1) {
              await sleep(SLOW_WORK_MS);
              attempt.failedAt = Date.now();
              throw new Error("first attempt fails");
            }
            return "ok";
          },
          {
            retryStrategy: (_error, attemptCount) =>
              attemptCount < 2
                ? { shouldRetry: true, delay: { seconds: HOUR_SECONDS } }
                : { shouldRetry: false },
          },
        ),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getResult()).toBe("ok");
    expect(attempts).toHaveLength(2);
    expectDuration(attempts[1].startedAt - attempts[0].failedAt!, HOUR_MS);
  }, 15_000);
});
