// The state check of a microvm() job over HTTP. After an HTTP 502 with
// `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, or a request without an
// answer, the request step calls GetMicrovm after each such answer, at most
// once per 2 seconds. The endpoint of a terminated MicroVM answers that 502,
// measured in us-east-1. So a MicroVM that ended fails the job at once,
// instead of after both retry tiers.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
  AccessDeniedException,
  InternalServerException,
  ResourceNotFoundException,
  ThrottlingException,
} from "@aws-sdk/client-lambda-microvms";
import {
  MicrovmDeliveryError,
  MicrovmNotRunningError,
  type MicrovmConfig,
  microvm,
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
  "GetMicrovm failed, so the operation could not check whether the MicroVM has ended. The request step keeps sending the job.";

/** The answer of the endpoint of a terminated MicroVM, measured live. */
const connectFailed = (): Response =>
  new Response(null, {
    status: 502,
    headers: { "x-aws-proxy-error": "MICROVM_CONNECT_FAILED" },
  });

const noRetry = () => ({ shouldRetry: false });

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
  overrides: Partial<MicrovmConfig> = {},
  warnings: string[] = [],
): Runner {
  return new LocalDurableTestRunner({
    handlerFunction: withDurableExecution(
      async (event: unknown, context: DurableContext) => {
        context.configureLogger({ customLogger: recordingLogger(warnings) });
        return microvm(context, "build", event, {
          ...baseConfig(client),
          fetch: endpoint.fetch,
          request: { path: "/build" },
          ...overrides,
        });
      },
    ),
  }) as Runner;
}

async function complete(runner: Runner, result: unknown): Promise<void> {
  const callback = runner.getOperation("build.callback");
  await callback.waitForData(WaitingOperationStatus.STARTED);
  await runner
    .getOperation("build.request")
    .waitForData(WaitingOperationStatus.COMPLETED);
  await callback.sendCallbackSuccess(JSON.stringify(result));
}

