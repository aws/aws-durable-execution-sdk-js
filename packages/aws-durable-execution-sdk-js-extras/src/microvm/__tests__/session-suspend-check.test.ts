// The check after a sign of a suspended MicroVM, for a session job without
// the resume mode. The sign is an HTTP 502 with `x-aws-proxy-error:
// MICROVM_CONNECT_FAILED`, or a request without an answer.
import {
  type DurableContext,
  type DurableLogger,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { AccessDeniedException } from "@aws-sdk/client-lambda-microvms";
import {
  MicrovmDeliveryError,
  type MicrovmInvokeOptions,
  MicrovmNotRunningError,
  type MicrovmSessionConfig,
  type MicrovmSessionHandler,
  microvm,
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

const STATE_CHECK_WARNING =
  "GetMicrovm failed, so the operation could not check whether the MicroVM is suspended. The request step keeps sending the job.";
const GET_DENIED_NOTE =
  "GetMicrovm was denied, so the operation could not check whether the MicroVM is suspended.";

/** The answer of the endpoint of a suspending or suspended MicroVM. */
const connectFailed = (): Response =>
  new Response(null, {
    status: 502,
    headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
  });

const noRetry = () => ({ shouldRetry: false });

const job = (
  path: string,
  options: Partial<MicrovmInvokeOptions> = {},
): MicrovmInvokeOptions => ({ path, timeout: { minutes: 10 }, ...options });

/**
 * An endpoint that records each request in the client's event list. While
 * the client's MicroVM is not RUNNING, it answers 502 with
 * MICROVM_CONNECT_FAILED. A queued answer is used first.
 */
function suspendableEndpoint(client: FakeMicrovmsClient): FakeEndpoint {
  const endpoint = new FakeEndpoint();
  const deliver = endpoint.fetch;
  (endpoint as { fetch: typeof fetch }).fetch = (async (
    url: string,
    init: RequestInit,
  ) => {
    client.events.push(`request:${new URL(url).pathname}`);
    if (endpoint.responses.length === 0 && client.microvmState !== "RUNNING") {
      endpoint.responses.push(connectFailed());
    }
    return deliver(url, init);
  }) as unknown as typeof fetch;
  return endpoint;
}

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

const oneJob =
  (
    options: Partial<MicrovmInvokeOptions> = {},
  ): MicrovmSessionHandler<unknown> =>
  async (vm, ctx) =>
    vm.invoke(ctx, "build", 1, job("/build", options));

describe("a session job without the resume mode", () => {
  it("resumes a suspended MicroVM after a 502 with MICROVM_CONNECT_FAILED, and sends the job again", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = suspendableEndpoint(client);
    const runner = runnerFor(client, endpoint, oneJob());

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/build",
      "terminate",
    ]);
  });

  it("resumes a suspending MicroVM after a request without an answer", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = suspendableEndpoint(client);
    endpoint.responses = [new TypeError("fetch failed")];
    client.getResponses = [
      async () => ({ state: "SUSPENDING" }),
      async () => ({ state: "RUNNING", endpoint: "resumed.example" }),
    ];
    const runner = runnerFor(client, endpoint, oneJob());

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDING",
      "resume",
      "get:RUNNING",
      "request:/build",
      "terminate",
    ]);
    expect(endpoint.requests[1].url).toBe("https://resumed.example/build");
  });

  it("resumes again after a conflict during SUSPENDING, once the MicroVM is SUSPENDED", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = suspendableEndpoint(client);
    endpoint.responses = [new TypeError("fetch failed")];
    // The MicroVM stays SUSPENDED until a resume is accepted.
    client.microvmState = "SUSPENDED";
    client.getResponses = [async () => ({ state: "SUSPENDING" })];
    client.resumeResponses = [
      throwing(Object.assign(new Error("busy"), { name: "ConflictException" })),
    ];
    const runner = runnerFor(
      client,
      endpoint,
      oneJob({ retryWindow: { seconds: 5 } }),
    );

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDING",
      "resume",
      "get:SUSPENDED",
      "resume",
      "get:RUNNING",
      "request:/build",
      "terminate",
    ]);
  });

  it.each([502, 503, 504])(
    "makes no GetMicrovm call after a plain %i",
    async (status) => {
      const client = new FakeMicrovmsClient();
      const endpoint = suspendableEndpoint(client);
      endpoint.responses = [status, status];
      const runner = runnerFor(client, endpoint, oneJob());

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "build", 1);
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(client.events).toEqual([
        "request:/build",
        "request:/build",
        "request:/build",
        "terminate",
      ]);
    },
  );

  it("logs one warning for a denied GetMicrovm, keeps sending the job, and names the denial in the final error", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = suspendableEndpoint(client);
    const denied = () =>
      new AccessDeniedException({
        message: "not authorized: GetMicrovm",
        $metadata: { httpStatusCode: 403, requestId: "req-1" },
      });
    client.getResponses = [throwing(denied()), throwing(denied())];
    const warnings: string[] = [];
    // A 4-second window checks after the first request, and again after
    // the request at 3.75 seconds.
    const runner = runnerFor(
      client,
      endpoint,
      oneJob({ retryWindow: { seconds: 4 } }),
      { retryStrategy: noRetry },
      warnings,
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmDeliveryError.name);
    expect(error?.errorMessage).toMatch(
      new RegExp(`Last failure: HTTP 502\\. ${GET_DENIED_NOTE}$`),
    );
    expect(client.events.filter((e) => e === "request:/build")).toHaveLength(5);
    expect(client.getResponses).toHaveLength(0);
    expect(client.events).not.toContain("resume");
    expect(warnings.filter((w) => w === STATE_CHECK_WARNING)).toHaveLength(1);
  });

  it("logs one warning per job for a GetMicrovm that fails otherwise, without the denial note", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = suspendableEndpoint(client);
    const throttled = () =>
      Object.assign(new Error("slow down"), { name: "ThrottlingException" });
    client.getResponses = [throwing(throttled()), throwing(throttled())];
    const warnings: string[] = [];
    const messages: string[] = [];
    const runner = runnerFor(
      client,
      endpoint,
      async (vm, ctx) => {
        for (const name of ["build", "test"]) {
          try {
            await vm.invoke(
              ctx,
              name,
              1,
              job(`/${name}`, { retryWindow: { seconds: 1 } }),
            );
          } catch (error) {
            messages.push((error as Error).message);
          }
        }
        return "done";
      },
      { retryStrategy: noRetry },
      warnings,
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toMatch(/Last failure: HTTP 502\.$/);
    }
    expect(warnings.filter((w) => w === STATE_CHECK_WARNING)).toHaveLength(2);
  });

  it("fails the job at once with MicrovmDeliveryError when ResumeMicrovm is denied for a suspended MicroVM", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = suspendableEndpoint(client);
    client.resumeResponses = [
      throwing(
        new AccessDeniedException({
          message: "not authorized: ResumeMicrovm",
          $metadata: { httpStatusCode: 403, requestId: "req-2" },
        }),
      ),
    ];
    // The default retry strategy does not retry the error.
    const runner = runnerFor(client, endpoint, oneJob());

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmDeliveryError.name);
    expect(error?.errorMessage).toContain(
      "MicroVM mvm-1 is SUSPENDED. ResumeMicrovm was denied, so the operation cannot resume it. The function's execution role needs lambda:ResumeMicrovm. ResumeMicrovm request ID: req-2.",
    );
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDED",
      "resume",
      "terminate",
    ]);
  });

  it.each(["TERMINATING", "TERMINATED"])(
    "fails the job with MicrovmNotRunningError when the check finds the MicroVM %s",
    async (state) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = state;
      const endpoint = suspendableEndpoint(client);
      const runner = runnerFor(client, endpoint, oneJob());

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      const error = execution.getError();
      expect(error?.errorType).toBe(MicrovmNotRunningError.name);
      expect(error?.errorMessage).toContain(`MicroVM mvm-1 is ${state}.`);
      expect(client.events).toEqual([
        "request:/build",
        `get:${state}`,
        "terminate",
      ]);
    },
  );
});

describe("microvm over HTTP", () => {
  it("makes no GetMicrovm call after a 502 with MICROVM_CONNECT_FAILED", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (event: unknown, context: DurableContext) =>
          microvm(context, "build", event, {
            ...baseConfig(client),
            fetch: endpoint.fetch,
            request: { path: "/build" },
          }),
      ),
    }) as Runner;

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", "done");
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(endpoint.requests).toHaveLength(2);
    expect(client.events).toEqual(["terminate"]);
  });
});
