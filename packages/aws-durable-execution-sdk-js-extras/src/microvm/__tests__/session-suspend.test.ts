import { ResourceNotFoundException } from "@aws-sdk/client-lambda-microvms";
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
import * as shared from "../shared";
import { MicrovmOperationSubType } from "../subtypes";
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

  it("fails the job at once when the MicroVM is removed before ResumeMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait);
    // The worker suspended the MicroVM during the wait. The MicroVM is then
    // removed between the state check and the resume.
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => ({ state: "SUSPENDED" }),
    ];
    client.resumeResponses = [
      throwing(
        Object.assign(new Error("MicroVM not found: mvm-1"), {
          name: "ResourceNotFoundException",
        }),
      ),
    ];

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()).toMatchObject({
      errorType: MicrovmNotRunningError.name,
      errorMessage: expect.stringContaining("second"),
    });
    // One state check and one resume for the second job: the error is not
    // retried.
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/first",
      "get:SUSPENDED",
      "resume",
      "terminate",
    ]);
  });

  it("fails the job at once when the MicroVM is removed before the ResumeMicrovm of a recheck", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    // The state check sees RUNNING. The worker suspends the MicroVM before
    // the request arrives, so the endpoint answers 502. The recheck sees
    // SUSPENDED. The MicroVM is then removed before the resume.
    endpoint.responses = [502];
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => ({ state: "SUSPENDED" }),
    ];
    client.resumeResponses = [
      throwing(
        Object.assign(new Error("MicroVM not found: mvm-1"), {
          name: "ResourceNotFoundException",
        }),
      ),
    ];
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", 1, { ...job, path: "/only" }),
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()).toMatchObject({
      errorType: MicrovmNotRunningError.name,
      errorMessage: expect.stringContaining("only"),
    });
    // One request, one recheck, and one resume: the error is not retried.
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/only",
      "get:SUSPENDED",
      "resume",
      "terminate",
    ]);
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

  it.each<"GetMicrovm" | "ResumeMicrovm">(["GetMicrovm", "ResumeMicrovm"])(
    "shows the handler the request ID of the %s call that reported the removed MicroVM, on the first run and on replay",
    async (operation) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const notFound = new ResourceNotFoundException({
        message: "MicroVM not found: mvm-1",
        $metadata: { httpStatusCode: 404, requestId: "req-123" },
        resourceType: "MicroVM",
        resourceId: "mvm-1",
      });
      if (operation === "GetMicrovm") {
        client.getResponses = [throwing(notFound)];
      } else {
        client.getResponses = [async () => ({ state: "SUSPENDED" })];
        client.resumeResponses = [throwing(notFound)];
      }
      const caught: unknown[] = [];
      const runner = runnerFor(client, endpoint, async (vm, ctx) => {
        try {
          await vm.invoke(ctx, "gone", 1, job);
          return "unexpected";
        } catch (error) {
          caught.push(error);
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
      const expected = `MicroVM "gone": the job could not be delivered: MicroVM mvm-1 no longer exists. A MicroVM lives at most its \`timeout\` plus 5 minutes, and never longer than 8 hours. ${operation} request ID: req-123.`;
      // The first entry is the first run. Each later entry is a replay.
      expect(caught.length).toBeGreaterThanOrEqual(2);
      for (const error of caught) {
        expect(error).toBeInstanceOf(MicrovmNotRunningError);
        expect((error as Error).message).toBe(expected);
      }
      // The execution history keeps the request ID too.
      expect(
        runner.getOperation("gone.request").getStepDetails()?.error,
      ).toMatchObject({
        errorType: "MicrovmStateError",
        errorMessage: expect.stringContaining(
          `${operation} request ID: req-123.`,
        ),
      });
      expect(
        runner.getOperation("gone").getContextDetails()?.error,
      ).toMatchObject({
        errorType: MicrovmNotRunningError.name,
        errorMessage: expected,
      });
    },
  );
});

/**
 * A runner whose first invocation uses `first`, and every later invocation
 * uses `later`. So it behaves as a deploy between the launch and a replay.
 */
function runnerAcrossDeploy(
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  first: Partial<MicrovmSessionConfig>,
  later: Partial<MicrovmSessionConfig>,
): { runner: Runner; invocations: () => number } {
  let invocations = 0;
  const runner = new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        invocations++;
        return microvmSession(
          context,
          "pipeline",
          {
            ...baseConfig(client),
            timeout: { hours: 1 },
            fetch: endpoint.fetch,
            ...(invocations === 1 ? first : later),
          },
          twoJobsWithWait,
        );
      },
    ),
  }) as Runner;
  return { runner, invocations: () => invocations };
}

/**
 * Replaces the launch with a step that checkpoints a fixed result. The result
 * has the MicroVM fields of a real launch, plus `fields`. So a test controls
 * the launch checkpoint that every replay reads.
 */
