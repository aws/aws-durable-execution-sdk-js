import {
  type DurableContext,
  type DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  MAX_JOB_INPUT_BYTES,
  MicrovmDeliveryError,
  type MicrovmInvokeOptions,
  type MicrovmRequestConfig,
  type MicrovmSessionConfig,
  type MicrovmSessionHandler,
  microvm,
  microvmSession,
} from "..";
import { claimSuspendAfterWarning } from "../session";
import { withJsonMember } from "../shared";
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

const IGNORED_WARNING =
  "the worker in MicroVM mvm-1 does not support suspendAfter. The MicroVM keeps running after the job.";

const job = (
  path: string,
  options: Partial<MicrovmInvokeOptions> = {},
): MicrovmInvokeOptions => ({ path, timeout: { minutes: 10 }, ...options });

/** The 202 answer of a worker that supports `suspendAfter`. */
const acknowledged = (): Response =>
  new Response(null, {
    status: 202,
    headers: { "X-Microvm-Suspend-After": "accepted" },
  });

/**
 * An endpoint that records each delivered job in the client's event list,
 * and answers like a worker that supports `suspendAfter`, unless `old` is
 * set. A queued answer is used first.
 */
function workerEndpoint(
  client: FakeMicrovmsClient,
  { old = false }: { old?: boolean } = {},
): FakeEndpoint {
  const endpoint = new FakeEndpoint();
  const deliver = endpoint.fetch;
  (endpoint as { fetch: typeof fetch }).fetch = (async (
    url: string,
    init: RequestInit,
  ) => {
    client.events.push(`request:${new URL(url).pathname}`);
    if (endpoint.responses.length === 0) {
      const body = JSON.parse(init.body as string);
      endpoint.responses.push(
        body.suspendAfter === true && !old ? acknowledged() : 202,
      );
    }
    return deliver(url, init);
  }) as unknown as typeof fetch;
  return endpoint;
}

/** Records the warnings that the operations log. */
function recordingLogger(warnings: string[]): DurableLogger {
  const ignore = (): void => {};
  return {
    log: ignore,
    error: ignore,
    info: ignore,
    debug: ignore,
    warn: (message: string) => {
      warnings.push(message);
    },
  };
}

function runnerFor(
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  handler: MicrovmSessionHandler<unknown>,
  overrides: Partial<MicrovmSessionConfig> = {},
  warnings: string[] = [],
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        context.configureLogger({ customLogger: recordingLogger(warnings) });
        return microvmSession(
          context,
          "pipeline",
          {
            ...baseConfig(client),
            timeout: { hours: 1 },
            fetch: endpoint.fetch,
            ...overrides,
          },
          handler,
        );
      },
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

/** A suspendAfter job, then one more job. */
const suspendThenJob: MicrovmSessionHandler<unknown> = async (vm, ctx) => {
  const build = await vm.invoke(
    ctx,
    "build",
    1,
    job("/build", { suspendAfter: true }),
  );
  return [build, await vm.invoke(ctx, "test", 2, job("/test"))];
};

/**
 * A suspendAfter job, a durable wait, and one more job. The wait ends the
 * invocation. So the second job runs in a later invocation, in which the
 * first job's child context is complete.
 */
const suspendThenWaitThenJob: MicrovmSessionHandler<unknown> = async (
  vm,
  ctx,
) => {
  const build = await vm.invoke(
    ctx,
    "build",
    1,
    job("/build", { suspendAfter: true }),
  );
  await ctx.wait("pause", { minutes: 30 });
  return [build, await vm.invoke(ctx, "test", 2, job("/test"))];
};

/** GetMicrovm reports RUNNING once, and then the suspended MicroVM. */
function suspendedAfterFirstCheck(client: FakeMicrovmsClient): void {
  client.getResponses = [
    async () => ({ state: "RUNNING" }),
    async () => {
      client.microvmState = "SUSPENDED";
      return { state: "SUSPENDED" };
    },
  ];
}