describe("microvm over HTTP, after a sign that the MicroVM does not run", () => {
  it("fails at once with MicrovmNotRunningError when GetMicrovm reports TERMINATED after a 502 with MICROVM_CONNECT_FAILED", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      async () => ({
        microvmId: "mvm-1",
        state: "TERMINATED",
        stateReason: "Internal service error",
        $metadata: { requestId: "get-req-1" },
      }),
    ];
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    // The default retry strategy: MicrovmNotRunningError is not retried.
    const runner = runnerFor(client, endpoint);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmNotRunningError.name);
    expect(error?.errorMessage).toContain(
      "MicroVM mvm-1 is TERMINATED: Internal service error. GetMicrovm request ID: get-req-1.",
    );
    expect(endpoint.requests).toHaveLength(1);
    expect(client.events).toEqual(["get:TERMINATED", "terminate"]);
  });

  it.each<[string, () => Response | Error]>([
    ["a 502 with MICROVM_CONNECT_FAILED", connectFailed],
    ["no answer", () => new TypeError("fetch failed")],
  ])(
    "fails with MicrovmNotRunningError after one GetMicrovm call when %s takes 3 seconds and the retry window is 1 second",
    async (_label, answer) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = "TERMINATED";
      const endpoint = new FakeEndpoint();
      endpoint.responses = [answer()];
      // The answer of a dead endpoint can take 3 to 8 seconds, measured
      // live. The fake clock moves 3 seconds during the request, so the
      // request uses up the window.
      const realNow = Date.now.bind(Date);
      let offsetMs = 0;
      const now = vi
        .spyOn(Date, "now")
        .mockImplementation(() => realNow() + offsetMs);
      const slow: typeof fetch = async (url, init) => {
        offsetMs += 3_000;
        return endpoint.fetch(url, init);
      };
      // One step attempt. So the test shows what one attempt does.
      const runner = runnerFor(client, endpoint, {
        fetch: slow,
        retryStrategy: noRetry,
        request: { path: "/build", retryWindow: { seconds: 1 } },
      });

      try {
        const execution = await runner.run({ payload: {} });

        expect(execution.getStatus()).toBe("FAILED");
        expect(execution.getError()?.errorType).toBe(
          MicrovmNotRunningError.name,
        );
        expect(endpoint.requests).toHaveLength(1);
        expect(client.events).toEqual(["get:TERMINATED", "terminate"]);
      } finally {
        now.mockRestore();
      }
    },
  );

  it("removes one trailing period of stateReason, so the message has no double period", async () => {
    const client = new FakeMicrovmsClient();
    // The service's stateReason after a TerminateMicrovm call, measured live.
    client.getResponses = [
      async () => ({
        microvmId: "mvm-1",
        state: "TERMINATED",
        stateReason: "Success.",
        $metadata: { requestId: "get-req-3" },
      }),
    ];
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const runner = runnerFor(client, endpoint);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmNotRunningError.name);
    expect(error?.errorMessage).toContain(
      "MicroVM mvm-1 is TERMINATED: Success. GetMicrovm request ID: get-req-3.",
    );
  });

  it("fails at once with MicrovmNotRunningError when GetMicrovm reports TERMINATING after a request without an answer", async () => {
    const client = new FakeMicrovmsClient();
    client.microvmState = "TERMINATING";
    const endpoint = new FakeEndpoint();
    endpoint.responses = [new TypeError("fetch failed")];
    const runner = runnerFor(client, endpoint);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmNotRunningError.name);
    expect(error?.errorMessage).toContain("MicroVM mvm-1 is TERMINATING.");
    expect(endpoint.requests).toHaveLength(1);
    expect(client.events).toEqual(["get:TERMINATING", "terminate"]);
  });

  it("fails at once with MicrovmNotRunningError when GetMicrovm reports ResourceNotFoundException", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      throwing(
        new ResourceNotFoundException({
          message: "MicroVM not found",
          $metadata: { httpStatusCode: 404, requestId: "get-req-2" },
        }),
      ),
    ];
    const endpoint = new FakeEndpoint();
    endpoint.responses = [connectFailed()];
    const runner = runnerFor(client, endpoint);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmNotRunningError.name);
    expect(error?.errorMessage).toContain("MicroVM mvm-1 no longer exists.");
    expect(error?.errorMessage).toContain("GetMicrovm request ID: get-req-2.");
    expect(endpoint.requests).toHaveLength(1);
    expect(client.events).toEqual(["terminate"]);
  });

  it.each(["RUNNING", "PENDING"])(
    "keeps sending the job when GetMicrovm reports %s",
    async (state) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = state;
      const endpoint = new FakeEndpoint();
      endpoint.responses = [connectFailed()];
      const runner = runnerFor(client, endpoint);

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "done");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(endpoint.requests).toHaveLength(2);
      expect(client.events).toEqual([`get:${state}`, "terminate"]);
    },
  );

  it("fails at once with MicrovmDeliveryError that names lambda:GetMicrovm when GetMicrovm is denied", async () => {
    const client = new FakeMicrovmsClient();
    client.getResponses = [
      throwing(
        new AccessDeniedException({
          message: "not authorized: GetMicrovm",
          $metadata: { httpStatusCode: 403, requestId: "get-req-9" },
        }),
      ),
    ];
    const endpoint = new FakeEndpoint();
    endpoint.responses = Array.from({ length: 10 }, connectFailed);
    const warnings: string[] = [];
    // The default retry strategy does not retry the error.
    const runner = runnerFor(client, endpoint, {}, warnings);

    const execution = await runner.run({ payload: {} });

    expect(execution.getStatus()).toBe("FAILED");
    const error = execution.getError();
    expect(error?.errorType).toBe(MicrovmDeliveryError.name);
    expect(error?.errorMessage).toContain(
      "GetMicrovm was denied, so the operation cannot check its state. The function's execution role needs lambda:GetMicrovm. GetMicrovm request ID: get-req-9.",
    );
    const step = runner.getOperation("build.request").getStepDetails();
    expect(step?.error?.errorType).toBe("MicrovmPermissionDeniedError");
    expect(step?.attempt).toBe(1);
    expect(endpoint.requests).toHaveLength(1);
    expect(client.events).toEqual(["terminate"]);
    expect(warnings).not.toContain(STATE_CHECK_WARNING);
  });

  it.each([
    [
      "is throttled",
      () =>
        new ThrottlingException({
          message: "Rate exceeded",
          $metadata: { httpStatusCode: 429, requestId: "get-req-1" },
        }),
    ],
    [
      "fails with a 5xx",
      () =>
        new InternalServerException({
          message: "internal error",
          $metadata: { httpStatusCode: 500, requestId: "get-req-1" },
        }),
    ],
  ])(
    "logs one warning and keeps sending the job when GetMicrovm %s",
    async (_label, failure) => {
      const client = new FakeMicrovmsClient();
      client.getResponses = [throwing(failure()), throwing(failure())];
      const endpoint = new FakeEndpoint();
      endpoint.responses = Array.from({ length: 10 }, connectFailed);
      const warnings: string[] = [];
      // A 4-second window checks after the first request, and again after
      // the request at 3.75 seconds.
      const runner = runnerFor(
        client,
        endpoint,
        {
          retryStrategy: noRetry,
          request: { path: "/build", retryWindow: { seconds: 4 } },
        },
        warnings,
      );

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      const error = execution.getError();
      expect(error?.errorType).toBe(MicrovmDeliveryError.name);
      expect(error?.errorMessage).toMatch(/Last failure: HTTP 502\.$/);
      expect(endpoint.requests).toHaveLength(5);
      expect(client.getResponses).toHaveLength(0);
      expect(warnings.filter((w) => w === STATE_CHECK_WARNING)).toHaveLength(1);
    },
  );

  it.each(["SUSPENDED", "SUSPENDING"])(
    "keeps sending the job to a %s MicroVM without a ResumeMicrovm call, and the job succeeds",
    async (state) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = state;
      const endpoint = new FakeEndpoint();
      // The endpoint answers the 502 for about 5 seconds after a suspend.
      // The service then resumes the MicroVM on the next request.
      endpoint.responses = [connectFailed(), connectFailed()];
      const runner = runnerFor(client, endpoint);

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "done");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toBe("done");
      expect(endpoint.requests).toHaveLength(3);
      // The second 502 comes 250 milliseconds after the check. So it gets
      // no check of its own.
      expect(client.events).toEqual([`get:${state}`, "terminate"]);
    },
  );

  it.each([
    [
      "GetMicrovm",
      (client: FakeMicrovmsClient) => {
        client.getResponses = [
          throwing(
            new AccessDeniedException({
              message: "denied",
              $metadata: { httpStatusCode: 403, requestId: "req-1" },
            }),
          ),
        ];
      },
    ],
  ])(
    "gives a custom retry strategy MicrovmPermissionDeniedError when %s is denied",
    async (action, deny) => {
      const client = new FakeMicrovmsClient();
      deny(client);
      const endpoint = new FakeEndpoint();
      endpoint.responses = [connectFailed()];
      const seen: string[] = [];
      const runner = runnerFor(client, endpoint, {
        retryStrategy: (error: Error) => {
          seen.push(error.name);
          return { shouldRetry: false };
        },
      });

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      expect(execution.getError()?.errorMessage).toContain(
        `${action} was denied`,
      );
      expect(execution.getError()?.errorMessage).toContain(
        `The function's execution role needs lambda:${action}. ${action} request ID: req-1.`,
      );
      expect(seen).toEqual(["MicrovmPermissionDeniedError"]);
    },
  );

  it.each([500, 503])(
    "makes no GetMicrovm call after a plain %i, because the worker answered",
    async (status) => {
      const client = new FakeMicrovmsClient();
      const endpoint = new FakeEndpoint();
      endpoint.responses = [status];
      const runner = runnerFor(client, endpoint);

      const executionPromise = runner.run({ payload: {} });
      await complete(runner, "done");
      const execution = await executionPromise;

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(endpoint.requests).toHaveLength(2);
      expect(client.events).toEqual(["terminate"]);
    },
  );

  it.each([400, 404])(
    "fails with MicrovmDeliveryError after a %i, without a GetMicrovm call",
    async (status) => {
      const client = new FakeMicrovmsClient();
      client.microvmState = "TERMINATED";
      const endpoint = new FakeEndpoint();
      endpoint.responses = [status];
      const runner = runnerFor(client, endpoint);

      const execution = await runner.run({ payload: {} });

      expect(execution.getStatus()).toBe("FAILED");
      const error = execution.getError();
      expect(error?.errorType).toBe(MicrovmDeliveryError.name);
      expect(error?.errorMessage).toContain(
        `The MicroVM rejected the job at /build with HTTP ${status}`,
      );
      expect(endpoint.requests).toHaveLength(1);
      expect(client.events).toEqual(["terminate"]);
    },
  );
});