function checkpointLaunchAs(fields: Record<string, unknown>): void {
  jest.spyOn(shared, "launch").mockImplementation((child, scope) =>
    child.step(
      `${scope.name}.launch`,
      async () =>
        ({
          microvmId: "mvm-1",
          endpoint: "mvm-1.lambda-microvm.us-east-1.on.aws",
          delivery: "http",
          ...fields,
        }) as shared.LaunchResult,
      { subType: MicrovmOperationSubType.LAUNCH },
    ),
  );
}

const idlePolicy = {
  autoResumeEnabled: false,
  maxIdleDurationSeconds: 60,
  suspendedDurationSeconds: 3_600,
};

describe("microvmSession resume mode", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each<[string, Partial<MicrovmSessionConfig>, boolean]>([
    ["autoSuspendOnIdle is true", { autoSuspendOnIdle: true }, true],
    ["an idle policy is set", { idlePolicy }, true],
    ["the MicroVM cannot be suspended", {}, false],
  ])(
    "records the resume mode in the launch checkpoint when %s",
    async (_label, overrides, resumeBeforeDelivery) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const runner = runnerFor(client, endpoint, async () => "none", {
        autoSuspendOnIdle: undefined,
        ...overrides,
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(
        runner.getOperation("pipeline.launch").getStepDetails()?.result,
      ).toEqual({
        microvmId: "mvm-1",
        endpoint: "mvm-1.lambda-microvm.us-east-1.on.aws",
        delivery: "http",
        resumeBeforeDelivery,
      });
    },
  );

  it.each<[string, Partial<MicrovmSessionConfig>]>([
    ["autoSuspendOnIdle", { autoSuspendOnIdle: true }],
    ["the idle policy", { idlePolicy }],
  ])(
    "still resumes before each job when a deploy after the launch removes %s",
    async (_label, first) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const { runner, invocations } = runnerAcrossDeploy(
        client,
        endpoint,
        first,
        {},
      );
      // The MicroVM was suspended during the wait. The worker and the idle
      // policy keep the settings of the launch.
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
      expect(invocations()).toBeGreaterThan(1);
      expect(client.events).toEqual([
        "get:RUNNING",
        "request:/first",
        "get:SUSPENDED",
        "resume",
        "get:RUNNING",
        "request:/second",
        "terminate",
      ]);
    },
  );

  it("makes no state check when a deploy after the launch turns suspending on", async () => {
    // The launch asked the worker for no suspend and set no idle policy. So
    // the MicroVM never suspends, and a state check would need
    // lambda:GetMicrovm for nothing.
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const { runner, invocations } = runnerAcrossDeploy(
      client,
      endpoint,
      {},
      { autoSuspendOnIdle: true },
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(invocations()).toBeGreaterThan(1);
    expect(client.payload()).not.toHaveProperty("autoSuspendIdleSeconds");
    expect(client.events).toEqual([
      "request:/first",
      "request:/second",
      "terminate",
    ]);
  });

  it.each<[string, Partial<MicrovmSessionConfig>, string[]]>([
    [
      "checks the state when the current config can suspend",
      { autoSuspendOnIdle: true },
      [
        "get:RUNNING",
        "request:/first",
        "get:RUNNING",
        "request:/second",
        "terminate",
      ],
    ],
    [
      "makes no state check when the current config cannot suspend",
      { autoSuspendOnIdle: false },
      ["request:/first", "request:/second", "terminate"],
    ],
  ])(
    "for a launch checkpoint without a resume mode, %s",
    async (_label, overrides, events) => {
      // The code before this change checkpointed the launch without
      // `resumeBeforeDelivery`. The replacement step writes that shape, so
      // every replay reads it.
      checkpointLaunchAs({});
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const runner = runnerFor(client, endpoint, twoJobsWithWait, overrides);

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "first", "one");
      await complete(runner, "second", "two");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(
        runner.getOperation("pipeline.launch").getStepDetails()?.result,
      ).not.toHaveProperty("resumeBeforeDelivery");
      expect(client.events).toEqual(events);
    },
  );

  it.each<[unknown, Partial<MicrovmSessionConfig>, string[]]>([
    [
      "false",
      { autoSuspendOnIdle: false },
      ["request:/first", "request:/second", "terminate"],
    ],
    [
      1,
      { autoSuspendOnIdle: false },
      ["request:/first", "request:/second", "terminate"],
    ],
    [
      0,
      { autoSuspendOnIdle: true },
      [
        "get:RUNNING",
        "request:/first",
        "get:RUNNING",
        "request:/second",
        "terminate",
      ],
    ],
  ])(
    "follows the current config for a checkpointed resume mode of %p",
    async (recorded, overrides, events) => {
      // Only a boolean is a resume mode. A truthy or falsy value of another
      // type must not decide whether a job checks the MicroVM state.
      checkpointLaunchAs({ resumeBeforeDelivery: recorded });
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const runner = runnerFor(client, endpoint, twoJobsWithWait, overrides);

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "first", "one");
      await complete(runner, "second", "two");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(
        runner.getOperation("pipeline.launch").getStepDetails()?.result,
      ).toHaveProperty("resumeBeforeDelivery", recorded);
      expect(client.events).toEqual(events);
    },
  );
});
