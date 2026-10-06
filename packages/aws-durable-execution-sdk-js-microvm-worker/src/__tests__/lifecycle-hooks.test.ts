import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import {
  type LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";
import {
  type LambdaMicrovmsClient,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  type MicrovmWorkerListener,
  MicrovmTerminatedError,
} from "..";

/** The headers of Lambda's own hook calls, as measured in us-east-1. */
const LAMBDA_HEADERS: IncomingHttpHeaders = { host: "localhost:8080" };

/** The headers of a request that the MicroVM endpoint forwarded. */
const FORWARDED_HEADERS: IncomingHttpHeaders = {
  host: "7ed0892b.lambda-microvm.us-east-1.on.aws",
  "x-amzn-requestid": "6f1c0e0a-0000-4000-8000-000000000000",
};

type Completion =
  | { kind: "success"; callbackId: string }
  | {
      kind: "failure";
      callbackId: string;
      errorType?: string;
      message?: string;
    };

/**
 * Records callback completions. With `hold`, each completion stays pending
 * until `finish()`.
 */
class FakeLambdaClient {
  readonly completions: Completion[] = [];
  hold = false;
  private pending: (() => void)[] = [];

  async send(command: unknown): Promise<unknown> {
    if (command instanceof SendDurableExecutionCallbackHeartbeatCommand) {
      return {};
    }
    if (this.hold) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
    if (command instanceof SendDurableExecutionCallbackSuccessCommand) {
      this.completions.push({
        kind: "success",
        callbackId: command.input.CallbackId as string,
      });
      return {};
    }
    if (command instanceof SendDurableExecutionCallbackFailureCommand) {
      this.completions.push({
        kind: "failure",
        callbackId: command.input.CallbackId as string,
        errorType: command.input.Error?.ErrorType,
        message: command.input.Error?.ErrorMessage,
      });
      return {};
    }
    throw new Error("unexpected command");
  }

  finish(): void {
    for (const resolve of this.pending.splice(0)) {
      resolve();
    }
  }

  asClient(): LambdaClient {
    return this as unknown as LambdaClient;
  }
}

/**
 * Records SuspendMicrovm calls. With `hold`, each call stays pending until
 * `finish()`, and then fails with `failure` when it is set.
 */
class FakeMicrovmsClient {
  readonly suspended: string[] = [];
  failure: Error | undefined;
  hold = false;
  private pending: (() => void) | undefined;

  async send(command: unknown): Promise<unknown> {
    if (!(command instanceof SuspendMicrovmCommand)) {
      throw new Error("unexpected command");
    }
    this.suspended.push(command.input.microvmIdentifier as string);
    if (this.hold) {
      await new Promise<void>((resolve) => {
        this.pending = resolve;
      });
    }
    if (this.failure) {
      throw this.failure;
    }
    return {};
  }

  finish(): void {
    this.pending?.();
    this.pending = undefined;
  }

  asClient(): LambdaMicrovmsClient {
    return this as unknown as LambdaMicrovmsClient;
  }
}

/** Sends one request to the listener, and resolves with the status. */
const call = (
  target: MicrovmWorkerListener,
  path: string,
  body: unknown,
  headers: IncomingHttpHeaders = LAMBDA_HEADERS,
): Promise<number> =>
  new Promise((resolve) => {
    const request = Object.assign(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      { url: path, method: "POST", headers },
    );
    let status = 0;
    const response = {
      headersSent: false,
      writeHead(code: number) {
        status = code;
        this.headersSent = true;
        return this;
      },
      end() {
        resolve(status);
        return this;
      },
    };
    target.listener(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });

/** Advances fake time, and lets the promises that it releases settle. */
const advance = (ms: number): Promise<void> =>
  jest.advanceTimersByTimeAsync(ms);

describe("suspend and terminate hooks", () => {
  let target: MicrovmWorkerListener | undefined;
  let lambda: FakeLambdaClient;
  let microvms: FakeMicrovmsClient;
  let signals: Map<string, AbortSignal>;
  let releases: Map<string, () => void>;

  beforeEach(() => {
    // The requests go straight to the listener, so no socket timer runs.
    // Stream reads use nextTick and microtasks, which stay real.
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    lambda = new FakeLambdaClient();
    microvms = new FakeMicrovmsClient();
    signals = new Map();
    releases = new Map();
  });

  afterEach(async () => {
    target?.close();
    lambda.hold = false;
    lambda.finish();
    microvms.finish();
    for (const release of releases.values()) {
      release();
    }
    await jest.runOnlyPendingTimersAsync();
    await target?.idle();
    target = undefined;
    jest.useRealTimers();
  });

  const start = (warn: jest.Mock = jest.fn()): MicrovmWorkerListener => {
    target = createMicrovmWorkerListener({
      routes: {
        "/job": (_input, context) => {
          signals.set(context.callbackId, context.signal);
          return new Promise((resolve) => {
            releases.set(context.callbackId, () => resolve("done"));
          });
        },
      },
      createClient: () => lambda.asClient(),
      createMicrovmsClient: () => microvms.asClient(),
      logger: { info: () => {}, warn, error: () => {} },
    });
    return target;
  };

  const runHook = (worker: MicrovmWorkerListener, idleSeconds?: number) =>
    call(worker, `${HOOK_PATH_PREFIX}run`, {
      microvmId: "mvm-1",
      runHookPayload: JSON.stringify({
        version: 1,
        region: "us-east-1",
        ...(idleSeconds !== undefined && {
          autoSuspendIdleSeconds: idleSeconds,
        }),
      }),
    });

  const hook = (
    worker: MicrovmWorkerListener,
    name: string,
    headers: IncomingHttpHeaders = LAMBDA_HEADERS,
  ) => call(worker, `${HOOK_PATH_PREFIX}${name}`, {}, headers);

  const job = (worker: MicrovmWorkerListener, callbackId: string) =>
    call(worker, "/job", {
      version: 1,
      region: "us-east-1",
      callbackId,
      input: {},
    });

  const finishJob = async (callbackId: string): Promise<void> => {
    releases.get(callbackId)?.();
    releases.delete(callbackId);
    await advance(0);
  };

  describe("terminate", () => {
    it("fails each running job's callback, and aborts its signal", async () => {
      const worker = start();
      await runHook(worker);
      expect(await job(worker, "cb-1")).toBe(202);
      expect(await job(worker, "cb-2")).toBe(202);

      expect(await hook(worker, "terminate")).toBe(200);

      expect(lambda.completions).toEqual([
        {
          kind: "failure",
          callbackId: "cb-1",
          errorType: "MicrovmTerminatedError",
          message: "the MicroVM was terminated while the job ran",
        },
        {
          kind: "failure",
          callbackId: "cb-2",
          errorType: "MicrovmTerminatedError",
          message: "the MicroVM was terminated while the job ran",
        },
      ]);
      expect(signals.get("cb-1")?.aborted).toBe(true);
      expect(signals.get("cb-1")?.reason).toBeInstanceOf(
        MicrovmTerminatedError,
      );
    });

    it("reports nothing more when the handler returns after the hook", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await hook(worker, "terminate");

      await finishJob("cb-1");
      await worker.idle();

      expect(lambda.completions).toHaveLength(1);
      expect(lambda.completions[0].kind).toBe("failure");
    });

    it("answers after the reports end", async () => {
      lambda.hold = true;
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      let status = 0;
      void hook(worker, "terminate").then((code) => {
        status = code;
      });
      await advance(1_000);
      expect(status).toBe(0);

      lambda.finish();
      await advance(0);
      expect(status).toBe(200);
      expect(lambda.completions).toHaveLength(1);
    });

    it("answers after 5 seconds when a report stalls", async () => {
      lambda.hold = true;
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      let status = 0;
      void hook(worker, "terminate").then((code) => {
        status = code;
      });
      await advance(4_999);
      expect(status).toBe(0);

      await advance(1);
      expect(status).toBe(200);
    });

    it("waits for a job that is reporting its own outcome", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      lambda.hold = true;
      await finishJob("cb-1");

      let status = 0;
      void hook(worker, "terminate").then((code) => {
        status = code;
      });
      await advance(1_000);
      expect(status).toBe(0);

      lambda.finish();
      await advance(0);
      expect(status).toBe(200);
      expect(lambda.completions).toEqual([
        { kind: "success", callbackId: "cb-1" },
      ]);
    });

    it("answers at once when no job runs", async () => {
      const worker = start();
      await runHook(worker);

      expect(await hook(worker, "terminate")).toBe(200);
      expect(lambda.completions).toEqual([]);
    });

    it("fails a job once when the hook arrives twice", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      await hook(worker, "terminate");
      await hook(worker, "terminate");

      expect(lambda.completions).toHaveLength(1);
    });

    it("refuses jobs with 503 after the hook", async () => {
      const worker = start();
      await runHook(worker);
      await hook(worker, "terminate");

      expect(await job(worker, "cb-1")).toBe(503);
      expect(signals.has("cb-1")).toBe(false);
    });

    it("never suspends after the hook", async () => {
      const worker = start();
      await runHook(worker, 10);
      await hook(worker, "terminate");

      await advance(60_000);
      expect(microvms.suspended).toEqual([]);
    });

    it.each([
      ["a forwarded request", FORWARDED_HEADERS],
      [
        "a request with a request ID",
        { ...LAMBDA_HEADERS, "x-amzn-requestid": "r-1" },
      ],
      ["a request without a Host header", {}],
    ])("ignores %s", async (_name, headers) => {
      const warn = jest.fn();
      const worker = start(warn);
      await runHook(worker);
      await job(worker, "cb-1");

      expect(await hook(worker, "terminate", headers)).toBe(200);

      expect(lambda.completions).toEqual([]);
      expect(signals.get("cb-1")?.aborted).toBe(false);
      expect(await job(worker, "cb-2")).toBe(202);
      expect(warn).toHaveBeenCalledWith(
        "lifecycle hook ignored: it did not come from Lambda",
        expect.objectContaining({ hook: "terminate" }),
      );
      await finishJob("cb-1");
      expect(lambda.completions).toEqual([
        { kind: "success", callbackId: "cb-1" },
      ]);
    });

    it.each(["127.0.0.1:8080", "localhost", "[::1]:8080"])(
      "accepts Host: %s",
      async (host) => {
        const worker = start();
        await runHook(worker);
        await job(worker, "cb-1");

        await hook(worker, "terminate", { host });

        expect(lambda.completions).toHaveLength(1);
      },
    );
  });

  describe("suspend", () => {
    it("refuses jobs with 503 until the resume hook", async () => {
      const worker = start();
      await runHook(worker);

      expect(await hook(worker, "suspend")).toBe(200);
      expect(await job(worker, "cb-1")).toBe(503);

      await hook(worker, "resume");
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("accepts jobs again 30 seconds after the hook without a resume", async () => {
      const worker = start();
      await runHook(worker);
      await hook(worker, "suspend");

      await advance(29_999);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(1);
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("leaves running jobs running", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      await hook(worker, "suspend");
      await finishJob("cb-1");

      expect(signals.get("cb-1")?.aborted).toBe(false);
      expect(lambda.completions).toEqual([
        { kind: "success", callbackId: "cb-1" },
      ]);
    });

    it("ignores a forwarded request", async () => {
      const worker = start();
      await runHook(worker);

      expect(await hook(worker, "suspend", FORWARDED_HEADERS)).toBe(200);
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("stops the idle time, and starts it again after the resume hook", async () => {
      const worker = start();
      await runHook(worker, 10);
      await advance(5_000);
      await hook(worker, "suspend");

      await advance(20_000);
      expect(microvms.suspended).toEqual([]);

      await hook(worker, "resume");
      await advance(10_000);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("keeps the refusal when the hook arrives during the worker's own call that the service rejects", async () => {
      // The worker's own SuspendMicrovm call triggers the suspend hook. A
      // rejection of a retried call, or of a concurrent one, must not end the
      // refusal that the hook started, because the MicroVM is suspending.
      microvms.hold = true;
      microvms.failure = Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
      });
      const worker = start();
      await runHook(worker, 10);
      await advance(10_000);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await hook(worker, "suspend");
      microvms.finish();
      await advance(0);

      expect(await job(worker, "cb-1")).toBe(503);
      await hook(worker, "resume");
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("ends the refusal at once when the service rejects the worker's own call and no hook came", async () => {
      microvms.failure = Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
      });
      const worker = start();
      await runHook(worker, 10);
      await advance(10_000);

      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("keeps one 30-second refusal when the hook follows the worker's own call", async () => {
      const worker = start();
      await runHook(worker, 10);
      await advance(10_000);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await advance(5_000);
      await hook(worker, "suspend");

      // The hook started a new 30-second refusal 5 seconds after the call's.
      await advance(25_000);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(5_000);
      expect(await job(worker, "cb-1")).toBe(202);
    });
  });
});
