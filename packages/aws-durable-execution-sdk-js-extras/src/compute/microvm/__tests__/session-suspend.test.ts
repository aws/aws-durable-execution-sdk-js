import {
  vi,
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
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
  autoResumingEndpoint,
  baseConfig,
  connectFailed,
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

const idlePolicy = {
  autoResumeEnabled: true,
  maxIdleDurationSeconds: 86_400,
  suspendedDurationSeconds: 3_600,
};

const recordingEndpoint = (client: FakeMicrovmsClient): FakeEndpoint =>
  autoResumingEndpoint(client);

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

/**
 * {@link twoJobsWithWait}, with a step that puts the fake MicroVM in `state`
 * after the first job, as when the worker suspends it during the wait. The
 * step runs once, so a replay does not change the state again.
 */
const suspendedDuringWait =
  (client: FakeMicrovmsClient, state: string): MicrovmSessionHandler<unknown> =>
  async (vm, ctx) => {
    const first = await vm.invoke(ctx, "first", 1, { ...job, path: "/first" });
    await ctx.step("worker suspends", async () => {
      client.microvmState = state;
    });
    await ctx.wait("pause", { minutes: 30 });
    const second = await vm.invoke(ctx, "second", 2, {
      ...job,
      path: "/second",
    });
    return [first, second];
  };

describe("microvmSession with a MicroVM that suspends itself", () => {
  it("asks the worker to suspend after 60 seconds by default when suspending is on, and makes no state call before a job", async () => {
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
    // The durable function never suspends or resumes the MicroVM itself.
    expect(client.events).toEqual([
      "request:/first",
      "request:/second",
      "terminate",
    ]);
  });

  it.each(["SUSPENDED", "SUSPENDING"])(
    "keeps sending the job to a MicroVM that is %s after the wait, and makes no ResumeMicrovm call",
    async (state) => {
      const client = new FakeMicrovmsClient();
      // The endpoint answers the 502 twice, as it does for about 5 seconds
      // after a suspend. The next request resumes the MicroVM.
      const endpoint = autoResumingEndpoint(client, 2);
      const runner = runnerFor(
        client,
        endpoint,
        suspendedDuringWait(client, state),
      );

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "first", "one");
      await complete(runner, "second", "two");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual(["one", "two"]);
      // The state check after the first 502 finds the MicroVM suspended, and
      // the step keeps sending the job. The second 502 comes 250
      // milliseconds later, so it gets no check of its own.
      expect(client.events).toEqual([
        "request:/first",
        "request:/second",
        `get:${state}`,
        "request:/second",
        "request:/second",
        "auto-resume",
        "terminate",
      ]);
    },
  );

  it("retries a 503 from a worker that suspends, and makes no state call", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    // The worker has started to suspend, so it refuses the job.
    endpoint.responses = [503, 202];
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", 1, { ...job, path: "/only" }),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "only", "done");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/only",
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
    // The MicroVM then needs no lambda:SuspendMicrovm.
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

  it("makes no state call before a job when an idle policy is set", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, twoJobsWithWait, {
      autoSuspendOnIdle: false,
      idlePolicy,
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "first", "one");
    await complete(runner, "second", "two");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.runInputs[0].idlePolicy).toEqual(idlePolicy);
    expect(client.events).toEqual([
      "request:/first",
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
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "only", 1, { ...job, path: "/only" }),
    );
    endpoint.responses = [connectFailed()];
    client.getResponses = [
      throwing(
        Object.assign(new Error("MicroVM not found: mvm-1"), {
          name: "ResourceNotFoundException",
        }),
      ),
    ];

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()).toMatchObject({
      errorType: MicrovmNotRunningError.name,
      errorMessage: expect.stringContaining("only"),
    });
    // One request and one state check: the error is not retried.
    expect(client.events).toEqual(["request:/only", "terminate"]);
    expect(client.getResponses).toHaveLength(0);
  });

  it("lets the handler catch MicrovmNotRunningError, on the first run and on replay", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const notFound = Object.assign(new Error("MicroVM not found: mvm-1"), {
      name: "ResourceNotFoundException",
    });
    client.getResponses = [throwing(notFound)];
    endpoint.responses = [connectFailed()];
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

  it("shows the handler the request ID of the GetMicrovm call that reported the removed MicroVM, on the first run and on replay", async () => {
    const operation = "GetMicrovm";
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const notFound = new ResourceNotFoundException({
      message: "MicroVM not found: mvm-1",
      $metadata: { httpStatusCode: 404, requestId: "req-123" },
      resourceType: "MicroVM",
      resourceId: "mvm-1",
    });
    client.getResponses = [throwing(notFound)];
    endpoint.responses = [connectFailed()];
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
  });
});

/**
 * Replaces the launch with a step that checkpoints a fixed result. The result
 * has the MicroVM fields of a real launch, plus `fields`. So a test controls
 * the launch checkpoint that every replay reads.
 */
function checkpointLaunchAs(fields: Record<string, unknown>): void {
  vi.spyOn(shared, "launch").mockImplementation((child, scope) =>
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

describe("microvmSession launch checkpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each<[string, Partial<MicrovmSessionConfig>]>([
    ["autoSuspendOnIdle is true", { autoSuspendOnIdle: true }],
    ["an idle policy is set", { idlePolicy }],
    ["the MicroVM cannot be suspended", {}],
  ])("records no resume mode when %s", async (_label, overrides) => {
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
    });
  });

  // An earlier version recorded `resumeBeforeDelivery` in the launch
  // checkpoint of every session, and checked the state before each job when
  // it was true. An execution in flight replays that checkpoint.
  it.each<[string, unknown]>([
    ["true", true],
    ["false", false],
  ])(
    "replays a launch checkpoint of an earlier version with resumeBeforeDelivery %s, and makes no state call before a job",
    async (_label, resumeBeforeDelivery) => {
      checkpointLaunchAs({ resumeBeforeDelivery });
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const runner = runnerFor(
        client,
        endpoint,
        suspendedDuringWait(client, "SUSPENDED"),
      );

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "first", "one");
      await complete(runner, "second", "two");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual(["one", "two"]);
      expect(
        runner.getOperation("pipeline.launch").getStepDetails()?.result,
      ).toEqual({
        microvmId: "mvm-1",
        endpoint: "mvm-1.lambda-microvm.us-east-1.on.aws",
        delivery: "http",
        resumeBeforeDelivery,
      });
      // The second job finds the MicroVM suspended. The service resumes it
      // on the request after the 502. No call checks the state before a
      // job, and no call resumes the MicroVM.
      expect(client.events).toEqual([
        "request:/first",
        "request:/second",
        "get:SUSPENDED",
        "request:/second",
        "auto-resume",
        "terminate",
      ]);
    },
  );
});