describe("vm.invoke with suspendAfter", () => {
  it("asks the worker to suspend after the job only when it is set", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    const runner = runnerFor(client, endpoint, suspendThenWaitThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    const [first, second] = endpoint.requests.map((request) => request.body);
    expect(first).toEqual({
      version: 1,
      region: expect.any(String),
      microvmId: "mvm-1",
      suspendAfter: true,
      callbackId: expect.any(String),
      input: 1,
    });
    expect(second).not.toHaveProperty("suspendAfter");
    expect(second.version).toBe(1);
    // The run hook payload never carries it.
    expect(client.payload()).toEqual({
      version: 1,
      region: expect.any(String),
    });
    // suspendAfter is not a session setting. So the launch records no resume
    // mode for it.
    expect(
      runner.getOperation("pipeline.launch").getStepDetails()?.result,
    ).toMatchObject({ resumeBeforeDelivery: false });
  });

  it("checks the state before the jobs after a suspendAfter job, and resumes a suspended MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    suspendedAfterFirstCheck(client);
    const runner = runnerFor(client, endpoint, suspendThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([1, 2]);
    // The flag is set before the job's child context. So the suspendAfter
    // job checks the state too.
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/build",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("sets the flag again when a completed suspendAfter job replays", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    suspendedAfterFirstCheck(client);
    let invocations = 0;
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      invocations++;
      return suspendThenWaitThenJob(vm, ctx);
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(invocations).toBeGreaterThan(1);
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/build",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("makes no state check before a suspendAfter job of the session", async () => {
    // Jobs before the first suspendAfter job keep the resume mode of the
    // launch.
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      await vm.invoke(ctx, "setup", 0, job("/setup"));
      return suspendThenJob(vm, ctx);
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "setup", 0);
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/setup",
      "get:RUNNING",
      "request:/build",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("rechecks the state after a 503 in a flagged session, as in the resume mode", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    // The second job's state check sees RUNNING. The worker has started to
    // suspend, so it answers 503. The retry sees SUSPENDED, resumes the
    // MicroVM, and delivers the job.
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      async () => ({ state: "RUNNING" }),
      async () => {
        client.microvmState = "SUSPENDED";
        return { state: "SUSPENDED" };
      },
    ];
    endpoint.responses = [acknowledged(), 503];
    const runner = runnerFor(client, endpoint, suspendThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "get:RUNNING",
      "request:/build",
      "get:RUNNING",
      "request:/test",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("keeps the strict state check in a flagged session: a denied GetMicrovm fails the job", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    const denied = Object.assign(new Error("not authorized: GetMicrovm"), {
      name: "AccessDeniedException",
    });
    client.getResponses = [
      async () => ({ state: "RUNNING" }),
      throwing(denied),
    ];
    // The default strategy does not retry AccessDeniedException.
    const runner = runnerFor(client, endpoint, suspendThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError()).toMatchObject({
      errorType: MicrovmDeliveryError.name,
      errorMessage: expect.stringContaining("not authorized: GetMicrovm"),
    });
    expect(client.events).not.toContain("request:/test");
  });

  it.each<[string, boolean, number]>([
    ["an older worker", true, 1],
    ["a worker that supports it", false, 0],
  ])(
    "logs the suspendAfter warning once per session for %s",
    async (_label, old, expected) => {
      const client = new FakeMicrovmsClient();
      const endpoint = workerEndpoint(client, { old });
      const warnings: string[] = [];
      const runner = runnerFor(
        client,
        endpoint,
        async (vm, ctx) => {
          const build = await vm.invoke(
            ctx,
            "build",
            1,
            job("/build", { suspendAfter: true }),
          );
          // The wait ends the invocation. So the second job runs with a new
          // session handle, and the session still warns once.
          await ctx.wait("pause", { minutes: 30 });
          return [
            build,
            await vm.invoke(
              ctx,
              "test",
              2,
              job("/test", { suspendAfter: true }),
            ),
          ];
        },
        {},
        warnings,
      );

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "build", 1);
      await complete(runner, "test", 2);
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(endpoint.requests).toHaveLength(2);
      expect(warnings.filter((w) => w === IGNORED_WARNING)).toHaveLength(
        expected,
      );
    },
  );

  it("reads no acknowledgement for a job without suspendAfter", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client, { old: true });
    const warnings: string[] = [];
    const runner = runnerFor(
      client,
      endpoint,
      async (vm, ctx) => vm.invoke(ctx, "build", 1, job("/build")),
      {},
      warnings,
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(warnings).not.toContain(IGNORED_WARNING);
  });

  it("remembers the warning of the latest 1,000 sessions only", () => {
    const prefix = `lru-${Date.now()}`;
    expect(claimSuspendAfterWarning(`${prefix}-0`)).toBe(true);
    // Each session warns once.
    expect(claimSuspendAfterWarning(`${prefix}-0`)).toBe(false);
    for (let i = 1; i <= 1_000; i++) {
      expect(claimSuspendAfterWarning(`${prefix}-${i}`)).toBe(true);
    }
    // The oldest session was dropped, so it can warn again. A later one
    // cannot.
    expect(claimSuspendAfterWarning(`${prefix}-1000`)).toBe(false);
    expect(claimSuspendAfterWarning(`${prefix}-0`)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a number", 1],
    ["a string", "yes"],
    ["null", null],
  ])(
    "rejects a suspendAfter that is %s inside the handler, before any job operation",
    async (_label, suspendAfter) => {
      const client = new FakeMicrovmsClient();
      const endpoint = workerEndpoint(client);
      const runner = runnerFor(client, endpoint, async (vm, ctx) => {
        try {
          await vm.invoke(
            ctx,
            "build",
            1,
            job("/build", { suspendAfter: suspendAfter as boolean }),
          );
          return "unexpected";
        } catch (error) {
          return {
            typeError: error instanceof TypeError,
            message: (error as Error).message,
          };
        }
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        typeError: true,
        message: 'MicroVM "build": suspendAfter must be a boolean',
      });
      expect(
        execution.getOperations().map((operation) => operation.getName()),
      ).not.toContain("build");
      expect(endpoint.requests).toHaveLength(0);
    },
  );

  it("sends no suspendAfter for a job with suspendAfter set to false", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = workerEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: false })),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests[0].body).not.toHaveProperty("suspendAfter");
    expect(client.events).toEqual(["request:/build", "terminate"]);
  });
});

