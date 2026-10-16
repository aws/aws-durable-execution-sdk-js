import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  MicrovmDeliveryError,
  MicrovmNotRunningError,
  type MicrovmSessionConfig,
  type MicrovmSessionHandler,
  microvmSession,
} from "..";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  throwing,
} from "./fakes";

type Runner = LocalDurableTestRunner<unknown>;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const job = { path: "/job", timeout: { minutes: 10 } };

/** Records each delivered job in the client's event list, in call order. */
function recordingEndpoint(client: FakeMicrovmsClient): FakeEndpoint {
  const endpoint = new FakeEndpoint();
  const deliver = endpoint.fetch;
  (endpoint as { fetch: typeof fetch }).fetch = (async (
    url: string,
    init: RequestInit,
  ) => {
    client.events.push(`request:${new URL(url).pathname}`);
    return deliver(url, init);
  }) as unknown as typeof fetch;
  return endpoint;
}

function runnerFor(
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  handler: MicrovmSessionHandler<unknown>,
  overrides: Partial<MicrovmSessionConfig> = {},
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) =>
        microvmSession(
          context,
          "pipeline",
          {
            ...baseConfig(client),
            timeout: { hours: 1 },
            fetch: endpoint.fetch,
            // Suspending is off by default. These tests are about suspending.
            autoSuspendOnIdle: true,
            ...overrides,
          },
          handler,
        ),
    ),
  }) as Runner;
}

async function complete(
  runner: Runner,
  jobName: string,
  result: unknown,
): Promise<void> {
  const callback = runner.getOperation(`${jobName}.callback`);
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation(`${jobName}.request`)
    .waitForData(WaitingOperationStatus.COMPLETED);
  await callback.sendCallbackSuccess(JSON.stringify(result));
}

/** A session that runs one job, waits, and runs a second job. */
const twoJobsWithWait: MicrovmSessionHandler<unknown> = async (vm, ctx) => {
  const first = await vm.invoke(ctx, "first", 1, { ...job, path: "/first" });
  await ctx.wait("pause", { minutes: 30 });
  const second = await vm.invoke(ctx, "second", 2, { ...job, path: "/second" });
  return [first, second];
};

