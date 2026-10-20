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

  it("completes a wait while a step in another branch is still running", async () => {
    // The SDK cannot suspend while a step runs. So the wait must complete inside the
    // running invocation, when the clock reaches its end, or the step never sees it.
    let waitDone = false;
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel("waits", [
          async (child) => {
            await child.wait("short", { seconds: 1 });
            waitDone = true;
          },
          async (child) =>
            child.step("waits for the other branch", async () => {
              const giveUpAt = Date.now() + 8000;
              while (!waitDone && Date.now() < giveUpAt) {
                await sleep(50);
              }
              return waitDone;
            }),
        ]);
        return waitDone;
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getResult()).toBe(true);
  }, 15_000);

  it("keeps an invoked function's waits in order beside its caller's wait", async () => {
    // The invoked function runs in its own runner, on the same fake clock. The caller's
    // 3 h wait must not move the clock before the invoked function resumes at 1 h.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        const results = await context.parallel("waits", [
          async (child) => {
            await child.wait("caller", { seconds: 3 * HOUR_SECONDS });
            return undefined;
          },
          async (child) => child.invoke("invoked", "invokedFunction", {}),
        ]);
        const end = await context.step("end", async () => Date.now());
        const invoked = results.getResults()[1] as {
          resumedAt: number;
          endedAt: number;
        };
        return { start, end, ...invoked };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerDurableFunction(
      "invokedFunction",
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        await context.wait("invoked first", { seconds: HOUR_SECONDS });
        const resumedAt = await context.step("resumed", async () => Date.now());
        await context.wait("invoked second", { seconds: HOUR_SECONDS });
        const endedAt = await context.step("ended", async () => Date.now());
        return { resumedAt, endedAt };
      }),
    );

    const { start, end, resumedAt, endedAt } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(resumedAt - start, HOUR_MS);
    expectDuration(endedAt - start, 2 * HOUR_MS);
    expectDuration(end - start, 3 * HOUR_MS);
  });

  it("completes a later wait while a resumed step is running", async () => {
    // The clock jumps to the first wait's end, 1 h. The second wait ends 1 s later, while
    // the step that resumed after the first is still running. The runner must re-time its
    // pending end after the jump, or that end fires about an hour of real time late.
    let laterWaitDone = false;
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const results = await context.parallel("waits", [
          async (child) => {
            await child.wait("first", { seconds: HOUR_SECONDS });
            return child.step("waits for the later wait", async () => {
              const giveUpAt = Date.now() + 8000;
              while (!laterWaitDone && Date.now() < giveUpAt) {
                await sleep(50);
              }
              return laterWaitDone;
            });
          },
          async (child) => {
            await child.wait("later", { seconds: HOUR_SECONDS + 1 });
            laterWaitDone = true;
            return true;
          },
        ]);
        return results.getResults()[0];
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    expect(result.getResult()).toBe(true);
  }, 15_000);

  it("resumes a caller with an invoke's result before applying a later end", async () => {
    // Branch A invokes a function that waits 1 h, then waits 1 h itself. Branch B waits
    // 3 h. When the invoked function finishes, the clock must not reach B's end before A
    // has resumed and started its own wait.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        const results = await context.parallel("waits", [
          async (child) => {
            await child.invoke("invoked", "invokedFunction", {});
            await child.wait("after invoke", { seconds: HOUR_SECONDS });
            return child.step("a done", async () => Date.now());
          },
          async (child) => {
            await child.wait("long", { seconds: 3 * HOUR_SECONDS });
            return 0;
          },
        ]);
        const end = await context.step("end", async () => Date.now());
        return { start, aDone: results.getResults()[0] as number, end };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerDurableFunction(
      "invokedFunction",
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        await context.wait("invoked wait", { seconds: HOUR_SECONDS });
        return "invoked";
      }),
    );

    const { start, aDone, end } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(aDone - start, 2 * HOUR_MS);
    expectDuration(end - start, 3 * HOUR_MS);
  });

  it("resumes each caller with its invoke's result while another invoke still waits", async () => {
    // Branch A invokes a function that waits 1 h, then waits 1 h itself. Branch B invokes a
    // function that waits 3 h. When A's invoked function finishes, B's invoked function
    // still has a pending end. The clock must still not reach it before A has resumed.
    const waitingFunction = (seconds: number) =>
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        await context.wait("invoked wait", { seconds });
        return seconds;
      });
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        const results = await context.parallel("invokes", [
          async (child) => {
            await child.invoke("a", "oneHour", {});
            await child.wait("after invoke", { seconds: HOUR_SECONDS });
            return child.step("a done", async () => Date.now());
          },
          async (child) => {
            await child.invoke("b", "threeHours", {});
            return child.step("b done", async () => Date.now());
          },
        ]);
        const end = await context.step("end", async () => Date.now());
        const [aDone, bDone] = results.getResults() as number[];
        return { start, aDone, bDone, end };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerDurableFunction("oneHour", waitingFunction(HOUR_SECONDS));
    runner.registerDurableFunction(
      "threeHours",
      waitingFunction(3 * HOUR_SECONDS),
    );

    const { start, aDone, bDone, end } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(aDone - start, 2 * HOUR_MS);
    expectDuration(bDone - start, 3 * HOUR_MS);
    expectDuration(end - start, 3 * HOUR_MS);
  });

  it("resumes a caller with a non-durable invoke's result before applying a later end", async () => {
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        const results = await context.parallel("waits", [
          async (child) => {
            await child.invoke("plain", "plainFunction", {});
            await child.wait("after invoke", { seconds: HOUR_SECONDS });
            return child.step("a done", async () => Date.now());
          },
          async (child) => {
            await child.wait("long", { seconds: 3 * HOUR_SECONDS });
            return 0;
          },
        ]);
        const end = await context.step("end", async () => Date.now());
        return { start, aDone: results.getResults()[0] as number, end };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFunction("plainFunction", async () => "plain");

    const { start, aDone, end } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(aDone - start, HOUR_MS);
    expectDuration(end - start, 3 * HOUR_MS);
  });

  it("skips time for a later run after a run finished with an invoke still unanswered", async () => {
    // The parallel completes on the 1 s wait. The non-durable invoked function never
    // returns, so its caller never resumes with the result.
    const racing = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel(
          "race",
          [
            async (child) => child.wait("short", { seconds: 1 }),
            async (child) => child.invoke("never", "neverReturns", {}),
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        return "raced";
      },
    );
    const first = new LocalDurableTestRunner({ handlerFunction: racing });
    first.registerFunction("neverReturns", () => new Promise(() => undefined));
    await first.run();

    const waiting = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        await context.wait("long", { seconds: HOUR_SECONDS });
        const end = await context.step("end", async () => Date.now());
        return { start, end };
      },
    );
    const { start, end } = await new LocalDurableTestRunner({
      handlerFunction: waiting,
    })
      .run()
      .then((result) => result.getResult());

    expectDuration(end - start, HOUR_MS);
  });

  it("skips time later in the same run after a race leaves an invoke unanswered", async () => {
    // The parallel completes on the 1 s wait. The non-durable invoked function never
    // returns. The execution continues, so its next wait must still skip time.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel(
          "race",
          [
            async (child) => child.wait("short", { seconds: 1 }),
            async (child) => child.invoke("never", "neverReturns", {}),
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        const start = await context.step("start", async () => Date.now());
        await context.wait("after race", { seconds: HOUR_SECONDS });
        const end = await context.step("end", async () => Date.now());
        return { start, end };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerFunction("neverReturns", () => new Promise(() => undefined));

    const { start, end } = await runner
      .run()
      .then((result) => result.getResult());

    expectDuration(end - start, HOUR_MS);
  });

  it("skips an abandoned durable child's own wait, so a test can wait for what it does next", async () => {
    // The race abandons the invoke. The invoked function keeps running: it waits 1 h, then
    // signals the test, and the test completes the caller's callback.
    let signal!: () => void;
    const childSignalled = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel(
          "race",
          [
            async (child) => child.wait("short", { seconds: 1 }),
            async (child) => child.invoke("child", "slowChild", {}),
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        const [result] = await context.createCallback("from child");
        return result;
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerDurableFunction(
      "slowChild",
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        await context.wait("child wait", { seconds: HOUR_SECONDS });
        await context.step("signal", async () => {
          signal();
        });
        return "child";
      }),
    );
    const callback = runner.getOperation("from child");

    const execution = runner.run();
    await childSignalled;
    await callback.waitForData();
    await callback.sendCallbackSuccess(JSON.stringify("ok"));
    const result = await execution;

    expect(result.getResult()).toBe(JSON.stringify("ok"));
  });

  it("lets an abandoned child's short step deliver a callback before a later end", async () => {
    // The race abandons the invoke. The child keeps running: after a 1 h wait it runs a
    // step that takes a little real time and lets the test send the caller's callback.
    // The caller races that callback against a 2 h wait. The clock must not reach the 2 h
    // end while that step runs.
    let childReady!: () => void;
    const childIsReady = new Promise<void>((resolve) => {
      childReady = resolve;
    });
    let callbackSent!: () => void;
    const callbackIsSent = new Promise<void>((resolve) => {
      callbackSent = resolve;
    });
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        const start = await context.step("start", async () => Date.now());
        await context.parallel(
          "abandon",
          [
            async (child) => child.wait("short", { seconds: 1 }),
            async (child) => child.invoke("child", "sendingChild", {}),
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        const [callback] = await context.createCallback("from child");
        const results = await context.parallel(
          "callback or timeout",
          [
            async () => callback,
            async (child) => {
              await child.wait("timeout", { seconds: 2 * HOUR_SECONDS });
              return "timed out";
            },
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        const end = await context.step("end", async () => Date.now());
        return { start, end, winner: results.getResults()[0] ?? "timed out" };
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    runner.registerDurableFunction(
      "sendingChild",
      withDurableExecution(async (_event: unknown, context: DurableContext) => {
        await context.wait("child wait", { seconds: HOUR_SECONDS });
        await context.parallel("send", [
          async (child) =>
            child.step("send callback", async () => {
              await sleep(200);
              childReady();
              await callbackIsSent;
            }),
          async (child) => child.wait("long", { seconds: 3 * HOUR_SECONDS }),
        ]);
        return "child";
      }),
    );
    const callback = runner.getOperation("from child");

    const execution = runner.run();
    await childIsReady;
    await callback.waitForData();
    await callback.sendCallbackSuccess(JSON.stringify("from child"));
    callbackSent();
    const { start, end, winner } = (await execution).getResult() as {
      start: number;
      end: number;
      winner: string;
    };

    expect(winner).toBe(JSON.stringify("from child"));
    expectDuration(end - start, HOUR_MS);
  });

  describe("with a durable invoked function whose step never settles", () => {
    // The invoked function runs in its own runner. Its step never settles, so that runner
    // has an invocation running for as long as the test environment lasts.
    function registerStuckChild(runner: LocalDurableTestRunner<unknown>) {
      runner.registerDurableFunction(
        "stuckChild",
        withDurableExecution(async (_event: unknown, context: DurableContext) =>
          context.step("never settles", () => new Promise(() => undefined)),
        ),
      );
    }

    function race(context: DurableContext) {
      return context.parallel(
        "race",
        [
          async (child) => child.wait("short", { seconds: 1 }),
          async (child) => child.invoke("stuck", "stuckChild", {}),
        ],
        { completionConfig: { minSuccessful: 1 } },
      );
    }

    it("skips time later in the same run after a race abandons it", async () => {
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await race(context);
          const start = await context.step("start", async () => Date.now());
          await context.wait("after race", { seconds: HOUR_SECONDS });
          const end = await context.step("end", async () => Date.now());
          return { start, end };
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      registerStuckChild(runner);

      const { start, end } = await runner
        .run()
        .then((result) => result.getResult());

      expectDuration(end - start, HOUR_MS);
    });

    it("skips time for a later run after a run abandons it", async () => {
      const racing = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await race(context);
          return "raced";
        },
      );
      const first = new LocalDurableTestRunner({ handlerFunction: racing });
      registerStuckChild(first);
      await first.run();

      const waiting = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          const start = await context.step("start", async () => Date.now());
          await context.wait("long", { seconds: HOUR_SECONDS });
          const end = await context.step("end", async () => Date.now());
          return { start, end };
        },
      );
      const { start, end } = await new LocalDurableTestRunner({
        handlerFunction: waiting,
      })
        .run()
        .then((result) => result.getResult());

      expectDuration(end - start, HOUR_MS);
    });
  });

  it.each([
    [
      "promise.race",
      (context: DurableContext) =>
        context.promise.race("race", [
          context.invoke("never", "neverReturns", {}),
          context.wait("short", { seconds: 1 }),
        ]),
    ],
    [
      "promise.any",
      (context: DurableContext) =>
        context.promise.any("any", [
          context.invoke("never", "neverReturns", {}),
          context.wait("short", { seconds: 1 }),
        ]),
    ],
    [
      "a handler that never awaits it",
      async (context: DurableContext) => {
        context.invoke("never", "neverReturns", {}).then(
          () => undefined,
          () => undefined,
        );
      },
    ],
  ] as const)(
    "skips time with a non-durable invoke left unanswered by %s",
    async (_name, leaveInvokeUnanswered) => {
      // The non-durable invoked function never returns, and the handler does not wait for
      // it. The runner cannot see that. So the clock waits for the function only for a
      // bounded real time, and the later wait still skips time.
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await leaveInvokeUnanswered(context);
          const start = await context.step("start", async () => Date.now());
          await context.wait("later", { seconds: HOUR_SECONDS });
          const end = await context.step("end", async () => Date.now());
          return { start, end };
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      runner.registerFunction(
        "neverReturns",
        () => new Promise(() => undefined),
      );

      const { start, end } = await runner
        .run()
        .then((result) => result.getResult());

      expectDuration(end - start, HOUR_MS);
    },
  );

  it.each([
    [
      "promise.race",
      (context: DurableContext) =>
        context.promise.race("race", [
          context.invoke("stuck", "stuckChild", {}),
          context.wait("short", { seconds: 1 }),
        ]),
    ],
    [
      "promise.any",
      (context: DurableContext) =>
        context.promise.any("any", [
          context.invoke("stuck", "stuckChild", {}),
          context.wait("short", { seconds: 1 }),
        ]),
    ],
    [
      "a handler that never awaits it",
      async (context: DurableContext) => {
        context.invoke("stuck", "stuckChild", {}).then(
          () => undefined,
          () => undefined,
        );
      },
    ],
  ] as const)(
    "skips time with a durable invoke left running by %s",
    async (_name, leaveInvokeRunning) => {
      // The durable invoked function runs a step that never settles, and the handler does
      // not wait for it. The invoke is not inside a completed context, so nothing detaches
      // it. The clock waits for each invocation of it only for a bounded real time.
      const handler = withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          await leaveInvokeRunning(context);
          const start = await context.step("start", async () => Date.now());
          await context.wait("later", { seconds: HOUR_SECONDS });
          const end = await context.step("end", async () => Date.now());
          return { start, end };
        },
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      runner.registerDurableFunction(
        "stuckChild",
        withDurableExecution(async (_event: unknown, context: DurableContext) =>
          context.step("never settles", () => new Promise(() => undefined)),
        ),
      );

      const { start, end } = await runner
        .run()
        .then((result) => result.getResult());

      expectDuration(end - start, HOUR_MS);
    },
  );

  it("keeps history times in order when the main thread stalls past a callback timeout", async () => {
    // A blocking step stops the main thread's fake clock. Meanwhile the checkpoint server
    // times out the callback and records that time. The events after the stall must not
    // be recorded earlier than the timeout.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel("stall", [
          async (child) => {
            try {
              const [result] = await child.createCallback("times out", {
                timeout: { seconds: 2 },
              });
              return await result;
            } catch {
              return "timed out";
            }
          },
          async (child) => {
            // Lets the callback's START reach the checkpoint server before the block.
            await child.step("settle", async () => {
              await sleep(500);
            });
            await child.step("block", async () => {
              Atomics.wait(
                new Int32Array(new SharedArrayBuffer(4)),
                0,
                0,
                3000,
              );
            });
          },
        ]);
        await context.step("after stall", async () => "after");
        return "done";
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const result = await runner.run();

    const times = result
      .getHistoryEvents()
      .map((event) => event.EventTimestamp!.getTime());
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  }, 15_000);

  it("applies no pending end after the handler returns its result", async () => {
    // The parallel completes on the 1 h wait. The 3 h wait is still pending when the
    // handler returns, and must not complete after the execution does.
    const handler = withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        await context.parallel(
          "race",
          [
            async (child) => child.wait("one hour", { seconds: HOUR_SECONDS }),
            async (child) =>
              child.wait("three hours", { seconds: 3 * HOUR_SECONDS }),
          ],
          { completionConfig: { minSuccessful: 1 } },
        );
        return "done";
      },
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const start = Date.now();

    const result = await runner.run();

    const eventTypes = result
      .getHistoryEvents()
      .map((event) => event.EventType);
    expect(eventTypes.at(-1)).toBe("ExecutionSucceeded");
    expect(runner.getOperation("three hours").getStatus()).toBe("STARTED");
    expectDuration(Date.now() - start, HOUR_MS);
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
