import type { LambdaClient } from "@aws-sdk/client-lambda";
import { LambdaMicrovmsClient } from "@aws-sdk/client-lambda-microvms";
import {
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  InvalidRunHookPayloadError,
  type MicrovmWorkerListener,
  type MicrovmWorkerLogger,
  parseRunHookRequest,
} from "..";
import { advance, call, FakeMicrovmsClient } from "./helpers";

/** Completes every callback call, and records nothing. */
const lambdaClient = {
  send: async (): Promise<unknown> => ({}),
} as unknown as LambdaClient;

const IDLE_SECONDS = 10;
const IDLE_MS = IDLE_SECONDS * 1_000;
/** The worker's refusal period after a successful SuspendMicrovm call. */
const GRACE_MS = 30_000;

describe("auto-suspend when idle", () => {
  let target: MicrovmWorkerListener | undefined;
  let started: string[];
  let releases: Map<string, () => void>;

  beforeEach(() => {
    // The requests go straight to the listener, so no socket timer runs.
    // Stream reads use nextTick and microtasks, which stay real.
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    started = [];
    releases = new Map();
  });

  afterEach(async () => {
    target?.close();
    for (const release of releases.values()) {
      release();
    }
    await jest.runOnlyPendingTimersAsync();
    await target?.idle();
    target = undefined;
    jest.useRealTimers();
  });

  const start = (
    microvms: FakeMicrovmsClient,
    logger?: MicrovmWorkerLogger,
  ): MicrovmWorkerListener => {
    target = createMicrovmWorkerListener({
      routes: {
        "/job": (_input, context) => {
          started.push(context.callbackId);
          return new Promise((resolve) => {
            releases.set(context.callbackId, () => resolve("done"));
          });
        },
      },
      createClient: () => lambdaClient,
      createMicrovmsClient: () => microvms.asClient(),
      logger: logger ?? { info: () => {}, warn: () => {}, error: () => {} },
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

  const resumeHook = (worker: MicrovmWorkerListener) =>
    call(worker, `${HOOK_PATH_PREFIX}resume`, {});

  const job = (worker: MicrovmWorkerListener, callbackId: string) =>
    call(worker, "/job", {
      version: 1,
      region: "us-east-1",
      callbackId,
      input: {},
    });

  /** Ends a running job, and lets it report its outcome. */
  const finishJob = async (callbackId: string): Promise<void> => {
    releases.get(callbackId)?.();
    releases.delete(callbackId);
    await advance(0);
  };

  it("suspends its own MicroVM after the idle time when no job arrives", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS - 1);
    expect(microvms.suspended).toEqual([]);

    await advance(1);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("destroys the default client after each suspend, and never a provided one", async () => {
    const send = jest
      .spyOn(LambdaMicrovmsClient.prototype, "send")
      .mockImplementation(async () => ({}));
    const destroy = jest.spyOn(LambdaMicrovmsClient.prototype, "destroy");
    try {
      // No createMicrovmsClient, so the worker creates the client itself.
      target = createMicrovmWorkerListener({
        handler: async () => "done",
        createClient: () => lambdaClient,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      await runHook(target, IDLE_SECONDS);
      await advance(IDLE_MS);

      expect(send).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      destroy.mockRestore();
    }

    const microvms = new FakeMicrovmsClient();
    target.close();
    const worker = start(microvms);
    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);

    expect(microvms.suspended).toEqual(["mvm-1"]);
    expect(microvms.destroy).not.toHaveBeenCalled();
  });

  it("never suspends when the run hook payload does not ask for it", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker);
    await advance(IDLE_MS * 10);

    expect(microvms.suspended).toEqual([]);
  });

  it("does not suspend while a job runs, and suspends one idle time after it ends", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    expect(await job(worker, "cb-1")).toBe(202);
    await advance(IDLE_MS * 4);
    expect(microvms.suspended).toEqual([]);

    await finishJob("cb-1");
    await advance(IDLE_MS - 1);
    expect(microvms.suspended).toEqual([]);
    await advance(1);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("suspends with the run hook's ID after a job that arrived first with another ID", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    expect(
      await call(worker, "/job", {
        version: 1,
        region: "us-east-1",
        callbackId: "cb-1",
        microvmId: "mvm-from-job",
        input: {},
      }),
    ).toBe(202);
    await runHook(worker, IDLE_SECONDS);
    // The run hook arrived while the job runs, so the idle time waits.
    await advance(IDLE_MS * 2);
    expect(microvms.suspended).toEqual([]);

    await finishJob("cb-1");
    await advance(IDLE_MS);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("keeps the first run hook's suspend target when a later run hook has another ID", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    // A second run hook should not happen. Without autoSuspendIdleSeconds,
    // it keeps the first one's settings.
    await call(worker, `${HOOK_PATH_PREFIX}run`, {
      microvmId: "mvm-2",
      runHookPayload: JSON.stringify({ version: 1, region: "us-east-1" }),
    });
    await advance(IDLE_MS);

    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("ignores a later run hook that asks to suspend another MicroVM", async () => {
    // The endpoint forwards the hook path from any caller with an auth
    // token. SuspendMicrovm authorizes on the image, so the later hook must
    // not choose the suspend target.
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker);
    const status = await call(worker, `${HOOK_PATH_PREFIX}run`, {
      microvmId: "mvm-2",
      runHookPayload: JSON.stringify({
        version: 1,
        region: "us-east-1",
        autoSuspendIdleSeconds: IDLE_SECONDS,
      }),
    });
    await advance(IDLE_MS * 2);

    expect(status).toBe(200);
    expect(microvms.suspended).toEqual([]);
  });

  it("accepts a valid run hook after an invalid one", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    const invalid = await call(worker, `${HOOK_PATH_PREFIX}run`, {});
    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);

    expect(invalid).toBe(400);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("starts the idle time again when a job arrives before it ends", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS / 2);
    await job(worker, "cb-1");
    await finishJob("cb-1");
    // The first idle time would have ended here.
    await advance(IDLE_MS / 2);
    expect(microvms.suspended).toEqual([]);

    await advance(IDLE_MS / 2);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("does not suspend while one of two parallel jobs still runs", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await job(worker, "cb-1");
    await job(worker, "cb-2");
    await finishJob("cb-1");
    await advance(IDLE_MS * 4);
    expect(microvms.suspended).toEqual([]);

    await finishJob("cb-2");
    await advance(IDLE_MS);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("refuses a job with 503 while its SuspendMicrovm call runs", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.hold = true;
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    expect(microvms.suspended).toEqual(["mvm-1"]);

    expect(await job(worker, "cb-1")).toBe(503);
    expect(started).toEqual([]);
    microvms.finish();
  });

  it("refuses jobs after the call returned, until the resume hook arrives", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    expect(await job(worker, "cb-1")).toBe(503);

    expect(await resumeHook(worker)).toBe(200);
    expect(await job(worker, "cb-1")).toBe(202);
    expect(started).toEqual(["cb-1"]);

    // The idle time starts again after the job.
    await finishJob("cb-1");
    await advance(IDLE_MS);
    expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
  });

  it("accepts jobs again 30 seconds after the call when no resume hook arrives", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    await advance(GRACE_MS - 1);
    expect(await job(worker, "cb-1")).toBe(503);

    await advance(1);
    expect(await job(worker, "cb-1")).toBe(202);
    expect(started).toEqual(["cb-1"]);
  });

  it("starts the idle time again at the end of the 30-second refusal", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS + GRACE_MS);
    expect(microvms.suspended).toEqual(["mvm-1"]);

    await advance(IDLE_MS);
    expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
  });

  it("suspends again one idle time after a resume that brings no job", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    await resumeHook(worker);
    await advance(IDLE_MS - 1);
    expect(microvms.suspended).toEqual(["mvm-1"]);

    await advance(1);
    expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
  });

  it("accepts jobs at once when the resume hook arrives during the call", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.hold = true;
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    await resumeHook(worker);
    expect(await job(worker, "cb-1")).toBe(202);

    // The call returns after the resume. It must not start a new refusal.
    microvms.finish();
    await advance(0);
    expect(await job(worker, "cb-2")).toBe(202);
    expect(started).toEqual(["cb-1", "cb-2"]);
  });

  it("does not start a second idle time while it suspends", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.hold = true;
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    // A repeated run hook without a job would otherwise start the idle time.
    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS * 2);

    expect(microvms.suspended).toEqual(["mvm-1"]);
    microvms.finish();
  });

  it("logs a failed suspend, accepts jobs at once, and does not retry until a job ends", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.failure = Object.assign(new Error("not authorized"), {
      name: "AccessDeniedException",
    });
    const warn = jest.fn();
    const worker = start(microvms, {
      info: () => {},
      warn,
      error: () => {},
    });

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS * 6);

    expect(microvms.suspended).toEqual(["mvm-1"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("lambda:SuspendMicrovm");
    expect(warn.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        microvmId: "mvm-1",
        error: { name: "AccessDeniedException", message: "not authorized" },
      }),
    );
    expect(await job(worker, "cb-1")).toBe(202);
  });

  it("accepts jobs at once when the service rejects the call by status", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.failure = Object.assign(new Error("denied"), {
      name: "SomeServiceError",
      $metadata: { httpStatusCode: 403 },
    });
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);

    expect(await job(worker, "cb-1")).toBe(202);
  });

  it.each<[string, Error]>([
    [
      "a timeout",
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    ],
    [
      "a throttle",
      Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 429 },
      }),
    ],
    [
      "a conflict",
      Object.assign(new Error("in progress"), {
        name: "ConflictException",
        $metadata: { httpStatusCode: 409 },
      }),
    ],
    [
      "a server error",
      Object.assign(new Error("boom"), {
        name: "InternalServerException",
        $metadata: { httpStatusCode: 500 },
      }),
    ],
    [
      "a request timeout status",
      Object.assign(new Error("request timeout"), {
        name: "RequestTimeoutException",
        $metadata: { httpStatusCode: 408 },
      }),
    ],
    [
      // The client retried a 5xx. The first attempt may have suspended the
      // MicroVM, and the retry then fails validation.
      "a rejection on a retried attempt",
      Object.assign(new Error("not running"), {
        name: "ValidationException",
        $metadata: { httpStatusCode: 400, attempts: 2 },
      }),
    ],
    [
      "a non-Error value with a 4xx status",
      {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      } as unknown as Error,
    ],
  ])(
    "keeps refusing jobs after %s, because the MicroVM may freeze",
    async (_label, failure) => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = failure;
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(warn.mock.calls[0][0]).toContain("unknown outcome");
      expect(await job(worker, "cb-1")).toBe(503);

      await advance(GRACE_MS);
      expect(await job(worker, "cb-1")).toBe(202);
    },
  );

  it.each<[string, Error]>([
    [
      "missing credentials",
      Object.assign(new Error("no credentials"), {
        name: "CredentialsProviderError",
      }),
    ],
    [
      "a rejection on the first attempt",
      Object.assign(new Error("invalid"), {
        name: "ValidationException",
        $metadata: { httpStatusCode: 400, attempts: 1 },
      }),
    ],
  ])("accepts jobs at once after %s", async (_label, failure) => {
    const microvms = new FakeMicrovmsClient();
    microvms.failure = failure;
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);

    expect(await job(worker, "cb-1")).toBe(202);
  });

  it("tries the call again one idle time after the refusal that an unknown outcome started", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.failure = Object.assign(new Error("boom"), {
      name: "InternalServerException",
      $metadata: { httpStatusCode: 500, attempts: 3 },
    });
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS + GRACE_MS + IDLE_MS - 1);
    expect(microvms.suspended).toEqual(["mvm-1"]);

    await advance(1);
    expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
  });

  it("starts the idle time on a resume hook that no suspend preceded", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await job(worker, "cb-1");
    await finishJob("cb-1");
    await advance(IDLE_MS / 2);
    // An idle policy can resume the MicroVM. The hook starts the idle time
    // again from zero.
    await resumeHook(worker);
    await advance(IDLE_MS / 2);
    expect(microvms.suspended).toEqual([]);
    await advance(IDLE_MS / 2);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("never suspends after close()", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    worker.close();
    await advance(IDLE_MS * 4);

    expect(microvms.suspended).toEqual([]);
  });

  it("does not start the idle time when a job ends after close()", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await job(worker, "cb-1");
    worker.close();
    await finishJob("cb-1");
    await advance(IDLE_MS * 4);

    expect(microvms.suspended).toEqual([]);
  });

  it("ends a refusal after close() 30 seconds after the call", async () => {
    const microvms = new FakeMicrovmsClient();
    microvms.hold = true;
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    worker.close();
    microvms.finish();
    await advance(0);
    expect(await job(worker, "cb-1")).toBe(503);

    await advance(GRACE_MS);
    expect(await job(worker, "cb-1")).toBe(202);
    // The closed listener does not suspend again.
    await finishJob("cb-1");
    await advance(IDLE_MS * 4);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  it("ends a refusal 30 seconds after the call when close() comes after the call", async () => {
    const microvms = new FakeMicrovmsClient();
    const worker = start(microvms);

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    // The call has returned, and its grace timer runs.
    worker.close();
    expect(await job(worker, "cb-1")).toBe(503);

    await advance(GRACE_MS);
    expect(await job(worker, "cb-1")).toBe(202);
  });
});

describe("parseRunHookRequest autoSuspendIdleSeconds", () => {
  const body = (value: unknown) => ({
    microvmId: "mvm-1",
    runHookPayload: JSON.stringify({
      version: 1,
      region: "us-east-1",
      autoSuspendIdleSeconds: value,
    }),
  });

  it("accepts a positive number", () => {
    expect(parseRunHookRequest(body(60)).payload?.autoSuspendIdleSeconds).toBe(
      60,
    );
  });

  it.each([0, -1, "60", null])("rejects %p", (value) => {
    expect(() => parseRunHookRequest(body(value))).toThrow(
      InvalidRunHookPayloadError,
    );
  });
});
