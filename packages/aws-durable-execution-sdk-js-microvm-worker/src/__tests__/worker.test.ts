import { getEventListeners } from "node:events";
import { Readable } from "node:stream";
import {
  CallbackTimeoutException,
  LambdaClient,
  LambdaServiceException,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
  TooManyRequestsException,
} from "@aws-sdk/client-lambda";
import {
  CallbackReporter,
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  InvalidRunHookPayloadError,
  MAX_CALLBACK_RESULT_BYTES,
  MICROVM_JOB_PATH,
  type MicrovmJobHandler,
  type MicrovmWorker,
  type MicrovmWorkerListener,
  type MicrovmWorkerLogger,
  type MicrovmWorkerOptions,
  parseJobRequest,
  parseRunHookRequest,
  ResultSerializationError,
  ResultTooLargeError,
  startMicrovmWorker,
} from "..";
import {
  heartbeatDelayMs,
  heartbeatIntervalMs,
  heartbeatRetryDelayMs,
  jitterSource,
  startHeartbeats,
} from "../worker";

type Sent =
  | { kind: "heartbeat"; callbackId: string }
  | { kind: "success"; callbackId: string; result: unknown }
  | { kind: "failure"; callbackId: string; error: Record<string, unknown> };

/** Records callback API calls. `failures` answers the next calls with errors. */
class FakeLambdaClient {
  readonly sent: Sent[] = [];
  failures: Error[] = [];
  heartbeatFailures: Error[] = [];

  async send(command: unknown): Promise<unknown> {
    if (command instanceof SendDurableExecutionCallbackHeartbeatCommand) {
      const failure = this.heartbeatFailures.shift();
      if (failure) {
        throw failure;
      }
      this.sent.push({
        kind: "heartbeat",
        callbackId: command.input.CallbackId as string,
      });
      return {};
    }
    const failure = this.failures.shift();
    if (failure) {
      throw failure;
    }
    if (command instanceof SendDurableExecutionCallbackSuccessCommand) {
      const bytes = command.input.Result;
      this.sent.push({
        kind: "success",
        callbackId: command.input.CallbackId as string,
        result:
          bytes === undefined
            ? undefined
            : JSON.parse(Buffer.from(bytes as Uint8Array).toString("utf8")),
      });
      return {};
    }
    if (command instanceof SendDurableExecutionCallbackFailureCommand) {
      this.sent.push({
        kind: "failure",
        callbackId: command.input.CallbackId as string,
        error: command.input.Error as Record<string, unknown>,
      });
      return {};
    }
    throw new Error("unexpected command");
  }

  asClient(): LambdaClient {
    return this as unknown as LambdaClient;
  }

  completions(): Sent[] {
    return this.sent.filter((s) => s.kind !== "heartbeat");
  }
}

const silentLogger: MicrovmWorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const metadata = { $metadata: {} };
const noSleep = async (): Promise<void> => {};

const runBody = (
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  microvmId: "mvm-1",
  runHookPayload: JSON.stringify(payload),
});

const validJob = (overrides: Record<string, unknown> = {}) => ({
  callbackId: "cb-1",
  input: { repo: "org/app" },
  ...overrides,
});

/** A run hook payload that delivers one job. */
const validPayload = (jobOverrides: Record<string, unknown> = {}) => ({
  version: 1,
  region: "us-east-1",
  job: validJob(jobOverrides),
});

