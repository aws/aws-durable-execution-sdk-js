import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LambdaMicrovmsServiceException } from "@aws-sdk/client-lambda-microvms";
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
  type MicrovmInvokeOptions,
  type MicrovmRequestConfig,
  type MicrovmSessionConfig,
  type MicrovmSessionHandler,
  microvm,
  microvmSession,
} from "..";
import { withJsonMember } from "../shared";
import {
  baseConfig,
  FakeEndpoint,
  FakeMicrovmsClient,
  hangUntilAborted,
  throwing,
} from "./fakes";
import { INVOCATION_RESERVE_MS } from "../request";

type Runner = LocalDurableTestRunner<unknown>;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const SUSPEND_WARNING_PREFIX =
  'MicroVM "build": suspend after the job failed for mvm-1.';

const job = (
  path: string,
  options: Partial<MicrovmInvokeOptions> = {},
): MicrovmInvokeOptions => ({ path, timeout: { minutes: 10 }, ...options });

/** An endpoint that records each delivered job in the client's event list. */
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

/** Records the warnings that the operations log. */
function recordingLogger(
  warnings: string[],
  data: unknown[] = [],
): DurableLogger {
  const ignore = (): void => {};
  return {
    log: ignore,
    error: ignore,
    info: ignore,
    debug: ignore,
    warn: (message: string, ...rest: unknown[]) => {
      warnings.push(message);
      data.push(...rest);
    },
  };
}

