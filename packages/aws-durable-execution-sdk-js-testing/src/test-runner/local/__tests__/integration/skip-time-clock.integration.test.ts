import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const HOUR_MS = 60 * 60 * 1000;

function expectDuration(actualMs: number, expectedMs: number): void {
  // The fake clock also advances with real time. Keep a one-second allowance for that
  // progress, while distinguishing an hour from the few milliseconds the defect produced.
  expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
  expect(actualMs).toBeLessThan(expectedMs + 1000);
}

describe("skip-time clock", () => {
  it("advances by the duration of every sequential wait", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        await context.wait("first wait", { seconds: HOUR_MS / 1000 });
        const afterFirst = await context.step("after first", async () =>
          Date.now(),
        );
        await context.wait("second wait", { seconds: HOUR_MS / 1000 });
        const afterSecond = await context.step("after second", async () =>
          Date.now(),
        );
        return { start, afterFirst, afterSecond };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const { start, afterFirst, afterSecond } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(afterFirst - start, HOUR_MS);
    expectDuration(afterSecond - afterFirst, HOUR_MS);
  });

  it("advances parallel waits to their latest end, not by their sum", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("parallel start", async () =>
          Date.now(),
        );
        await context.parallel("waits", [
          async (child) => child.wait("one hour", { seconds: HOUR_MS / 1000 }),
          async (child) =>
            child.wait("two hours", { seconds: (2 * HOUR_MS) / 1000 }),
          async (child) =>
            child.wait("three hours", { seconds: (3 * HOUR_MS) / 1000 }),
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
});