describe("parseRunHookRequest", () => {
  it("returns the MicroVM ID and the decoded payload", () => {
    expect(parseRunHookRequest(runBody(validPayload()))).toEqual({
      microvmId: "mvm-1",
      payload: validPayload(),
    });
  });

  it("accepts a payload without a job", () => {
    const payload = { version: 1, region: "us-east-1" };
    expect(parseRunHookRequest(runBody(payload)).payload).toEqual(payload);
  });

  it("returns no payload when the body has no runHookPayload", () => {
    expect(parseRunHookRequest({ microvmId: "mvm-1" })).toEqual({
      microvmId: "mvm-1",
    });
  });

  it.each<[string, unknown, string]>([
    ["a non-object body", "text", "microvmId"],
    ["an empty microvmId", { microvmId: "" }, "non-empty string microvmId"],
    [
      "a payload that is not JSON",
      { microvmId: "mvm-1", runHookPayload: "{" },
      "not valid JSON",
    ],
    [
      "a job without callbackId",
      runBody({ version: 1, region: "us-east-1", job: { input: 1 } }),
      "callbackId",
    ],
  ])("rejects %s without a callback ID", (_label, body, message) => {
    let error: unknown;
    try {
      parseRunHookRequest(body);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidRunHookPayloadError);
    expect((error as Error).message).toContain(message);
    expect((error as InvalidRunHookPayloadError).callbackId).toBeUndefined();
  });

  it("keeps the parser's error as the cause of a payload that is not JSON", () => {
    let error: unknown;
    try {
      parseRunHookRequest({
        microvmId: "mvm-1",
        runHookPayload:
          '{"version": 1, "region": "us-east-1", "job": {"callbackId": "x" "input": 1}}',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidRunHookPayloadError);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(SyntaxError);
    // Node's parser names where the payload went wrong.
    expect((cause as Error).message).toContain("position 64");
  });

  it("keeps the job's callback ID and Region when the MicroVM ID is empty", () => {
    let error: unknown;
    try {
      parseRunHookRequest({ ...runBody(validPayload()), microvmId: "" });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain("non-empty string microvmId");
    expect((error as InvalidRunHookPayloadError).callbackId).toBe("cb-1");
    expect((error as InvalidRunHookPayloadError).region).toBe("us-east-1");
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "an unknown version",
      { ...validPayload(), version: 2 },
      "version 2 is not supported",
    ],
    ["an empty region", { ...validPayload(), region: "" }, "non-empty region"],
    [
      "a non-positive heartbeat timeout",
      validPayload({ heartbeatTimeoutSeconds: 0 }),
      "heartbeatTimeoutSeconds",
    ],
    [
      "a heartbeat timeout under 1 second",
      validPayload({ heartbeatTimeoutSeconds: 0.5 }),
      "heartbeatTimeoutSeconds",
    ],
    [
      "an idle time longer than a MicroVM lives",
      { ...validPayload(), autoSuspendIdleSeconds: 8 * 60 * 60 + 1 },
      "autoSuspendIdleSeconds",
    ],
  ])(
    "rejects %s and keeps the job's callback ID",
    (_label, payload, message) => {
      let error: unknown;
      try {
        parseRunHookRequest(runBody(payload));
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toContain(message);
      expect((error as InvalidRunHookPayloadError).callbackId).toBe("cb-1");
    },
  );
});

describe("parseJobRequest", () => {
  it("returns a valid job request", () => {
    const body = { version: 1, region: "us-east-1", ...validJob() };
    expect(parseJobRequest(body)).toEqual(body);
  });

  it("returns a job request with a MicroVM ID", () => {
    const body = {
      version: 1,
      region: "us-east-1",
      microvmId: "mvm-1",
      ...validJob(),
    };
    expect(parseJobRequest(body)).toEqual(body);
  });

  it.each(["", 5, null])(
    "rejects a job request with microvmId %p and keeps the callback ID",
    (microvmId) => {
      let error: unknown;
      try {
        parseJobRequest({
          version: 1,
          region: "us-east-1",
          microvmId,
          ...validJob(),
        });
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toContain("microvmId");
      expect((error as InvalidRunHookPayloadError).callbackId).toBe("cb-1");
      expect((error as InvalidRunHookPayloadError).region).toBe("us-east-1");
    },
  );

  it("rejects an unknown version and keeps the callback ID", () => {
    let error: unknown;
    try {
      parseJobRequest({ version: 3, region: "us-east-1", ...validJob() });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain("version 3 is not supported");
    expect((error as InvalidRunHookPayloadError).callbackId).toBe("cb-1");
    expect((error as InvalidRunHookPayloadError).region).toBe("us-east-1");
  });
});

describe("CallbackReporter", () => {
  const reporter = (client: FakeLambdaClient): CallbackReporter =>
    new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: client.asClient(),
      sleep: noSleep,
    });

  it("sends the result as JSON bytes", async () => {
    const client = new FakeLambdaClient();
    await reporter(client).succeed({ passed: true });
    expect(client.sent).toEqual([
      { kind: "success", callbackId: "cb-1", result: { passed: true } },
    ]);
  });

  it("sends no result for undefined", async () => {
    const client = new FakeLambdaClient();
    await reporter(client).succeed(undefined);
    expect(client.sent).toEqual([
      { kind: "success", callbackId: "cb-1", result: undefined },
    ]);
  });

  it("refuses a result over 256 KB without calling the service", async () => {
    const client = new FakeLambdaClient();
    await expect(
      reporter(client).succeed("x".repeat(MAX_CALLBACK_RESULT_BYTES)),
    ).rejects.toThrow(ResultTooLargeError);
    const error = await reporter(client)
      .succeed("x".repeat(MAX_CALLBACK_RESULT_BYTES))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).toMatchObject({
      name: "ResultTooLargeError",
      // The JSON string adds two quotes.
      bytes: MAX_CALLBACK_RESULT_BYTES + 2,
    });
    expect(client.sent).toHaveLength(0);
  });

  it("sends the error name and message, and no stack", async () => {
    const client = new FakeLambdaClient();
    const error = new TypeError("bad input");
    await reporter(client).fail(error);
    expect(client.sent).toEqual([
      {
        kind: "failure",
        callbackId: "cb-1",
        error: { ErrorType: "TypeError", ErrorMessage: "bad input" },
      },
    ]);
  });

  it("cuts a long error message and type", async () => {
    const client = new FakeLambdaClient();
    const error = Object.assign(new Error("m".repeat(20_000)), {
      name: "N".repeat(1_000),
    });
    await reporter(client).fail(error);
    const sent = client.sent[0] as { error: Record<string, string> };
    expect(sent.error.ErrorMessage).toHaveLength(8 * 1024);
    expect(sent.error.ErrorMessage.endsWith("...")).toBe(true);
    expect(sent.error.ErrorType).toHaveLength(256);
  });

  it("does not split a surrogate pair when it cuts a message", async () => {
    const client = new FakeLambdaClient();
    // The pair would straddle the cut at 8,189 code units.
    const message = `${"m".repeat(8 * 1024 - 4)}\u{1F600}${"m".repeat(100)}`;
    await reporter(client).fail(new Error(message));
    const sent = client.sent[0] as { error: Record<string, string> };
    expect(sent.error.ErrorMessage).toBe(`${"m".repeat(8 * 1024 - 4)}...`);
    // No high surrogate without its low half.
    expect(sent.error.ErrorMessage).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });

  it.each<[string, unknown]>([
    [
      "a cycle",
      (() => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      })(),
    ],
    ["a BigInt", { n: 1n }],
  ])(
    "refuses a result with %s without calling the service",
    async (_label, result) => {
      const client = new FakeLambdaClient();
      await expect(reporter(client).succeed(result)).rejects.toThrow(
        ResultSerializationError,
      );
      expect(client.sent).toHaveLength(0);
    },
  );

  it("retries a transient completion error", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      new TooManyRequestsException({ message: "slow", ...metadata }),
    ];
    await reporter(client).succeed("ok");
    expect(client.completions()).toHaveLength(1);
  });

  it("does not retry a terminal completion error", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      new CallbackTimeoutException({ message: "timed out", ...metadata }),
      new Error("must not be reached"),
    ];
    await expect(reporter(client).succeed("ok")).rejects.toThrow("timed out");
    expect(client.failures).toHaveLength(1);
  });

  it.each<[string, Error]>([
    [
      "an access-denied error",
      Object.assign(new Error("denied"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      }),
    ],
  ])("does not retry %s", async (_label, failure) => {
    const client = new FakeLambdaClient();
    client.failures = [failure, new Error("must not be reached")];
    await expect(reporter(client).succeed("ok")).rejects.toThrow(
      failure.message,
    );
    expect(client.failures).toHaveLength(1);
  });

  it.each<[string, Error]>([
    [
      "expired credentials",
      Object.assign(new Error("expired"), {
        name: "ExpiredTokenException",
        $metadata: { httpStatusCode: 403 },
      }),
    ],
    [
      "a credential endpoint that did not answer",
      Object.assign(
        new Error("Could not load credentials from any providers"),
        {
          name: "CredentialsProviderError",
        },
      ),
    ],
  ])(
    "retries %s, because the provider can recover",
    async (_label, failure) => {
      const client = new FakeLambdaClient();
      client.failures = [failure];
      await reporter(client).succeed("ok");
      expect(client.completions()).toHaveLength(1);
    },
  );

  it.each<[string, unknown, Record<string, string>]>([
    [
      "a value without toString",
      Object.create(null),
      { ErrorType: "Error", ErrorMessage: "unknown error" },
    ],
    [
      "an error whose message getter throws",
      Object.defineProperty(new Error("x"), "message", {
        get() {
          throw new Error("getter");
        },
      }),
      { ErrorType: "Error", ErrorMessage: "unknown error" },
    ],
    [
      "an error whose name getter throws",
      Object.defineProperty(new Error("boom"), "name", {
        get() {
          throw new Error("getter");
        },
      }),
      { ErrorType: "Error", ErrorMessage: "boom" },
    ],
    [
      "an error whose name is undefined",
      Object.assign(new Error("boom"), { name: undefined }),
      { ErrorType: "Error", ErrorMessage: "boom" },
    ],
    [
      "an error with an empty message",
      new Error(),
      { ErrorType: "Error", ErrorMessage: "" },
    ],
    [
      "a Proxy that makes instanceof throw",
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("trap");
          },
        },
      ),
      { ErrorType: "Error", ErrorMessage: "[object Object]" },
    ],
    [
      "an error with an empty name",
      Object.assign(new Error("boom"), { name: "" }),
      { ErrorType: "Error", ErrorMessage: "boom" },
    ],
  ])("reports %s", async (_label, error, expected) => {
    const client = new FakeLambdaClient();
    await reporter(client).fail(error);
    expect(client.sent).toEqual([
      { kind: "failure", callbackId: "cb-1", error: expected },
    ]);
  });

  it("ends a completion attempt that stalls after 30 seconds, and retries it", async () => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    try {
      let calls = 0;
      let firstSignal: AbortSignal | undefined;
      const send = jest.fn(
        (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
          calls++;
          if (calls === 1) {
            firstSignal = options?.abortSignal;
            // The first attempt reuses a dead connection and never answers.
            return new Promise(() => {});
          }
          return Promise.resolve({});
        },
      );
      const target = new CallbackReporter({
        callbackId: "cb-1",
        region: "us-east-1",
        client: { send } as unknown as LambdaClient,
        sleep: noSleep,
      });

      const done = target.succeed("ok");
      await jest.advanceTimersByTimeAsync(29_999);
      expect(send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await done;
      expect(send).toHaveBeenCalledTimes(2);
      // The attempt also passed an abort signal for its HTTP request.
      expect(firstSignal).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("treats 'already complete' after an attempt without an answer as delivered", async () => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    try {
      let calls = 0;
      const send = jest.fn(() => {
        calls++;
        return calls === 1
          ? new Promise(() => {})
          : Promise.reject(
              Object.assign(
                new Error(
                  "The callback is either timed out or already completed",
                ),
                {
                  name: "CallbackTimeoutException",
                  $metadata: { httpStatusCode: 400 },
                },
              ),
            );
      });
      const warn = jest.fn();
      const target = new CallbackReporter({
        callbackId: "cb-1",
        region: "us-east-1",
        client: { send } as unknown as LambdaClient,
        sleep: noSleep,
        warn,
      });

      const done = target.succeed("ok");
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(done).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("or the callback timed out first"),
        expect.objectContaining({ callbackId: "cb-1", attempt: 2 }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each<[string, Error, boolean]>([
    [
      "a server error",
      Object.assign(new Error("boom"), {
        name: "ServiceException",
        $metadata: { httpStatusCode: 500 },
      }),
      true,
    ],
    [
      "a throttle",
      Object.assign(new Error("slow down"), {
        name: "TooManyRequestsException",
        $metadata: { httpStatusCode: 429 },
      }),
      false,
    ],
    [
      "a credential error, which sent no request",
      Object.assign(new Error("no credentials"), {
        name: "CredentialsProviderError",
      }),
      false,
    ],
  ])(
    "after %s, a later 'already complete' counts as delivered: %p",
    async (_label, first, delivered) => {
      const client = new FakeLambdaClient();
      client.failures = [
        first,
        Object.assign(
          new Error("The callback is either timed out or already completed"),
          {
            name: "CallbackTimeoutException",
            $metadata: { httpStatusCode: 400 },
          },
        ),
      ];
      const done = reporter(client).succeed("ok");
      if (delivered) {
        await expect(done).resolves.toBeUndefined();
      } else {
        await expect(done).rejects.toThrow("already complete");
      }
    },
  );

  it("treats 'already complete' as delivered after an SDK-internal retry that ended in a throttle", async () => {
    const client = new FakeLambdaClient();
    const warn = jest.fn();
    client.failures = [
      // The SDK's first try may have been applied; its retry was throttled.
      Object.assign(new Error("slow down"), {
        name: "TooManyRequestsException",
        $metadata: { httpStatusCode: 429, attempts: 2 },
      }),
      Object.assign(
        new Error("The callback is either timed out or already completed"),
        {
          name: "CallbackTimeoutException",
          $metadata: { httpStatusCode: 400 },
        },
      ),
    ];
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: client.asClient(),
      sleep: noSleep,
      warn,
    });
    await expect(target.succeed("ok")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("or the callback timed out first"),
      expect.anything(),
    );
    expect(client.sent).toEqual([]);
  });

  it("ends a heartbeat at once when it is cancelled, and cancels its request", async () => {
    let signal: AbortSignal | undefined;
    const send = jest.fn(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        signal = options?.abortSignal;
        return new Promise(() => {});
      },
    );
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });
    const cancel = new AbortController();

    const beat = target.heartbeat(60_000, cancel.signal);
    cancel.abort();

    await expect(beat).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);
  });

  it("ends a heartbeat that has no timeout when it is cancelled", async () => {
    let signal: AbortSignal | undefined;
    const send = jest.fn(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        signal = options?.abortSignal;
        return new Promise(() => {});
      },
    );
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });
    const cancel = new AbortController();

    const beat = target.heartbeat(undefined, cancel.signal);
    cancel.abort();

    await expect(beat).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);
    expect(getEventListeners(cancel.signal, "abort")).toHaveLength(0);
  });

  it("does not send a heartbeat whose cancel signal already fired", async () => {
    const send = jest.fn(async () => ({}));
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });
    const cancel = new AbortController();
    cancel.abort();

    await expect(target.heartbeat(60_000, cancel.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves no listener on the cancel signal after a call", async () => {
    const send = jest.fn(async () => ({}));
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });
    const cancel = new AbortController();
    const add = jest.spyOn(cancel.signal, "addEventListener");

    for (let i = 0; i < 3; i++) {
      await target.heartbeat(60_000, cancel.signal);
    }

    // Each call adds a listener, and none is left after the calls end.
    expect(add).toHaveBeenCalledTimes(3);
    expect(getEventListeners(cancel.signal, "abort")).toHaveLength(0);
  });

  it("leaves the request signal unaborted when a call ends normally", async () => {
    let signal: AbortSignal | undefined;
    const send = jest.fn(
      async (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        signal = options?.abortSignal;
        return {};
      },
    );
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });

    await target.heartbeat(60_000, new AbortController().signal);

    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
  });

  it("treats 'already complete' after an SDK-internal retry as delivered", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      Object.assign(
        new Error("The callback is either timed out or already completed"),
        {
          name: "CallbackTimeoutException",
          $metadata: { httpStatusCode: 400, attempts: 2 },
        },
      ),
    ];
    await expect(reporter(client).succeed("ok")).resolves.toBeUndefined();
  });

  it("reports 'already complete' on the first attempt as a failure", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      Object.assign(
        new Error("The callback is either timed out or already completed"),
        {
          name: "CallbackTimeoutException",
          $metadata: { httpStatusCode: 400 },
        },
      ),
    ];
    await expect(reporter(client).succeed("ok")).rejects.toThrow(
      "already complete",
    );
  });

  it("does not count an invalid callback ID after an uncertain attempt as delivered", async () => {
    // The service answers InvalidParameterValueException for a callback ID
    // that it does not know. That says nothing about an earlier attempt.
    const client = new FakeLambdaClient();
    client.failures = [
      Object.assign(new Error("boom"), {
        name: "ServiceException",
        $metadata: { httpStatusCode: 500 },
      }),
      Object.assign(new Error("Invalid callback id"), {
        name: "InvalidParameterValueException",
        $metadata: { httpStatusCode: 400 },
      }),
    ];
    await expect(reporter(client).succeed("ok")).rejects.toThrow(
      "Invalid callback id",
    );
  });

  it("destroys only a client that it created itself", () => {
    const destroy = jest
      .spyOn(LambdaClient.prototype, "destroy")
      .mockImplementation(() => undefined);
    try {
      new CallbackReporter({ callbackId: "cb-1", region: "us-east-1" }).close();
      expect(destroy).toHaveBeenCalledTimes(1);

      const own = new FakeLambdaClient();
      const passed = Object.assign(own.asClient(), { destroy: jest.fn() });
      new CallbackReporter({
        callbackId: "cb-1",
        region: "us-east-1",
        client: passed,
      }).close();
      expect(passed.destroy).not.toHaveBeenCalled();
    } finally {
      destroy.mockRestore();
    }
  });

  it("ends a heartbeat that stalls before its HTTP request", async () => {
    // A stalled credential fetch ignores the abort signal.
    const send = jest.fn(() => new Promise(() => {}));
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });

    await expect(target.heartbeat(20)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("passes an abort signal that fires at the call timeout", async () => {
    let signal: AbortSignal | undefined;
    const send = jest.fn(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        signal = options?.abortSignal;
        return new Promise(() => {});
      },
    );
    const target = new CallbackReporter({
      callbackId: "cb-1",
      region: "us-east-1",
      client: { send } as unknown as LambdaClient,
    });

    await expect(target.heartbeat(20)).rejects.toThrow();
    // The timeout aborts the request signal before it rejects the call.
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(true);
  });

  it.each<[string, Error]>([
    [
      "a 400 ThrottlingException",
      Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 400 },
      }),
    ],
    [
      "a 403 InvalidSignatureException from a clock offset",
      Object.assign(new Error("signature expired"), {
        name: "InvalidSignatureException",
        $metadata: { httpStatusCode: 403 },
      }),
    ],
    [
      "a 400 that the SDK marks as retryable",
      Object.assign(new Error("try again"), {
        name: "SomeServiceException",
        $retryable: {},
        $metadata: { httpStatusCode: 400 },
      }),
    ],
  ])("retries a completion after %s", async (_label, first) => {
    const client = new FakeLambdaClient();
    client.failures = [first];
    await expect(reporter(client).succeed("ok")).resolves.toBeUndefined();
    expect(client.completions()).toHaveLength(1);
  });

  it("does not retry a completion after a 403 from the SDK's own error class", async () => {
    const client = new FakeLambdaClient();
    // The SDK's errors declare $retryable as a field, set to undefined.
    client.failures = [
      new LambdaServiceException({
        name: "AccessDeniedException",
        $fault: "client",
        $metadata: { httpStatusCode: 403 },
        message: "not allowed",
      }),
    ];
    await expect(reporter(client).succeed("ok")).rejects.toThrow("not allowed");
    expect(client.completions()).toHaveLength(0);
  });

  it("does not retry a completion after a 403 AccessDeniedException", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      Object.assign(new Error("not allowed"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      }),
    ];
    await expect(reporter(client).succeed("ok")).rejects.toThrow("not allowed");
    expect(client.completions()).toHaveLength(0);
  });

  it("gives up after 5 attempts", async () => {
    const client = new FakeLambdaClient();
    client.failures = Array.from(
      { length: 6 },
      () => new TooManyRequestsException({ message: "slow", ...metadata }),
    );
    await expect(reporter(client).succeed("ok")).rejects.toThrow("slow");
    expect(client.failures).toHaveLength(1);
  });
});