function runnerFor(
  client: FakeMicrovmsClient,
  endpoint: FakeEndpoint,
  handler: MicrovmSessionHandler<unknown>,
  overrides: Partial<MicrovmSessionConfig> = {},
  warnings: string[] = [],
  warningData: unknown[] = [],
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (_event: unknown, context: DurableContext) => {
        context.configureLogger({
          customLogger: recordingLogger(warnings, warningData),
        });
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

async function fail(runner: Runner, jobName: string): Promise<void> {
  const callback = runner.getOperation(`${jobName}.callback`);
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation(`${jobName}.request`)
    .waitForData(WaitingOperationStatus.COMPLETED);
  await callback.sendCallbackFailure({
    ErrorType: "BuildError",
    ErrorMessage: "3 tests failed",
  });
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

describe("vm.invoke with suspendAfter", () => {
  it("calls SuspendMicrovm once with the session's MicroVM ID after the job's result, and resumes before the next job", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, suspendThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([1, 2]);
    expect(client.suspendInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
    // The suspend follows the first job. The next job checks the state, and
    // resumes the suspended MicroVM before it delivers.
    expect(client.events).toEqual([
      "request:/build",
      "suspend",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("waits for the job's result before it calls SuspendMicrovm", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, suspendThenJob);

    const executionPromise = runner.run({ payload: {} });
    await runner
      .getOperation("build.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    // The job is delivered and runs in the MicroVM. Its result has not
    // arrived, so the MicroVM must keep running.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.suspendInputs).toHaveLength(0);

    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    await executionPromise;
    expect(client.suspendInputs).toHaveLength(1);
  });

  it("sends no suspendAfter field in the job request and ignores the answer's headers", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const warnings: string[] = [];
    const runner = runnerFor(client, endpoint, suspendThenJob, {}, warnings);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    await executionPromise;

    expect(endpoint.requests[0].body).toEqual({
      version: 1,
      region: expect.any(String),
      microvmId: "mvm-1",
      callbackId: expect.any(String),
      input: 1,
    });
    // A plain 202 is enough. No acknowledgement header is read.
    expect(warnings).toEqual([]);
  });

  it("does not call SuspendMicrovm for a job without suspendAfter", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) =>
      vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: false })),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.suspendInputs).toHaveLength(0);
    expect(client.events).toEqual(["request:/build", "terminate"]);
  });

  it("calls SuspendMicrovm after a failed job too, and the handler can catch the failure", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      try {
        await vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: true }));
        return "unexpected";
      } catch (error) {
        return (error as Error).name;
      }
    });

    const executionPromise = runner.run({ payload: {} });
    await fail(runner, "build");
    const execution = await executionPromise;

    expect(execution.getResult()).toBe("MicrovmJobFailedError");
    expect(client.suspendInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
  });

  it("does not call SuspendMicrovm when the job was not delivered", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    // Any other 4xx fails the delivery at once. The job never ran.
    endpoint.responses = [404];
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      try {
        await vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: true }));
        return "unexpected";
      } catch (error) {
        return (error as Error).name;
      }
    });

    const execution = await runner.run({ payload: {} });

    expect(execution.getResult()).toBe("MicrovmDeliveryError");
    expect(client.suspendInputs).toHaveLength(0);
  });

  it("does not call SuspendMicrovm again when a completed job replays", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
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
    // The handler runs again after the wait, and replays the completed job.
    expect(invocations).toBeGreaterThan(1);
    expect(client.suspendInputs).toHaveLength(1);
  });

  it("checks the state before the next job when a completed suspendAfter job replays", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, suspendThenWaitThenJob);

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    // The wait ends the invocation. The next invocation replays the
    // completed build job without running its child context. It still
    // records that the MicroVM may be suspended. So the test job checks the
    // state and resumes before delivery.
    expect(client.suspendInputs).toHaveLength(1);
    expect(client.events).toEqual([
      "request:/build",
      "suspend",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("checks the state before the next job when the suspendAfter job ended before it was awaited", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      const build = vm.invoke(
        ctx,
        "build",
        1,
        job("/build", { suspendAfter: true }),
      );
      await ctx.wait("pause", { seconds: 5 });
      const test = await vm.invoke(ctx, "test", 2, job("/test"));
      return [await build, test];
    });

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([1, 2]);
    // The build job ended and suspended the MicroVM while the handler
    // waited. So the test job checks the state, although the handler
    // awaits the build result only after the test job.
    expect(client.events).toEqual([
      "request:/build",
      "suspend",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("checks the state before the next job when the suspendAfter job failed", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const runner = runnerFor(client, endpoint, async (vm, ctx) => {
      let failure = "none";
      try {
        await vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: true }));
      } catch (error) {
        failure = (error as Error).name;
      }
      return [failure, await vm.invoke(ctx, "test", 2, job("/test"))];
    });

    const executionPromise = runner.run({ payload: {} });
    await fail(runner, "build");
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getResult()).toEqual(["MicrovmJobFailedError", 2]);
    expect(client.events).toEqual([
      "request:/build",
      "suspend",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("stops a stalled SuspendMicrovm call at the invocation reserve, using the Lambda context's remaining time", async () => {
    const client = new FakeMicrovmsClient();
    client.suspendResponses = [hangUntilAborted];
    const endpoint = recordingEndpoint(client);
    const warnings: string[] = [];
    // The time the invocation ends. An hour away until the job's result
    // arrives, then the reserve is 1.5 seconds away.
    let endsAt = Date.now() + 3_600_000;
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => {
          (
            context.lambdaContext as { getRemainingTimeInMillis: () => number }
          ).getRemainingTimeInMillis = () => endsAt - Date.now();
          context.configureLogger({ customLogger: recordingLogger(warnings) });
          return microvmSession(
            context,
            "pipeline",
            {
              ...baseConfig(client),
              timeout: { hours: 1 },
              fetch: endpoint.fetch,
            },
            async (vm, ctx) =>
              vm.invoke(ctx, "build", 1, job("/build", { suspendAfter: true })),
          );
        },
      ),
    }) as Runner;

    const executionPromise = runner.run({ payload: {} });
    const callback = runner.getOperation("build.callback");
    await callback.waitForData(WaitingOperationStatus.STARTED);
    await runner
      .getOperation("build.request")
      .waitForData(WaitingOperationStatus.COMPLETED);
    const reserveAt = Date.now() + 1_500;
    endsAt = reserveAt + INVOCATION_RESERVE_MS;
    await callback.sendCallbackSuccess(JSON.stringify(1));
    const execution = await executionPromise;

    // The job returns its result at the reserve, not when the call ends.
    expect(Date.now()).toBeLessThan(reserveAt + 500);
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toBe(1);
    expect(client.suspendInputs).toEqual([{ microvmIdentifier: "mvm-1" }]);
    expect(
      warnings.filter((warning) => warning.startsWith(SUSPEND_WARNING_PREFIX)),
    ).toHaveLength(1);
  });

  it.each<["succeeds" | "fails", unknown]>([
    ["succeeds", 1],
    ["fails", "MicrovmJobFailedError"],
  ])(
    "keeps the job's outcome when the job %s and the remaining-time reader throws before SuspendMicrovm, and logs one warning",
    async (outcome, expected) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
      const warnings: string[] = [];
      // The reader works for the delivery. It throws once the job's result
      // is sent, as when a replay makes the suspend the first read.
      let readerThrows = false;
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) => {
            (
              context.lambdaContext as {
                getRemainingTimeInMillis: () => number;
              }
            ).getRemainingTimeInMillis = () => {
              if (readerThrows) {
                throw new Error("deadline reader failed");
              }
              return 3_600_000;
            };
            context.configureLogger({
              customLogger: recordingLogger(warnings),
            });
            return microvmSession(
              context,
              "pipeline",
              {
                ...baseConfig(client),
                timeout: { hours: 1 },
                fetch: endpoint.fetch,
              },
              async (vm, ctx) => {
                try {
                  return await vm.invoke(
                    ctx,
                    "build",
                    1,
                    job("/build", { suspendAfter: true }),
                  );
                } catch (error) {
                  return (error as Error).name;
                }
              },
            );
          },
        ),
      }) as Runner;

      const executionPromise = runner.run({ payload: {} });
      const callback = runner.getOperation("build.callback");
      await callback.waitForData(WaitingOperationStatus.STARTED);
      await runner
        .getOperation("build.request")
        .waitForData(WaitingOperationStatus.COMPLETED);
      readerThrows = true;
      if (outcome === "succeeds") {
        await callback.sendCallbackSuccess(JSON.stringify(1));
      } else {
        await callback.sendCallbackFailure({
          ErrorType: "BuildError",
          ErrorMessage: "3 tests failed",
        });
      }
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe(expected);
      // The reader threw before the call, so no call was sent.
      expect(client.suspendInputs).toHaveLength(0);
      expect(
        warnings.filter((warning) =>
          warning.startsWith(SUSPEND_WARNING_PREFIX),
        ),
      ).toHaveLength(1);
    },
  );

  it("logs a warning and still returns the job's result when SuspendMicrovm fails, and the next job checks the state", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
    const denied = new LambdaMicrovmsServiceException({
      name: "AccessDeniedException",
      $fault: "client",
      $metadata: { httpStatusCode: 403, requestId: "req-9" },
      message: "not authorized: SuspendMicrovm",
    });
    client.suspendResponses = [throwing(denied)];
    const warnings: string[] = [];
    const warningData: unknown[] = [];
    const runner = runnerFor(
      client,
      endpoint,
      suspendThenJob,
      {},
      warnings,
      warningData,
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    await complete(runner, "test", 2);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([1, 2]);
    expect(
      warnings.filter((warning) => warning.startsWith(SUSPEND_WARNING_PREFIX)),
    ).toHaveLength(1);
    // The logged error is the service error, with the request ID text.
    expect(warningData).toEqual([
      {
        error: expect.objectContaining({
          name: "AccessDeniedException",
          message:
            "not authorized: SuspendMicrovm. SuspendMicrovm request ID: req-9.",
        }),
      },
    ]);
    // The failed call may still have suspended the MicroVM. So the next job
    // checks the state. It finds RUNNING here, and does not resume.
    expect(client.events).toEqual([
      "request:/build",
      "suspend",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it("makes no state check before jobs that precede the suspendAfter job", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = recordingEndpoint(client);
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
    // Neither the setup job nor the suspendAfter job checks the state. Only
    // the job after the suspend does.
    expect(client.events).toEqual([
      "request:/setup",
      "request:/build",
      "suspend",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/test",
      "terminate",
    ]);
  });

  it.each<[string, unknown]>([
    ["a number", 1],
    ["a string", "yes"],
    ["null", null],
  ])(
    "rejects a suspendAfter that is %s inside the handler, before any job operation",
    async (_label, suspendAfter) => {
      const client = new FakeMicrovmsClient();
      const endpoint = recordingEndpoint(client);
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

describe("the job request fields", () => {
  it("fit in the margin of MAX_JOB_INPUT_BYTES", () => {
    // The largest fixed fields: a MicroVM ID of 256 characters that JSON
    // writes as 6-byte escapes, a callback ID of 1,024 characters, and an
    // 8-hour heartbeat timeout.
    const fields = {
      version: 1,
      region: "ap-southeast-5",
      microvmId: "\u0001".repeat(256),
      callbackId: "A".repeat(1_024),
      heartbeatTimeoutSeconds: 28_800,
    };
    const body = withJsonMember(fields, "input", "null");
    const fixedBytes = Buffer.byteLength(body) - "null".length;

    expect(fixedBytes).toBeLessThan(6 * 1024 * 1024 - MAX_JOB_INPUT_BYTES);
  });
});