describe("microvmSession with a MicroVM that suspends itself", () => {
  it("asks the worker to suspend after 60 seconds by default when suspending is on, and checks the state before each job", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual(["one", "two"]);
    expect(client.payload()).toEqual({
      version: 1,
      region: expect.any(String),
      autoSuspendIdleSeconds: 60,
    });
    // The durable function never suspends the MicroVM itself.
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/first",
      "get:RUNNING",
      "request:/second",
      "terminate",
    ]);
  });

  it("resumes a MicroVM that the worker suspended during the wait", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait);
    // The worker suspended the MicroVM during the wait.
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => {
        client.microvmState = "SUSPENDED";
        return { state: "SUSPENDED" };
      },
    ];

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/first",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/second",
      "terminate",
    ]);
  });

  it("checks the state again when the MicroVM suspends itself just before the request", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    // The state check sees RUNNING. The worker suspends the MicroVM before
    // the request arrives, so the endpoint answers 502. The retry checks the
    // state, resumes the MicroVM, and delivers the job.
    endpoint.responses = [502, 202];
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => {
        client.microvmState = "SUSPENDED";
        return { state: "SUSPENDED" };
      },
    ];
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", 1, { ...job, path: "/only" }),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "only", "done");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/only",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/only",
      "terminate",
    ]);
  });

  it("resumes and delivers again when the worker refuses the job while it suspends", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    // The state check sees RUNNING. The worker has started to suspend, so it
    // answers 503. The retry sees SUSPENDING, waits, resumes the MicroVM, and
    // delivers the job.
    endpoint.responses = [503, 202];
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => ({ state: "SUSPENDING" }),
      async () => {
        client.microvmState = "SUSPENDED";
        return { state: "SUSPENDED" };
      },
    ];
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", 1, { ...job, path: "/only" }),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "only", "done");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/only",
      "get:SUSPENDING",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/only",
      "terminate",
    ]);
  });

  it("does not suspend by default when suspending is on and the session timeout is under 10 seconds", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, async () => "none", {
      timeout: { seconds: 9 },
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.payload()).not.toHaveProperty("autoSuspendIdleSeconds");
    expect(client.events).toEqual(["terminate"]);
  });

  it("passes a custom idle time to the worker", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait, {
      autoSuspendIdleTime: { minutes: 2 },
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    await executionPromise;

    expect(client.payload().autoSuspendIdleSeconds).toBe(120);
  });

  it.each<[string, Partial<MicrovmSessionConfig>]>([
    ["by default", { autoSuspendOnIdle: undefined }],
    ["when autoSuspendOnIdle is false", { autoSuspendOnIdle: false }],
  ])("does nothing extra %s with no idle policy", async (_label, overrides) => {
    // The function then needs no lambda:GetMicrovm or lambda:ResumeMicrovm,
    // and the MicroVM needs no lambda:SuspendMicrovm.
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait, overrides);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.payload()).not.toHaveProperty("autoSuspendIdleSeconds");
    expect(client.events).toEqual([
      "request:/first",
      "request:/second",
      "terminate",
    ]);
  });

  it("still resumes before each job when an idle policy can suspend the MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait, {
      autoSuspendOnIdle: false,
      idlePolicy: {
        autoResumeEnabled: false,
        maxIdleDurationSeconds: 60,
        suspendedDurationSeconds: 3_600,
      },
    });
    // The idle policy suspended the MicroVM during the wait.
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => ({ state: "SUSPENDED" }),
    ];

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/first",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/second",
      "terminate",
    ]);
  });

  it.each<[string, Partial<MicrovmSessionConfig>, string]>([
    [
      "an idle time shorter than 10 seconds",
      { autoSuspendIdleTime: { seconds: 9 } },
      "autoSuspendIdleTime must be at least 10 seconds",
    ],
    [
      "an idle time longer than the session timeout",
      { timeout: { minutes: 5 }, autoSuspendIdleTime: { minutes: 10 } },
      "autoSuspendIdleTime must not be longer than timeout",
    ],
    [
      "an idle time while autoSuspendOnIdle is false",
      { autoSuspendOnIdle: false, autoSuspendIdleTime: { seconds: 30 } },
      "autoSuspendIdleTime is set, but autoSuspendOnIdle is not true",
    ],
    [
      "an idle time while autoSuspendOnIdle is not set",
      { autoSuspendOnIdle: undefined, autoSuspendIdleTime: { seconds: 30 } },
      "autoSuspendIdleTime is set, but autoSuspendOnIdle is not true",
    ],
  ])(
    "rejects %s before any durable operation",
    async (_label, overrides, message) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const runner = runnerFor(client, endpoint, twoJobsWithWait, overrides);

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(message);
      expect(client.runInputs).toHaveLength(0);
    },
  );

  it("fails the job at once when the MicroVM no longer exists", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait);
    const notFound = Object.assign(new Error("MicroVM not found: mvm-1"), {
      name: "ResourceNotFoundException",
    });
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      throwing(notFound),
    ];

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()).toMatchObject({
      errorType: MicrovmNotRunningError.name,
      errorMessage: expect.stringContaining("second"),
    });
    // One GetMicrovm for the second job: the error is not retried.
    expect(client.events.filter((e) => e.startsWith("get"))).toHaveLength(1);
    expect(client.events).not.toContain("request:/second");
  });

  it("lets the handler catch MicrovmNotRunningError, on the first run and on replay", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const notFound = Object.assign(new Error("MicroVM not found: mvm-1"), {
      name: "ResourceNotFoundException",
    });
    client.getResponses = [throwing(notFound)];
    const caught: { notRunning: boolean; delivery: boolean }[] = [];
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      try {
        await vm.invoke(ctx, "gone", 1, job);
        return "unexpected";
      } catch (error) {
        caught.push({
          notRunning: error instanceof MicrovmNotRunningError,
          delivery: error instanceof MicrovmDeliveryError,
        });
      }
      // A pending callback ends the invocation. The next invocation replays
      // the failed job from its checkpoint and catches the error again.
      const [resumed] = await ctx.createCallback("go");
      await resumed;
      return "caught";
    });

    const executionPromise = runner.run({ payload: {} });
    const go = runner.getOperation("go");
    await go.waitForData(WaitingOperationStatus.STARTED);
    await go.sendCallbackSuccess(JSON.stringify("go"));
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe("caught");
    expect(caught.length).toBeGreaterThanOrEqual(2);
    expect(caught.every((c) => c.notRunning && c.delivery)).toBe(true);
  });
});