describe("Lambda clients", () => {
  it("destroys the default client of each job when the job ends", async () => {
    const send = jest
      .spyOn(LambdaClient.prototype, "send")
      .mockImplementation(async () => ({}));
    const destroy = jest
      .spyOn(LambdaClient.prototype, "destroy")
      .mockImplementation(() => undefined);
    const worker = await startMicrovmWorker(
      { routes: { "/job": async () => "ok" }, logger: silentLogger },
      0,
    );
    try {
      await fetch(`http://127.0.0.1:${worker.port}/job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          region: "us-east-1",
          callbackId: "cb-1",
          input: {},
        }),
      });
      await worker.idle();
      // An invalid request that names a callback also closes its client.
      await fetch(`http://127.0.0.1:${worker.port}/job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 9,
          region: "us-east-1",
          callbackId: "cb-2",
          input: {},
        }),
      });
      await worker.idle();

      expect(send).toHaveBeenCalledTimes(2);
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      await worker.close();
      send.mockRestore();
      destroy.mockRestore();
    }
  });

  it("creates a client for each job", async () => {
    const client = new FakeLambdaClient();
    const createClient = jest.fn(() => client.asClient());
    const worker = await startMicrovmWorker(
      {
        routes: { "/job": async () => "ok" },
        createClient,
        logger: silentLogger,
      },
      0,
    );
    try {
      for (const callbackId of ["cb-1", "cb-2"]) {
        await fetch(`http://127.0.0.1:${worker.port}/job`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            region: "us-east-1",
            callbackId,
            input: {},
          }),
        });
        await worker.idle();
      }

      expect(createClient).toHaveBeenCalledTimes(2);
      expect(client.completions()).toHaveLength(2);
    } finally {
      await worker.close();
    }
  });
});

