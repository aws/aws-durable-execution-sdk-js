// The check after a sign that the MicroVM does not run, for a session job.
// The sign is an HTTP 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED`,
// or a request without an answer.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  microvmSession,
} from "..";
import {
  autoResumingEndpoint,
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
  "GetMicrovm failed, so the operation could not check whether the MicroVM has ended. The request step keeps sending the job.";

const noRetry = () => ({ shouldRetry: false });

const job = (
  path: string,
  options: Partial<MicrovmInvokeOptions> = {},
): MicrovmInvokeOptions => ({ path, timeout: { minutes: 10 }, ...options });

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

describe("a session job after a sign that the MicroVM does not run", () => {
  it("keeps sending the job to a suspended MicroVM after a 502 with MICROVM_CONNECT_FAILED, and makes no ResumeMicrovm call", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = autoResumingEndpoint(client);
    const runner = runnerFor(client, endpoint, oneJob());

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    // The service resumes the MicroVM on the request after the check.
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDED",
      "request:/build",
      "auto-resume",
      "terminate",
    ]);
  });

  it("sends the job to the endpoint that the check reports, after a request without an answer", async () => {
    const client = new FakeMicrovmsClient();
    const endpoint = autoResumingEndpoint(client);
    endpoint.responses = [new TypeError("fetch failed")];
    client.getResponses = [
      async () => ({ state: "SUSPENDING", endpoint: "other.example" }),
    ];
    const runner = runnerFor(client, endpoint, oneJob());

    const executionPromise = runner.run({ payload: {} });
    await complete(runner, "build", 1);
    const execution = await executionPromise;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(client.events).toEqual([
      "request:/build",
      "get:SUSPENDING",
      "request:/build",
      "terminate",
    ]);
    expect(endpoint.requests[1].url).toBe("https://other.example/build");
  });

  it("fails with MicrovmDeliveryError after the retries, and makes no ResumeMicrovm call, when the service does not resume the MicroVM", async () => {
    // A MicroVM launched without `autoResumeEnabled` stays SUSPENDED, and
    // its endpoint answers the 502 to every request.
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = autoResumingEndpoint(client, Number.POSITIVE_INFINITY);
    const runner = runnerFor(
      client,
      endpoint,
      oneJob({ retryWindow: { seconds: 1 } }),
      { retryStrategy: noRetry },
    );

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmDeliveryError.name);
    expect(error?.errorMessage).toMatch(/Last failure: HTTP 502\.$/);
    expect(client.events).not.toContain("resume");
    expect(client.events.filter((e) => e === "get:SUSPENDED")).toHaveLength(1);
    expect(client.microvmState).toBe("SUSPENDED");
  });

  it.each([502, 503, 504])(
    "makes no GetMicrovm call after a plain %i",
    async (status) => {
      const client = new FakeMicrovmsClient();
      const endpoint = autoResumingEndpoint(client);
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

  it("fails the job at once with MicrovmDeliveryError that names lambda:GetMicrovm when GetMicrovm is denied", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = autoResumingEndpoint(client);
    client.getResponses = [
      throwing(
        new AccessDeniedException({
          message: "not authorized: GetMicrovm",
          $metadata: { httpStatusCode: 403, requestId: "req-1" },
        }),
      ),
    ];
    const warnings: string[] = [];
    // The default retry strategy does not retry the error.
    const runner = runnerFor(client, endpoint, oneJob(), {}, warnings);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmDeliveryError.name);
    expect(error?.errorMessage).toContain(
      "GetMicrovm was denied, so the operation cannot check its state. The function's execution role needs lambda:GetMicrovm. GetMicrovm request ID: req-1.",
    );
    const step = runner.getOperation("build.request").getStepDetails();
    expect(step?.error?.errorType).toBe("MicrovmPermissionDeniedError");
    expect(step?.attempt).toBe(1);
    expect(client.events).toEqual(["request:/build", "terminate"]);
    expect(warnings).not.toContain(STATE_CHECK_WARNING);
  });

  it("logs one warning per step attempt for a throttled GetMicrovm, and keeps sending the job", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "SUSPENDED";
    const endpoint = autoResumingEndpoint(client, Number.POSITIVE_INFINITY);
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

  it.each(["TERMINATING", "TERMINATED"])(
    "fails the job with MicrovmNotRunningError when the check finds the MicroVM %s",
    async (state) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = state;
      const endpoint = autoResumingEndpoint(client);
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