describe("microvm with suspendAfter in its request", () => {
  it.each<[string, unknown, string]>([
    ["true", true, "suspendAfter applies only to a session job"],
    ["a number", 1, "suspendAfter must be a boolean"],
    ["a string", "true", "suspendAfter must be a boolean"],
    ["null", null, "suspendAfter must be a boolean"],
  ])(
    "rejects a suspendAfter that is %s with a TypeError before any durable operation",
    async (_label, suspendAfter, message) => {
      const client = new FakeMicrovmsClient();
      const handler = withDurableExecution(
        async (event: unknown, context: DurableContext) =>
          microvm(context, "build", event, {
            ...baseConfig(client),
            request: {
              path: "/build",
              suspendAfter,
            } as MicrovmRequestConfig,
          }).catch((error: unknown) => ({
            typeError: error instanceof TypeError,
            message: (error as Error).message,
          })),
      );
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });

      const execution = await runner.run({ payload: {} });

      expect(execution.getResult()).toEqual({
        typeError: true,
        message: expect.stringContaining(`MicroVM "build": ${message}`),
      });
      expect(execution.getOperations()).toHaveLength(0);
      expect(client.runInputs).toHaveLength(0);
    },
  );

  it("accepts invoke options with suspendAfter set to false as its request", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    const request: MicrovmInvokeOptions = job("/build", {
      suspendAfter: false,
    });
    const handler = withDurableExecution(
      async (event: unknown, context: DurableContext) =>
        microvm(context, "build", event, {
          ...baseConfig(client),
          fetch: endpoint.fetch,
          request,
        }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner as Runner, "build", "done");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests[0].body).not.toHaveProperty("suspendAfter");
  });
});

describe("the job request fields with suspendAfter", () => {
  it("fit in the margin of MAX_JOB_INPUT_BYTES", () => {
    // The largest fixed fields: a MicroVM ID of 256 characters that JSON
    // writes as 6-byte escapes, a callback ID of 1,024 characters, and an
    // 8-hour heartbeat timeout.
    const fields = {
      version: 1,
      region: "ap-southeast-5",
      microvmId: "\u0001".repeat(256),
      suspendAfter: true,
      callbackId: "A".repeat(1_024),
      heartbeatTimeoutSeconds: 28_800,
    };
    const body = withJsonMember(fields, "input", "null");
    const fixedBytes = Buffer.byteLength(body) - "null".length;

    expect(fixedBytes).toBeLessThan(6 * 1024 * 1024 - MAX_JOB_INPUT_BYTES);
    expect(
      Buffer.byteLength(JSON.stringify(fields)) -
        Buffer.byteLength(
          JSON.stringify({ ...fields, suspendAfter: undefined }),
        ),
    ).toBe(20);
  });
});