describe("heartbeat interval", () => {
  it.each<[number, number | undefined, number]>([
    // The default is a third of the heartbeat timeout.
    [30, undefined, 10_000],
    // At most 15 minutes.
    [3_600, undefined, 15 * 60 * 1_000],
    // At most a third of a short heartbeat timeout, below the 1 s floor.
    [1, undefined, 333],
    // An explicit interval is used when it fits.
    [30, 500, 500],
    // An explicit interval longer than a third of the timeout is cut.
    [30, 60_000, 10_000],
  ])(
    "uses %p s timeout and %p ms override as a %p ms interval",
    (timeoutSeconds, override, expected) => {
      expect(heartbeatIntervalMs(timeoutSeconds, override)).toBe(expected);
    },
  );

  describe("after a failed heartbeat", () => {
    beforeEach(() => {
      jest.useFakeTimers({
        doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
      });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    // The job's heartbeat timeout is 40 seconds, so the interval is 13,333 ms.
    const INTERVAL_MS = 13_333;
    /**
     * The waits that the worker schedules for job cb-1, in order. Each wait
     * takes the next value of the job's jitter source, as the worker does.
     */
    const waits = (...kinds: ("retry" | "normal")[]): number[] => {
      const random = jitterSource("cb-1");
      return kinds.map((kind) =>
        kind === "retry"
          ? heartbeatRetryDelayMs(INTERVAL_MS, random)
          : heartbeatDelayMs(INTERVAL_MS, random),
      );
    };

    const startJob = async (
      client: FakeLambdaClient,
    ): Promise<MicrovmWorkerListener> => {
      const listener = createMicrovmWorkerListener({
        handler: () => new Promise(() => {}),
        createClient: () => client.asClient(),
        logger: silentLogger,
      });
      await new Promise<void>((resolve) => {
        const request = Object.assign(
          Readable.from([
            Buffer.from(
              JSON.stringify(
                runBody(validPayload({ heartbeatTimeoutSeconds: 40 })),
              ),
            ),
          ]),
          { url: `${HOOK_PATH_PREFIX}run`, method: "POST" },
        );
        listener.listener(
          request as never,
          {
            headersSent: false,
            writeHead() {
              return this;
            },
            end() {
              resolve();
              return this;
            },
          } as never,
        );
      });
      await jest.advanceTimersByTimeAsync(0);
      return listener;
    };

    it("keeps sending heartbeats while a completion attempt stalls", async () => {
      const heartbeats: number[] = [];
      let completions = 0;
      const client = {
        send: (command: unknown) => {
          if (command instanceof SendDurableExecutionCallbackHeartbeatCommand) {
            heartbeats.push(Date.now());
            return Promise.resolve({});
          }
          completions++;
          // The first completion attempt never answers.
          return completions === 1
            ? new Promise(() => {})
            : Promise.resolve({});
        },
      } as unknown as LambdaClient;
      const listener = createMicrovmWorkerListener({
        handler: async () => "ok",
        createClient: () => client,
        logger: silentLogger,
      });
      await new Promise<void>((resolve) => {
        const request = Object.assign(
          Readable.from([
            Buffer.from(
              JSON.stringify(
                runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
              ),
            ),
          ]),
          { url: `${HOOK_PATH_PREFIX}run`, method: "POST" },
        );
        listener.listener(
          request as never,
          {
            headersSent: false,
            writeHead() {
              return this;
            },
            end() {
              resolve();
              return this;
            },
          } as never,
        );
      });
      await jest.advanceTimersByTimeAsync(0);
      const before = heartbeats.length;

      // The first attempt ends after 30 s, and the retry follows after 1 s.
      // With a 10 s interval, heartbeats continue meanwhile.
      await jest.advanceTimersByTimeAsync(31_000);
      expect(completions).toBe(2);
      expect(heartbeats.length - before).toBeGreaterThanOrEqual(3);

      // After the completion, heartbeats stop.
      await listener.idle();
      const after = heartbeats.length;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(heartbeats.length).toBe(after);
      listener.close();
    });

    it.each<[string, string, boolean]>([
      // The completion landed while the heartbeat was in flight: the
      // service answers that the callback is closed. No log.
      ["a closed callback", "CallbackTimeoutException", false],
      // The callback ID is not valid: the answer is logged.
      ["an invalid callback ID", "InvalidParameterValueException", true],
    ])(
      "does not abort the handler's signal for %s after the handler returned",
      async (_label, errorName, logged) => {
        let completions = 0;
        let heartbeatsAfterHandler = 0;
        let handlerDone = false;
        const client = {
          send: (command: unknown) => {
            if (
              command instanceof SendDurableExecutionCallbackHeartbeatCommand
            ) {
              if (!handlerDone) {
                return Promise.resolve({});
              }
              heartbeatsAfterHandler++;
              // The outcome has landed, but its answer is lost.
              return Promise.reject(
                Object.assign(new Error("terminal answer"), {
                  name: errorName,
                  $metadata: { httpStatusCode: 400 },
                }),
              );
            }
            completions++;
            return completions === 1
              ? new Promise(() => {})
              : Promise.resolve({});
          },
        } as unknown as LambdaClient;
        const onAbort = jest.fn();
        const info = jest.fn();
        const listener = createMicrovmWorkerListener({
          handler: async (_input, context) => {
            context.signal.addEventListener("abort", onAbort);
            handlerDone = true;
            return "ok";
          },
          createClient: () => client,
          logger: { info, warn: () => {}, error: () => {} },
        });
        await new Promise<void>((resolve) => {
          const request = Object.assign(
            Readable.from([
              Buffer.from(
                JSON.stringify(
                  runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
                ),
              ),
            ]),
            { url: `${HOOK_PATH_PREFIX}run`, method: "POST" },
          );
          listener.listener(
            request as never,
            {
              headersSent: false,
              writeHead() {
                return this;
              },
              end() {
                resolve();
                return this;
              },
            } as never,
          );
        });
        await jest.advanceTimersByTimeAsync(31_000);
        await listener.idle();

        expect(heartbeatsAfterHandler).toBeGreaterThanOrEqual(1);
        expect(onAbort).not.toHaveBeenCalled();
        expect(
          info.mock.calls.some(
            ([message]) =>
              message === "the callback no longer accepts heartbeats",
          ),
        ).toBe(logged);
        expect(completions).toBe(2);
        listener.close();
      },
    );

    it("logs nothing for a heartbeat that fails after the job ended", async () => {
      const warn = jest.fn();
      const client = {
        send: (command: unknown) =>
          command instanceof SendDurableExecutionCallbackHeartbeatCommand
            ? // The first heartbeat is still in flight when the job ends.
              new Promise(() => {})
            : Promise.resolve({}),
      } as unknown as LambdaClient;
      const listener = createMicrovmWorkerListener({
        handler: async () => "ok",
        createClient: () => client,
        logger: { info: () => {}, warn, error: () => {} },
      });
      await new Promise<void>((resolve) => {
        const request = Object.assign(
          Readable.from([
            Buffer.from(
              JSON.stringify(
                runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
              ),
            ),
          ]),
          { url: `${HOOK_PATH_PREFIX}run`, method: "POST" },
        );
        listener.listener(
          request as never,
          {
            headersSent: false,
            writeHead() {
              return this;
            },
            end() {
              resolve();
              return this;
            },
          } as never,
        );
      });
      // The job cancels the heartbeat in flight instead of waiting for its
      // 5 s call timeout, so it ends at once.
      let idle = false;
      void listener.idle().then(() => {
        idle = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(idle).toBe(true);
      expect(warn).not.toHaveBeenCalledWith(
        "heartbeat failed",
        expect.anything(),
      );
      listener.close();
    });

    it("logs no recovery and sends no heartbeat when a heartbeat's success is seen after stop()", async () => {
      let calls = 0;
      let release: (value: unknown) => void = () => {};
      const send = jest.fn(() => {
        calls++;
        if (calls === 1) {
          return Promise.reject(
            Object.assign(new Error("not allowed"), {
              name: "AccessDeniedException",
              $metadata: { httpStatusCode: 403 },
            }),
          );
        }
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const info = jest.fn();
      const error = jest.fn();
      const heartbeats = startHeartbeats(
        new CallbackReporter({
          callbackId: "cb-1",
          region: "us-east-1",
          client: { send } as unknown as LambdaClient,
        }),
        { callbackId: "cb-1", heartbeatTimeoutSeconds: 40, input: {} },
        new AbortController(),
        undefined,
        { info, warn: () => {}, error },
      );
      // The rejection is logged, and the second heartbeat is in flight.
      await jest.advanceTimersByTimeAsync(3_333);
      expect(send).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("the service rejected a heartbeat"),
        expect.anything(),
      );

      // The call succeeds, and the job ends before the heartbeat code sees
      // the answer.
      release({});
      const stopped = heartbeats.stop();
      await stopped;
      await jest.advanceTimersByTimeAsync(60_000);

      expect(info).not.toHaveBeenCalledWith(
        "heartbeats are accepted again",
        expect.anything(),
      );
      expect(error).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("retries a rejected heartbeat after a short delay, like other failures", async () => {
      const client = new FakeLambdaClient();
      client.heartbeatFailures = [
        Object.assign(new Error("not allowed"), {
          name: "AccessDeniedException",
          $metadata: { httpStatusCode: 403 },
        }),
      ];
      const listener = await startJob(client);
      const [retry] = waits("retry");

      await jest.advanceTimersByTimeAsync(retry - 1);
      expect(client.sent).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.sent).toEqual([{ kind: "heartbeat", callbackId: "cb-1" }]);
      listener.close();
    });

    it("retries after an eighth to a quarter interval, and not before", async () => {
      const client = new FakeLambdaClient();
      client.heartbeatFailures = [new Error("transient")];
      const listener = await startJob(client);
      expect(client.sent).toEqual([]);
      const [retry] = waits("retry");
      expect(retry).toBeGreaterThanOrEqual(Math.floor(INTERVAL_MS / 8));
      expect(retry).toBeLessThanOrEqual(Math.floor(INTERVAL_MS / 4));

      await jest.advanceTimersByTimeAsync(retry - 1);
      expect(client.sent).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.sent).toEqual([{ kind: "heartbeat", callbackId: "cb-1" }]);
      listener.close();
    });

    it("starts the failure count again after a success", async () => {
      const client = new FakeLambdaClient();
      // An undefined entry is a successful heartbeat.
      client.heartbeatFailures = [
        new Error("one"),
        undefined as unknown as Error,
        new Error("two"),
      ];
      const listener = await startJob(client);
      const [retry, normal, secondRetry] = waits("retry", "normal", "retry");

      // The quick retry succeeds.
      await jest.advanceTimersByTimeAsync(retry);
      expect(client.sent).toHaveLength(1);
      // After the success, the next call waits a normal interval.
      await jest.advanceTimersByTimeAsync(normal - 1);
      expect(client.heartbeatFailures).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.heartbeatFailures).toHaveLength(0);
      // That call fails. It is the first failure of a new run, so the retry
      // is quick again.
      await jest.advanceTimersByTimeAsync(secondRetry);
      expect(client.sent).toHaveLength(2);
      listener.close();
    });

    it("waits the normal interval after the third failure in a row", async () => {
      const client = new FakeLambdaClient();
      client.heartbeatFailures = [
        new Error("one"),
        new Error("two"),
        new Error("three"),
      ];
      const listener = await startJob(client);
      const [first, second, normal] = waits("retry", "retry", "normal");

      // Two quick retries, both failing.
      await jest.advanceTimersByTimeAsync(first + second);
      expect(client.heartbeatFailures).toEqual([]);
      // The fourth call waits a normal interval.
      await jest.advanceTimersByTimeAsync(normal - 1);
      expect(client.sent).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.sent).toEqual([{ kind: "heartbeat", callbackId: "cb-1" }]);
      listener.close();
    });

    it("counts rejections and transient failures in the same quick-retry budget", async () => {
      const client = new FakeLambdaClient();
      const rejected = (): Error =>
        Object.assign(new Error("not allowed"), {
          name: "AccessDeniedException",
          $metadata: { httpStatusCode: 403 },
        });
      client.heartbeatFailures = [
        rejected(),
        new Error("transient"),
        rejected(),
      ];
      const listener = await startJob(client);
      const [first, second, normal] = waits("retry", "retry", "normal");

      // A rejection and a transient failure each get a quick retry.
      await jest.advanceTimersByTimeAsync(first + second);
      expect(client.heartbeatFailures).toEqual([]);
      // After the third failure in a row, the fourth call waits a normal
      // interval.
      await jest.advanceTimersByTimeAsync(normal - 1);
      expect(client.sent).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.sent).toEqual([{ kind: "heartbeat", callbackId: "cb-1" }]);
      listener.close();
    });
  });
});

describe("heartbeatIntervalMs", () => {
  it.each([0, -1, 1.5, 15 * 60 * 1_000 + 1, Number.NaN])(
    "rejects %p",
    (value) => {
      expect(() =>
        createMicrovmWorkerListener({
          handler: async () => "ok",
          heartbeatIntervalMs: value,
        }),
      ).toThrow(RangeError);
    },
  );
});

describe("startMicrovmWorker", () => {
  let worker: MicrovmWorker | undefined;
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  const start = async (
    client: FakeLambdaClient,
    handler: MicrovmJobHandler | undefined,
    heartbeatIntervalMs?: number,
    extra: Partial<MicrovmWorkerOptions> = {},
  ): Promise<MicrovmWorker> => {
    worker = await startMicrovmWorker(
      {
        handler,
        createClient: () => client.asClient(),
        heartbeatIntervalMs,
        logger: silentLogger,
        ...extra,
      },
      0,
    );
    return worker;
  };

  const post = async (
    target: MicrovmWorker,
    hook: string,
    body: unknown,
  ): Promise<Response> =>
    fetch(`http://127.0.0.1:${target.port}${HOOK_PATH_PREFIX}${hook}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers the run hook before the job ends, then reports the result", async () => {
    const client = new FakeLambdaClient();
    let release: (value: unknown) => void = () => {};
    const handler = jest.fn(
      () => new Promise((resolve) => (release = resolve)),
    );
    const target = await start(client, handler);

    const response = await post(target, "run", runBody(validPayload()));
    expect(response.status).toBe(200);
    expect(client.completions()).toHaveLength(0);

    release({ passed: true });
    await target.idle();

    expect(handler).toHaveBeenCalledWith(
      { repo: "org/app" },
      expect.objectContaining({
        callbackId: "cb-1",
        microvmId: "mvm-1",
        region: "us-east-1",
      }),
    );
    expect(client.completions()).toEqual([
      { kind: "success", callbackId: "cb-1", result: { passed: true } },
    ]);
  });

  it("sends heartbeats while the job runs, and none after it ends", async () => {
    const client = new FakeLambdaClient();
    const target = await start(
      client,
      () => new Promise((resolve) => setTimeout(() => resolve("ok"), 120)),
      20,
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();
    const beats = client.sent.filter((s) => s.kind === "heartbeat").length;
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(beats).toBeGreaterThanOrEqual(3);
    expect(client.sent.filter((s) => s.kind === "heartbeat").length).toBe(
      beats,
    );
    expect(client.sent.at(-1)?.kind).toBe("success");
  });

  it("sends no heartbeats when the payload has no heartbeat timeout", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, async () => "ok", 5);

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.sent.map((s) => s.kind)).toEqual(["success"]);
  });

  it("aborts the job and reports nothing when a heartbeat says the callback is gone", async () => {
    const client = new FakeLambdaClient();
    client.heartbeatFailures = [
      new CallbackTimeoutException({ message: "timed out", ...metadata }),
    ];
    let signal: AbortSignal | undefined;
    const target = await start(
      client,
      (_input, context) =>
        new Promise((resolve) => {
          signal = context.signal;
          context.signal.addEventListener("abort", () => resolve("late"));
        }),
      10,
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();

    expect(signal?.aborted).toBe(true);
    expect(client.completions()).toHaveLength(0);
  });

  it("reports the handler's error as a callback failure", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, async () => {
      throw new RangeError("3 tests failed");
    });

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.completions()).toEqual([
      expect.objectContaining({
        kind: "failure",
        error: expect.objectContaining({
          ErrorType: "RangeError",
          ErrorMessage: "3 tests failed",
        }),
      }),
    ]);
  });

  it("reports a result that is not JSON-serializable as a failure", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, async () => ({ n: 1n }));

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.completions()).toEqual([
      expect.objectContaining({
        kind: "failure",
        error: expect.objectContaining({
          ErrorType: "ResultSerializationError",
        }),
      }),
    ]);
  });

  describe("does not end the process", () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    beforeEach(() => {
      unhandled.length = 0;
      process.on("unhandledRejection", onUnhandled);
    });
    afterEach(() => {
      process.off("unhandledRejection", onUnhandled);
    });
    const settle = (): Promise<void> =>
      new Promise((resolve) => setImmediate(resolve));

    it("when createClient throws", async () => {
      const target = await start(
        new FakeLambdaClient(),
        async () => "ok",
        undefined,
        {
          createClient: () => {
            throw new Error("boom createClient");
          },
        },
      );

      await post(target, "run", runBody(validPayload()));
      await target.idle();
      await settle();

      expect(unhandled).toEqual([]);
    });

    it("when an async logger rejects", async () => {
      const client = new FakeLambdaClient();
      const rejecting = async (): Promise<void> => {
        throw new Error("boom async logger");
      };
      const target = await start(client, async () => "ok", undefined, {
        logger: { info: rejecting, warn: rejecting, error: rejecting },
      });

      await post(target, "run", runBody(validPayload()));
      await target.idle();
      await settle();

      expect(unhandled).toEqual([]);
      expect(client.completions()).toEqual([
        { kind: "success", callbackId: "cb-1", result: "ok" },
      ]);
    });

    it("when the handler throws an error whose getters throw", async () => {
      const client = new FakeLambdaClient();
      const hostile = new Error("x");
      for (const key of ["name", "message"]) {
        Object.defineProperty(hostile, key, {
          get() {
            throw new Error("getter");
          },
        });
      }
      const target = await start(client, async () => {
        throw hostile;
      });

      await post(target, "run", runBody(validPayload()));
      await target.idle();
      await settle();

      expect(unhandled).toEqual([]);
      expect(client.completions()).toEqual([
        {
          kind: "failure",
          callbackId: "cb-1",
          error: { ErrorType: "Error", ErrorMessage: "unknown error" },
        },
      ]);
    });

    it("when the logger throws", async () => {
      const client = new FakeLambdaClient();
      const throwing = (): void => {
        throw new Error("boom logger");
      };
      const target = await start(client, async () => "ok", 5, {
        logger: { info: throwing, warn: throwing, error: throwing },
      });
      client.heartbeatFailures = [new Error("transient")];

      await post(
        target,
        "run",
        runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
      );
      await target.idle();
      await settle();

      expect(unhandled).toEqual([]);
      expect(client.completions()).toEqual([
        { kind: "success", callbackId: "cb-1", result: "ok" },
      ]);
    });

    it("when createMicrovmsClient throws, and it accepts jobs afterwards", async () => {
      jest.useFakeTimers({
        doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
      });
      try {
        const listener = createMicrovmWorkerListener({
          routes: { "/job": async () => "ok" },
          createClient: () => new FakeLambdaClient().asClient(),
          createMicrovmsClient: () => {
            throw new Error("boom microvms client");
          },
          logger: silentLogger,
        });
        const call = (path: string, body: unknown): Promise<number> =>
          new Promise((resolve) => {
            const request = Object.assign(
              Readable.from([Buffer.from(JSON.stringify(body))]),
              { url: path, method: "POST" },
            );
            let status = 0;
            listener.listener(
              request as never,
              {
                headersSent: false,
                writeHead(code: number) {
                  status = code;
                  return this;
                },
                end() {
                  resolve(status);
                  return this;
                },
              } as never,
            );
          });

        await call(`${HOOK_PATH_PREFIX}run`, {
          microvmId: "mvm-1",
          runHookPayload: JSON.stringify({
            version: 1,
            region: "us-east-1",
            autoSuspendIdleSeconds: 10,
          }),
        });
        await jest.advanceTimersByTimeAsync(10_000);

        expect(
          await call("/job", {
            version: 1,
            region: "us-east-1",
            callbackId: "cb-1",
            input: {},
          }),
        ).toBe(202);
        listener.close();
        await listener.idle();
        await settle();
        expect(unhandled).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it("reports a result over 256 KB as a failure", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, async () =>
      "x".repeat(MAX_CALLBACK_RESULT_BYTES),
    );

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.completions()).toEqual([
      expect.objectContaining({
        kind: "failure",
        error: expect.objectContaining({ ErrorType: "ResultTooLargeError" }),
      }),
    ]);
  });

  it("reports a RangeError from the service call as a delivery failure, not as the job's failure", async () => {
    const client = new FakeLambdaClient();
    // A RangeError that the call itself raises is not the size check. The
    // 400 status makes it permanent, so it is not retried.
    client.failures = [
      Object.assign(new RangeError("Invalid time value"), {
        $metadata: { httpStatusCode: 400 },
      }),
    ];
    const error = jest.fn();
    const target = await start(client, async () => "ok", undefined, {
      logger: { info: () => {}, warn: () => {}, error },
    });

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.completions()).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      "job outcome could not be reported",
      expect.anything(),
    );
  });

  it("logs a completion that cannot be reported, and ends the job's heartbeats", async () => {
    const client = new FakeLambdaClient();
    client.failures = [
      Object.assign(new Error("not allowed"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      }),
    ];
    const error = jest.fn();
    const target = await start(client, async () => "ok", 10, {
      logger: { info: () => {}, warn: () => {}, error },
    });

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();
    const beats = client.sent.filter((s) => s.kind === "heartbeat").length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(error).toHaveBeenCalledWith(
      "job outcome could not be reported",
      expect.objectContaining({ terminal: false }),
    );
    expect(client.completions()).toEqual([]);
    expect(client.sent.filter((s) => s.kind === "heartbeat").length).toBe(
      beats,
    );
  });

  const rejection = (name: string, status: number): Error =>
    Object.assign(new Error(`rejected: ${name}`), {
      name,
      $metadata: { httpStatusCode: status },
    });
  const rejectionLogs = (error: jest.Mock): unknown[][] =>
    error.mock.calls.filter(([message]) =>
      String(message).startsWith("the service rejected a heartbeat"),
    );

  it("keeps heartbeating after rejected heartbeats, logs the rejection once, and logs the recovery", async () => {
    const client = new FakeLambdaClient();
    client.heartbeatFailures = [
      rejection("AccessDeniedException", 403),
      rejection("AccessDeniedException", 403),
      rejection("AccessDeniedException", 403),
    ];
    const error = jest.fn();
    const warn = jest.fn();
    const info = jest.fn();
    let signal: AbortSignal | undefined;
    const target = await start(
      client,
      (_input, context) => {
        signal = context.signal;
        return new Promise((resolve) => setTimeout(() => resolve("ok"), 200));
      },
      10,
      { logger: { info, warn, error } },
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();

    expect(signal?.aborted).toBe(false);
    expect(client.heartbeatFailures).toHaveLength(0);
    expect(
      client.sent.filter((s) => s.kind === "heartbeat").length,
    ).toBeGreaterThanOrEqual(1);
    expect(rejectionLogs(error)).toHaveLength(1);
    expect(rejectionLogs(error)[0]?.[1]).toMatchObject({
      handlerSettled: false,
    });
    expect(
      info.mock.calls.filter(
        ([message]) => message === "heartbeats are accepted again",
      ),
    ).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith(
      "heartbeat failed",
      expect.anything(),
    );
    expect(client.completions()).toEqual([
      { kind: "success", callbackId: "cb-1", result: "ok" },
    ]);
  });

  it("logs the same rejection again after a heartbeat succeeded", async () => {
    const client = new FakeLambdaClient();
    client.heartbeatFailures = [
      rejection("AccessDeniedException", 403),
      // An empty entry is a successful heartbeat.
      undefined as unknown as Error,
      rejection("AccessDeniedException", 403),
    ];
    const error = jest.fn();
    const info = jest.fn();
    const target = await start(
      client,
      () => new Promise((resolve) => setTimeout(() => resolve("ok"), 200)),
      10,
      { logger: { info, warn: () => {}, error } },
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();

    expect(client.heartbeatFailures).toHaveLength(0);
    expect(rejectionLogs(error)).toHaveLength(2);
    expect(
      info.mock.calls.filter(
        ([message]) => message === "heartbeats are accepted again",
      ),
    ).toHaveLength(2);
  });

  it("logs each different rejection once until a heartbeat succeeds", async () => {
    const client = new FakeLambdaClient();
    client.heartbeatFailures = [
      rejection("AccessDeniedException", 403),
      rejection("ValidationException", 400),
      rejection("AccessDeniedException", 403),
    ];
    const error = jest.fn();
    const target = await start(
      client,
      () => new Promise((resolve) => setTimeout(() => resolve("ok"), 200)),
      10,
      { logger: { info: () => {}, warn: () => {}, error } },
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();

    expect(client.heartbeatFailures).toHaveLength(0);
    expect(
      rejectionLogs(error).map(
        ([, data]) => (data as { error: { name: string } }).error.name,
      ),
    ).toEqual(["AccessDeniedException", "ValidationException"]);
  });

  it.each<[string, number]>([
    ["ThrottlingException", 400],
    ["InvalidSignatureException", 403],
    ["ExpiredTokenException", 403],
  ])("treats a heartbeat %s (%d) as transient", async (name, status) => {
    const client = new FakeLambdaClient();
    client.heartbeatFailures = [rejection(name, status)];
    const error = jest.fn();
    const warn = jest.fn();
    const target = await start(
      client,
      () => new Promise((resolve) => setTimeout(() => resolve("ok"), 80)),
      10,
      { logger: { info: () => {}, warn, error } },
    );

    await post(
      target,
      "run",
      runBody(validPayload({ heartbeatTimeoutSeconds: 30 })),
    );
    await target.idle();

    expect(rejectionLogs(error)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("heartbeat failed", expect.anything());
    expect(
      client.sent.filter((s) => s.kind === "heartbeat").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("ignores a second run hook for a running callback", async () => {
    const client = new FakeLambdaClient();
    let release: (value: unknown) => void = () => {};
    const handler = jest.fn(
      () => new Promise((resolve) => (release = resolve)),
    );
    const target = await start(client, handler);

    await post(target, "run", runBody(validPayload()));
    const second = await post(target, "run", runBody(validPayload()));
    release("ok");
    await target.idle();

    expect(second.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.completions()).toHaveLength(1);
  });

  it("answers 400 to an invalid payload and fails the named callback", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn();
    const target = await start(client, handler);

    const response = await post(
      target,
      "run",
      runBody({ ...validPayload(), version: 9 }),
    );
    // The failure report runs after the response. Poll briefly for it.
    for (let i = 0; i < 50 && client.completions().length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(client.completions()).toEqual([
      expect.objectContaining({
        kind: "failure",
        callbackId: "cb-1",
        error: expect.objectContaining({
          ErrorType: "InvalidRunHookPayloadError",
        }),
      }),
    ]);
  });

  it("runs only the job of the first valid run hook", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn(async () => "done");
    const target = await start(client, handler);

    const first = await post(target, "run", runBody(validPayload()));
    const later = await post(target, "run", {
      ...runBody(validPayload({ callbackId: "cb-2" })),
      microvmId: "mvm-2",
    });
    await target.idle();

    expect(first.status).toBe(200);
    expect(later.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.completions()).toEqual([
      expect.objectContaining({ kind: "success", callbackId: "cb-1" }),
    ]);
  });

  it("answers 400 to a run hook with an empty MicroVM ID and fails its job's callback", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn();
    const target = await start(client, handler);

    const response = await post(target, "run", {
      ...runBody(validPayload()),
      microvmId: "",
    });
    await target.idle();

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(client.completions()).toEqual([
      expect.objectContaining({ kind: "failure", callbackId: "cb-1" }),
    ]);
  });

  it("answers 400 with a generic message when reading the body fails", async () => {
    const error = jest.fn();
    const listener = createMicrovmWorkerListener({
      handler: jest.fn(),
      createClient: () => new FakeLambdaClient().asClient(),
      logger: { info: () => {}, warn: () => {}, error },
    });
    // The stream fails with an error whose message is internal detail.
    const request = Object.assign(
      new Readable({
        read() {
          this.destroy(new Error("ECONNRESET at /opt/app/internal.js:42"));
        },
      }),
      { url: `${HOOK_PATH_PREFIX}run`, method: "POST" },
    );
    const answer = await new Promise<{ status: number; body: string }>(
      (resolve) => {
        let status = 0;
        listener.listener(
          request as never,
          {
            headersSent: false,
            writeHead(code: number) {
              status = code;
              return this;
            },
            end(body: string) {
              resolve({ status, body });
              return this;
            },
          } as never,
        );
      },
    );

    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body)).toEqual({ error: "invalid request" });
    expect(error).toHaveBeenCalledWith(
      "could not read the request",
      expect.objectContaining({
        error: expect.objectContaining({
          message: "ECONNRESET at /opt/app/internal.js:42",
        }),
      }),
    );
    listener.close();
  });

  it("answers 400 to a body that is not JSON", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, jest.fn());

    const response = await fetch(
      `http://127.0.0.1:${target.port}${HOOK_PATH_PREFIX}run`,
      { method: "POST", body: "{" },
    );

    expect(response.status).toBe(400);
    expect(client.sent).toHaveLength(0);
  });

  it.each(["resume", "suspend", "terminate"])(
    "answers the %s hook with 200",
    async (hook) => {
      const target = await start(new FakeLambdaClient(), jest.fn());
      expect((await post(target, hook, {})).status).toBe(200);
    },
  );

  it("answers 404 outside the hook paths", async () => {
    const target = await start(new FakeLambdaClient(), jest.fn());
    const response = await fetch(`http://127.0.0.1:${target.port}/other`);
    expect(response.status).toBe(404);
  });

  const postRoute = async (
    target: MicrovmWorker,
    path: string,
    body: unknown,
  ): Promise<Response> =>
    fetch(`http://127.0.0.1:${target.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const jobRequest = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    region: "us-east-1",
    ...validJob(),
    ...overrides,
  });

  it("answers a run hook without a job with 200 and does nothing else", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn();
    const target = await start(client, handler);

    const response = await post(
      target,
      "run",
      runBody({ version: 1, region: "us-east-1" }),
    );
    const bare = await post(target, "run", { microvmId: "mvm-1" });
    await target.idle();

    expect(response.status).toBe(200);
    expect(bare.status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
    expect(client.sent).toHaveLength(0);
  });

  it("answers a job request with 202 and completes its callback with the route's result", async () => {
    const client = new FakeLambdaClient();
    const route = jest.fn(async (input: unknown) => ({ echoed: input }));
    const target = await start(client, undefined, undefined, {
      routes: { "/clone-build": route },
    });
    await post(target, "run", runBody({ version: 1, region: "us-east-1" }));

    const response = await postRoute(target, "/clone-build", jobRequest());
    await target.idle();

    expect(response.status).toBe(202);
    expect(route).toHaveBeenCalledWith(
      { repo: "org/app" },
      expect.objectContaining({ callbackId: "cb-1", microvmId: "mvm-1" }),
    );
    expect(client.completions()).toEqual([
      {
        kind: "success",
        callbackId: "cb-1",
        result: { echoed: { repo: "org/app" } },
      },
    ]);
  });

  it("takes the MicroVM ID from a job request that arrives before the run hook", async () => {
    const client = new FakeLambdaClient();
    const seen: string[] = [];
    const target = await start(client, undefined, undefined, {
      routes: {
        "/job": async (_input, context) => {
          seen.push(context.microvmId);
          return "ok";
        },
      },
    });
    const job = (callbackId: string, microvmId?: string): Promise<Response> =>
      fetch(`http://127.0.0.1:${target.port}/job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          region: "us-east-1",
          callbackId,
          ...(microvmId !== undefined && { microvmId }),
          input: {},
        }),
      });

    // Without an ID in the request or a run hook, the ID is unknown.
    await job("cb-0");
    await target.idle();
    await job("cb-1", "mvm-1");
    await target.idle();
    // The run hook carries the same ID.
    await post(target, "run", { microvmId: "mvm-1" });
    await job("cb-2");
    await target.idle();

    expect(seen).toEqual(["unknown", "mvm-1", "mvm-1"]);
  });

  it("keeps the run hook's MicroVM ID over a job request's", async () => {
    const client = new FakeLambdaClient();
    const seen: string[] = [];
    const target = await start(client, undefined, undefined, {
      routes: {
        "/job": async (_input, context) => {
          seen.push(context.microvmId);
          return "ok";
        },
      },
    });
    await post(target, "run", { microvmId: "mvm-1" });
    await fetch(`http://127.0.0.1:${target.port}/job`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        region: "us-east-1",
        callbackId: "cb-1",
        microvmId: "mvm-other",
        input: {},
      }),
    });
    await target.idle();

    expect(seen).toEqual(["mvm-1"]);
  });

  it("replaces a job request's MicroVM ID with the run hook's", async () => {
    const client = new FakeLambdaClient();
    const seen: string[] = [];
    const target = await start(client, undefined, undefined, {
      routes: {
        "/job": async (_input, context) => {
          seen.push(context.microvmId);
          return "ok";
        },
      },
    });
    const job = (callbackId: string, microvmId?: string): Promise<Response> =>
      fetch(`http://127.0.0.1:${target.port}/job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          region: "us-east-1",
          callbackId,
          ...(microvmId !== undefined && { microvmId }),
          input: {},
        }),
      });

    await job("cb-1", "mvm-from-job");
    await target.idle();
    await post(target, "run", { microvmId: "mvm-1" });
    await job("cb-2");
    await target.idle();

    expect(seen).toEqual(["mvm-from-job", "mvm-1"]);
  });

  it("runs a job once when its request arrives twice", async () => {
    const client = new FakeLambdaClient();
    let release: (value: unknown) => void = () => {};
    const route = jest.fn(() => new Promise((resolve) => (release = resolve)));
    const target = await start(client, undefined, undefined, {
      routes: { "/job": route },
    });

    const first = await postRoute(target, "/job", jobRequest());
    const second = await postRoute(target, "/job", jobRequest());
    release("ok");
    await target.idle();

    expect([first.status, second.status]).toEqual([202, 202]);
    expect(route).toHaveBeenCalledTimes(1);
    expect(client.completions()).toHaveLength(1);
  });

  it("runs a job once when its request arrives again after the job ended", async () => {
    const client = new FakeLambdaClient();
    const route = jest.fn(async () => "ok");
    const warn = jest.fn();
    const target = await start(client, undefined, undefined, {
      routes: { "/job": route },
      logger: { info: () => {}, warn, error: () => {} },
    });

    const first = await postRoute(target, "/job", jobRequest());
    await target.idle();
    const again = await postRoute(target, "/job", jobRequest());
    await target.idle();

    expect([first.status, again.status]).toEqual([202, 202]);
    expect(route).toHaveBeenCalledTimes(1);
    expect(client.completions()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "duplicate job ignored",
      expect.anything(),
    );
  });

  it("runs a run hook job once when the hook arrives again after the job ended", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn(async () => "ok");
    const target = await start(client, handler);

    await post(target, "run", runBody(validPayload()));
    await target.idle();
    const again = await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(again.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.completions()).toHaveLength(1);
  });

  it("forgets the oldest finished job after 1,000 others ended", async () => {
    const client = new FakeLambdaClient();
    const route = jest.fn(async () => "ok");
    const target = await start(client, undefined, undefined, {
      routes: { "/job": route },
    });

    for (let i = 0; i <= 1_000; i++) {
      await postRoute(target, "/job", jobRequest({ callbackId: `cb-${i}` }));
      await target.idle();
    }
    // cb-1 is still remembered, and cb-0 is not.
    await postRoute(target, "/job", jobRequest({ callbackId: "cb-1" }));
    await target.idle();
    expect(route).toHaveBeenCalledTimes(1_001);
    await postRoute(target, "/job", jobRequest({ callbackId: "cb-0" }));
    await target.idle();
    expect(route).toHaveBeenCalledTimes(1_002);
  }, 60_000);

  it("answers 400 to an invalid job request and fails the named callback", async () => {
    const client = new FakeLambdaClient();
    const route = jest.fn();
    const target = await start(client, undefined, undefined, {
      routes: { "/job": route },
    });

    const response = await postRoute(
      target,
      "/job",
      jobRequest({ version: 7 }),
    );
    await target.idle();

    expect(response.status).toBe(400);
    expect(route).not.toHaveBeenCalled();
    expect(client.completions()).toEqual([
      expect.objectContaining({ kind: "failure", callbackId: "cb-1" }),
    ]);
  });

  it("fails a run hook job when the worker has only routes", async () => {
    const client = new FakeLambdaClient();
    const target = await start(client, undefined, undefined, {
      routes: { "/job": async () => "ok" },
    });

    await post(target, "run", runBody(validPayload()));
    await target.idle();

    expect(client.completions()).toEqual([
      expect.objectContaining({
        kind: "failure",
        callbackId: "cb-1",
        error: expect.objectContaining({
          ErrorMessage: expect.stringContaining("no handler for run hook jobs"),
        }),
      }),
    ]);
  });

  it("runs handler for a job on the default job path", async () => {
    const client = new FakeLambdaClient();
    const handler = jest.fn(async (input: unknown) => ({ echoed: input }));
    const target = await start(client, handler);

    const response = await postRoute(target, MICROVM_JOB_PATH, jobRequest());
    await target.idle();

    expect(MICROVM_JOB_PATH).toBe("/durable-execution/v1/job");
    expect(response.status).toBe(202);
    expect(handler).toHaveBeenCalledWith(
      { repo: "org/app" },
      expect.objectContaining({ callbackId: "cb-1" }),
    );
    expect(client.completions()).toEqual([
      {
        kind: "success",
        callbackId: "cb-1",
        result: { echoed: { repo: "org/app" } },
      },
    ]);
  });

  it("answers 404 on the default job path when the worker has no handler", async () => {
    const target = await start(new FakeLambdaClient(), undefined, undefined, {
      routes: { "/job": async () => "ok" },
    });

    const response = await postRoute(target, MICROVM_JOB_PATH, jobRequest());

    expect(response.status).toBe(404);
  });

  it("answers 404 to a GET on a route", async () => {
    const target = await start(new FakeLambdaClient(), undefined, undefined, {
      routes: { "/job": async () => "ok" },
    });
    const response = await fetch(`http://127.0.0.1:${target.port}/job`);
    expect(response.status).toBe(404);
  });

  it.each<[string, Partial<MicrovmWorkerOptions>]>([
    ["no handler and no routes", {}],
    ["a route without a leading slash", { routes: { job: async () => 1 } }],
    [
      "a route under the hook prefix",
      { routes: { [`${HOOK_PATH_PREFIX}x`]: async () => 1 } },
    ],
    [
      "a route on the default job path",
      {
        handler: async () => 1,
        routes: { [MICROVM_JOB_PATH]: async () => 1 },
      },
    ],
  ])("refuses to start with %s", async (_label, extra) => {
    await expect(
      startMicrovmWorker({ logger: silentLogger, ...extra }, 0),
    ).rejects.toThrow(TypeError);
  });
});
