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

  describe("one SuspendMicrovm call at a time", () => {
    // The session never sends an idle time under 10 seconds. The run hook
    // accepts any positive number, and with 1 second the idle time can end
    // during a call. The fake client ignores the 10-second abort, so a held
    // call runs until finish(), unless the test sets `deadline`.
    const SHORT_IDLE_SECONDS = 1;
    const SHORT_IDLE_MS = SHORT_IDLE_SECONDS * 1_000;
    let microvms: FakeMicrovmsClient;

    beforeEach(() => {
      microvms = new FakeMicrovmsClient();
      microvms.hold = true;
    });

    // A held call keeps idle() pending. So every test releases its calls,
    // also when an expectation failed.
    afterEach(() => microvms.finish());

    it("starts no second call when a resume hook arrives during the call", async () => {
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      expect(await resumeHook(worker)).toBe(200);
      await advance(SHORT_IDLE_MS * 5);

      expect(microvms.maxRunning).toBe(1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("starts the idle time when the call ends, after a resume hook during the call", async () => {
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      await advance(SHORT_IDLE_MS * 3);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      microvms.finish();
      await advance(0);
      await advance(SHORT_IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(microvms.maxRunning).toBe(1);
    });

    it("starts the idle time when the call ends, after a job ended during the call", async () => {
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      expect(await job(worker, "cb-1")).toBe(202);
      await finishJob("cb-1");
      await advance(SHORT_IDLE_MS * 2);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      microvms.finish();
      await advance(0);
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("does not start the idle time when the call ends while a job runs", async () => {
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      expect(await job(worker, "cb-1")).toBe(202);

      microvms.finish();
      await advance(SHORT_IDLE_MS * 3);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      // The idle time starts when the job ends.
      await finishJob("cb-1");
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("does not start the idle time when the call ends during a suspend hook's refusal", async () => {
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      // Lambda is about to freeze the MicroVM.
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);

      microvms.finish();
      await advance(SHORT_IDLE_MS * 3);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(await job(worker, "cb-1")).toBe(503);
    });

    it("retries a rejected call when a resume hook came during it", async () => {
      // The resume hook asked for the idle time. So the rejection does not
      // stop the retry, as before this change.
      microvms.failure = Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      });
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);

      microvms.finish();
      await advance(0);
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(microvms.maxRunning).toBe(1);
    });

    it("does not retry a later rejected call after a resume hook during an earlier call", async () => {
      // The resume hook during call 1 asks for the idle time at the call end.
      // Call 1 succeeds, and its end clears that request. Call 2 gets no hook
      // and is rejected. A request left set would start the idle time at the
      // end of call 2. Then the worker would retry the rejected call after
      // every idle time.
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      microvms.finish();
      await advance(0);

      microvms.hold = false;
      microvms.failure = Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      });
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);

      await advance(SHORT_IDLE_MS * 5);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("starts the idle time when a call ends at its deadline, after a resume hook during the call", async () => {
      // The worker aborts the call after 10 seconds. The outcome is then
      // unknown. The resume hook has already ended the refusal, so the idle
      // time starts when the call ends.
      const SUSPEND_CALL_TIMEOUT_MS = 10_000;
      microvms.deadline = true;
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(await resumeHook(worker)).toBe(200);

      await advance(SUSPEND_CALL_TIMEOUT_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      // The call ends at its deadline. The idle time starts then.
      await advance(1);
      await advance(SHORT_IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(microvms.maxRunning).toBe(1);
    });
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
      "a conflict",
      Object.assign(new Error("in progress"), {
        name: "ConflictException",
        $metadata: { httpStatusCode: 409 },
      }),
    ],
    [
      // A conflict can mean that the MicroVM is already suspending. So its
      // status does not decide.
      "a conflict with another 4xx status",
      Object.assign(new Error("in progress"), {
        name: "ConflictException",
        $metadata: { httpStatusCode: 400, attempts: 1 },
      }),
    ],
    [
      // The client retried the throttle. An earlier attempt may have
      // suspended the MicroVM.
      "a throttle on a retried attempt",
      Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 400, attempts: 3 },
      }),
    ],
    [
      "a 429 on a retried attempt",
      Object.assign(new Error("slow down"), {
        name: "SomeServiceError",
        $metadata: { httpStatusCode: 429, attempts: 2 },
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
      expect(warn.mock.calls[0][0]).toBe(
        "the suspend call for the idle MicroVM had an unknown outcome. The worker refuses jobs until the MicroVM resumes, or for 30 seconds.",
      );
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

  /** A first-attempt error with this name and HTTP status. */
  const firstAttempt = (name: string, status?: number): Error =>
    Object.assign(new Error(`${name} on the first attempt`), {
      name,
      $metadata: { httpStatusCode: status, attempts: 1 },
    });

  it.each<[string, Error]>([
    [
      "ThrottlingException with HTTP 400",
      firstAttempt("ThrottlingException", 400),
    ],
    [
      "TooManyRequestsException with HTTP 429",
      firstAttempt("TooManyRequestsException", 429),
    ],
    // Some services answer a throttle with a status other than 429. The
    // name decides, whatever the status.
    [
      "ThrottlingException with HTTP 503",
      firstAttempt("ThrottlingException", 503),
    ],
    [
      "ThrottlingException without a status",
      firstAttempt("ThrottlingException"),
    ],
    ["any error with HTTP 429", firstAttempt("SomeServiceError", 429)],
    ["ExpiredToken with HTTP 400", firstAttempt("ExpiredToken", 400)],
    [
      "ExpiredTokenException with HTTP 403",
      firstAttempt("ExpiredTokenException", 403),
    ],
    ["RequestExpired with HTTP 400", firstAttempt("RequestExpired", 400)],
    [
      "InvalidSignatureException with HTTP 403",
      firstAttempt("InvalidSignatureException", 403),
    ],
    [
      "SignatureDoesNotMatch with HTTP 403",
      firstAttempt("SignatureDoesNotMatch", 403),
    ],
    [
      "RequestTimeTooSkewed with HTTP 403",
      firstAttempt("RequestTimeTooSkewed", 403),
    ],
    [
      // The SDK sets $metadata.attempts on a call that it made. Without it,
      // the error counts as a first attempt.
      "ThrottlingException without attempts",
      Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 400 },
      }),
    ],
  ])(
    "accepts jobs at once and tries the call again 30 seconds later, after %s",
    async (_label, failure) => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = failure;
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("refused the call for now");
      expect(warn.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          microvmId: "mvm-1",
          error: { name: failure.name, message: failure.message },
        }),
      );

      // The idle time starts again at once, without a job or a resume hook.
      // It lasts 30 seconds, because the idle time is shorter than that.
      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);

      expect(await job(worker, "cb-1")).toBe(202);
      expect(started).toEqual(["cb-1"]);
    },
  );

  it("logs a rejection for an unlisted 4xx name on the first attempt, and does not retry", async () => {
    // The name is in neither REJECTION_NAMES nor TRANSIENT_4XX_NAMES. So the
    // status decides, and a 400 is a rejection.
    const microvms = new FakeMicrovmsClient();
    microvms.failure = firstAttempt("SomeServiceError", 400);
    const warn = jest.fn();
    const worker = start(microvms, { info: () => {}, warn, error: () => {} });

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("the service rejected the call");
    expect(warn.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        microvmId: "mvm-1",
        error: {
          name: "SomeServiceError",
          message: "SomeServiceError on the first attempt",
        },
      }),
    );

    // No idle time starts, so no second call runs. The wait covers one idle
    // time and the 30-second lower bound of a refusal for now.
    await advance(IDLE_MS + GRACE_MS * 2);
    expect(microvms.suspended).toEqual(["mvm-1"]);
    expect(await job(worker, "cb-1")).toBe(202);
  });

  describe("lower bound after a refusal for now", () => {
    // The session never sends an idle time under 10 seconds. The run hook
    // accepts any positive number. A persistent refusal for now, for example
    // after a wrong secret key, would otherwise repeat the call once per
    // idle time.
    const SHORT_IDLE_SECONDS = 1;
    const SHORT_IDLE_MS = SHORT_IDLE_SECONDS * 1_000;
    const refusal = firstAttempt("InvalidSignatureException", 403);

    it("waits 30 seconds after each refused call when the idle time is shorter", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      const warn = jest.fn();
      const info = jest.fn();
      const worker = start(microvms, { info, warn, error: () => {} });

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(warn.mock.calls[0][0]).toContain(
        "The worker tries the call again after the next idle time. That idle time lasts at least 30 seconds, unless a job or a resume hook starts the idle time again.",
      );

      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      // The info line shows the session's idle time and the real wait.
      expect(info).toHaveBeenCalledWith("suspending the idle MicroVM", {
        microvmId: "mvm-1",
        idleMs: SHORT_IDLE_MS,
        waitedMs: SHORT_IDLE_MS,
      });
      expect(info).toHaveBeenCalledWith("suspending the idle MicroVM", {
        microvmId: "mvm-1",
        idleMs: SHORT_IDLE_MS,
        waitedMs: GRACE_MS,
      });

      // The bound applies after every refused call.
      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toHaveLength(2);
      await advance(1);
      expect(microvms.suspended).toHaveLength(3);
      // One warning per refused call.
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it("waits one idle time when the idle time is longer than 30 seconds", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      const worker = start(microvms);
      const longIdleMs = GRACE_MS * 2;

      await runHook(worker, longIdleMs / 1_000);
      await advance(longIdleMs);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await advance(longIdleMs - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("uses the normal idle time after a job that ends during the 30 seconds", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await advance(GRACE_MS / 3);
      expect(await job(worker, "cb-1")).toBe(202);
      await finishJob("cb-1");

      await advance(SHORT_IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("uses the normal idle time after a resume hook during the 30 seconds", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await advance(GRACE_MS / 3);
      expect(await resumeHook(worker)).toBe(200);

      await advance(SHORT_IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("keeps the 30 seconds after a resume hook that arrived during the refused call", async () => {
      // The resume hook came before the refusal for now. So the refusal
      // decides the next idle time. The worker can start that idle time
      // when the call ends, after the refusal is handled. The bound then
      // still applies.
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      microvms.hold = true;
      const worker = start(microvms);

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("uses the normal idle time after a job that ran across the refused call", async () => {
      // The resume hook during the call ends the refusal, so the job starts
      // during the call. The call is refused for now while the job runs. So
      // no idle time starts then. The job's end starts the normal idle time.
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      microvms.hold = true;
      const worker = start(microvms);

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      await resumeHook(worker);
      expect(await job(worker, "cb-1")).toBe(202);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      await finishJob("cb-1");
      await advance(IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("keeps the 30 seconds after a job that started and ended during the refused call", async () => {
      // The resume hook during the call ends the refusal, so the job starts
      // during the call. The job ends before the refusal for now. So the
      // refusal is the later request, and it decides the next idle time.
      const microvms = new FakeMicrovmsClient();
      microvms.failure = refusal;
      microvms.hold = true;
      const worker = start(microvms);

      await runHook(worker, SHORT_IDLE_SECONDS);
      await advance(SHORT_IDLE_MS);
      await resumeHook(worker);
      expect(await job(worker, "cb-1")).toBe(202);
      await finishJob("cb-1");
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });
  });

  it("keeps a suspend hook's refusal after a call that the service refused for now", async () => {
    // The worker's own call triggers the suspend hook. The refusal that the
    // hook started stays, because the MicroVM is suspending.
    const microvms = new FakeMicrovmsClient();
    microvms.hold = true;
    microvms.failure = firstAttempt("ThrottlingException", 400);
    const warn = jest.fn();
    const worker = start(microvms, { info: () => {}, warn, error: () => {} });

    await runHook(worker, IDLE_SECONDS);
    await advance(IDLE_MS);
    expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
    microvms.finish();
    await advance(0);

    // The warning states the hook's refusal, not a 30-second lower bound.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      "A suspend hook arrived during the call, so this call does not end the hook's refusal. The idle time starts again after the resume hook, or 30 seconds after the last suspend hook.",
    );
    expect(await job(worker, "cb-1")).toBe(503);
    // No idle time started, so no second call runs during the refusal.
    await advance(GRACE_MS - 1);
    expect(microvms.suspended).toEqual(["mvm-1"]);
  });

  describe("warning after a refused call whose refusal already ended", () => {
    // A suspend hook during the call starts a refusal of its own. A resume
    // hook, or the 30-second limit of a call that runs that long, ends it
    // before the call ends. The warning must then not say that jobs are
    // refused.
    const ENDED_WARNING =
      "could not suspend the idle MicroVM, because the service refused the call for now. A suspend hook arrived during the call, and the hook's refusal of jobs ended before the call ended. So the worker accepts jobs. It tries the call again one idle time after the call and every job end.";

    it.each<[string, (worker: MicrovmWorkerListener) => Promise<void>]>([
      [
        "a resume hook",
        async (worker) => {
          expect(await resumeHook(worker)).toBe(200);
        },
      ],
      ["the 30-second limit", () => advance(GRACE_MS)],
    ])(
      "says the refusal ended, and calls again one idle time after the call, when %s ended it",
      async (_label, endRefusal) => {
        const microvms = new FakeMicrovmsClient();
        microvms.hold = true;
        microvms.failure = firstAttempt("ThrottlingException", 400);
        const warn = jest.fn();
        const worker = start(microvms, {
          info: () => {},
          warn,
          error: () => {},
        });

        await runHook(worker, IDLE_SECONDS);
        await advance(IDLE_MS);
        expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
        await endRefusal(worker);
        microvms.finish();
        await advance(0);
        microvms.hold = false;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
        // The idle time started when the call ended. It has the normal
        // length, without the 30-second lower bound.
        await advance(IDLE_MS - 1);
        expect(microvms.suspended).toEqual(["mvm-1"]);
        await advance(1);
        expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      },
    );

    it("accepts jobs, and calls again one idle time after the last job ends", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = firstAttempt("ThrottlingException", 400);
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      expect(await resumeHook(worker)).toBe(200);
      // A job during the call, after the resume hook, runs when the call
      // ends.
      expect(await job(worker, "cb-1")).toBe(202);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      // A job after the refused call is accepted too.
      expect(await job(worker, "cb-2")).toBe(202);
      expect(started).toEqual(["cb-1", "cb-2"]);
      // No call runs while a job runs.
      await advance(GRACE_MS * 2);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await finishJob("cb-1");
      await advance(GRACE_MS * 2);
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await finishJob("cb-2");
      await advance(IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });
  });

  describe("warning after a refused call when the worker stops", () => {
    const refusal = firstAttempt("InvalidSignatureException", 403);

    it.each<[string, string[]]>([
      ["a terminate hook", ["terminate"]],
      // The terminate text also replaces the text for a suspend hook's
      // refusal, because no call follows either way.
      ["a suspend hook and then a terminate hook", ["suspend", "terminate"]],
    ])(
      "says that no call follows after %s during the call, and calls no more",
      async (_label, hooks) => {
        const microvms = new FakeMicrovmsClient();
        microvms.hold = true;
        microvms.failure = refusal;
        const warn = jest.fn();
        const worker = start(microvms, {
          info: () => {},
          warn,
          error: () => {},
        });

        await runHook(worker, IDLE_SECONDS);
        await advance(IDLE_MS);
        for (const hook of hooks) {
          expect(await call(worker, `${HOOK_PATH_PREFIX}${hook}`, {})).toBe(
            200,
          );
        }
        microvms.finish();
        await advance(0);
        microvms.hold = false;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(
          "could not suspend the idle MicroVM, because the service refused the call for now. The MicroVM is terminating, so the worker does not try the call again.",
        );
        expect(await resumeHook(worker)).toBe(200);
        expect(await job(worker, "cb-1")).toBe(503);
        await advance(IDLE_MS + GRACE_MS * 4);
        expect(microvms.suspended).toEqual(["mvm-1"]);
      },
    );

    it("says that no call follows after close() during the call, and calls no more", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = refusal;
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      worker.close();
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "could not suspend the idle MicroVM, because the service refused the call for now. The worker is closed, so it does not try the call again.",
      );
      // The refused call ended the refusal, so the listener accepts jobs.
      expect(await job(worker, "cb-1")).toBe(202);
      await finishJob("cb-1");
      expect(await resumeHook(worker)).toBe(200);
      await advance(IDLE_MS + GRACE_MS * 4);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it.each<[string, string[]]>([
      ["a terminate hook", ["terminate"]],
      // The terminate text also replaces the text for a suspend hook's
      // refusal, because the MicroVM ends instead of suspending.
      ["a suspend hook and then a terminate hook", ["suspend", "terminate"]],
    ])(
      "says that no call follows after a rejection and %s during the call",
      async (_label, hooks) => {
        const microvms = new FakeMicrovmsClient();
        microvms.hold = true;
        microvms.failure = firstAttempt("AccessDeniedException", 403);
        const warn = jest.fn();
        const worker = start(microvms, {
          info: () => {},
          warn,
          error: () => {},
        });

        await runHook(worker, IDLE_SECONDS);
        await advance(IDLE_MS);
        for (const hook of hooks) {
          expect(await call(worker, `${HOOK_PATH_PREFIX}${hook}`, {})).toBe(
            200,
          );
        }
        microvms.finish();
        await advance(0);
        microvms.hold = false;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(
          "could not suspend the idle MicroVM, because the service rejected the call. The MicroVM is terminating, so the worker does not try the call again. A missing permission needs lambda:SuspendMicrovm on the MicroVM image in its execution role.",
        );
        expect(await resumeHook(worker)).toBe(200);
        expect(await job(worker, "cb-1")).toBe(503);
        await advance(IDLE_MS + GRACE_MS * 4);
        expect(microvms.suspended).toEqual(["mvm-1"]);
      },
    );

    it("says that jobs stay refused and no call follows after an unknown outcome and a terminate hook during the call", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = Object.assign(new Error("boom"), {
        name: "InternalServerException",
        $metadata: { httpStatusCode: 500, attempts: 3 },
      });
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}terminate`, {})).toBe(200);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "the suspend call for the idle MicroVM had an unknown outcome. The MicroVM is terminating, so the worker refuses jobs and does not try the call again.",
      );
      // Neither the 30-second limit nor a resume hook ends the refusal.
      await advance(GRACE_MS);
      expect(await job(worker, "cb-1")).toBe(503);
      expect(await resumeHook(worker)).toBe(200);
      expect(await job(worker, "cb-2")).toBe(503);
      expect(started).toEqual([]);
      await advance(IDLE_MS + GRACE_MS * 4);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });
  });

  describe("warning after a rejected call during a suspend hook's refusal", () => {
    // A suspend hook during the call means that the MicroVM is suspending
    // anyway. So a rejection does not end that hook's refusal, and the
    // MicroVM does not keep running.
    it.each<[string, (worker: MicrovmWorkerListener) => Promise<void>]>([
      [
        "the resume hook",
        async (worker) => {
          expect(await resumeHook(worker)).toBe(200);
        },
      ],
      [
        "the 30-second limit",
        async (worker) => {
          await advance(GRACE_MS - 1);
          expect(await job(worker, "cb-2")).toBe(503);
          await advance(1);
        },
      ],
    ])(
      "says that the hook's refusal stays, and refuses jobs until %s",
      async (_label, endRefusal) => {
        const microvms = new FakeMicrovmsClient();
        microvms.hold = true;
        microvms.failure = firstAttempt("AccessDeniedException", 403);
        const warn = jest.fn();
        const worker = start(microvms, {
          info: () => {},
          warn,
          error: () => {},
        });

        await runHook(worker, IDLE_SECONDS);
        await advance(IDLE_MS);
        expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
        microvms.finish();
        await advance(0);
        microvms.hold = false;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(
          "could not suspend the idle MicroVM, because the service rejected the call. A suspend hook arrived during the call, so the MicroVM is suspending anyway. The hook's refusal of jobs stays until the resume hook, or 30 seconds after the last suspend hook. A missing permission needs lambda:SuspendMicrovm on the MicroVM image in its execution role.",
        );
        expect(await job(worker, "cb-1")).toBe(503);
        expect(started).toEqual([]);

        // The end of the refusal starts the idle time again.
        await endRefusal(worker);
        await advance(IDLE_MS - 1);
        expect(microvms.suspended).toEqual(["mvm-1"]);
        await advance(1);
        expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
        // That second call is rejected without a suspend hook, so it ends
        // its own refusal, and jobs run.
        expect(warn).toHaveBeenCalledTimes(2);
        expect(await job(worker, "cb-3")).toBe(202);
        expect(started).toEqual(["cb-3"]);
      },
    );

    it("says that the MicroVM keeps running when a resume hook ended the hook's refusal during the call", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = firstAttempt("AccessDeniedException", 403);
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      expect(await resumeHook(worker)).toBe(200);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "could not suspend the idle MicroVM, because the service rejected the call. It keeps running. A missing permission needs lambda:SuspendMicrovm on the MicroVM image in its execution role.",
      );
      expect(await job(worker, "cb-1")).toBe(202);
      expect(started).toEqual(["cb-1"]);
    });
  });

  describe("warning after an unknown outcome whose refusal already ended", () => {
    // A resume hook during the call ends the refusal of jobs. So does the
    // 30-second limit of a suspend hook's refusal, when the call runs that
    // long. An unknown outcome then starts no new refusal. So the warning
    // must not say that the worker refuses jobs.
    const ENDED_WARNING =
      "the suspend call for the idle MicroVM had an unknown outcome. The refusal of jobs already ended during the call, on a resume hook or after 30 seconds. So the worker accepts jobs. It tries the call again one idle time after the call and every job end.";
    const REFUSING_WARNING =
      "the suspend call for the idle MicroVM had an unknown outcome. The worker refuses jobs until the MicroVM resumes, or for 30 seconds.";
    const SUSPEND_CALL_TIMEOUT_MS = 10_000;
    const serverError = (): Error =>
      Object.assign(new Error("boom"), {
        name: "InternalServerException",
        $metadata: { httpStatusCode: 500, attempts: 3 },
      });

    /**
     * Checks the state after the warning: a job gets 202 at once, and the
     * next call comes one idle time after that job ends, without the
     * 30-second refusal. The next call succeeds.
     */
    const expectAcceptsAndCallsAgain = async (
      worker: MicrovmWorkerListener,
      microvms: FakeMicrovmsClient,
    ): Promise<void> => {
      microvms.hold = false;
      microvms.deadline = false;
      microvms.failure = undefined;
      expect(await job(worker, "cb-1")).toBe(202);
      expect(started).toEqual(["cb-1"]);
      await finishJob("cb-1");
      await advance(IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    };

    it("says that the refusal ended, when a resume hook arrived during a call that ended at its deadline", async () => {
      // The worker's own call suspended the MicroVM, and its answer was lost
      // across the freeze. The resume hook arrives, and the call then ends at
      // its 10-second deadline.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.deadline = true;
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      await advance(SUSPEND_CALL_TIMEOUT_MS);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      expect(warn.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          error: { name: "TimeoutError", message: "The operation was aborted" },
        }),
      );
      await expectAcceptsAndCallsAgain(worker, microvms);
    });

    it("says that the refusal ended, when a suspend hook and then a resume hook arrived during the call", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      expect(await resumeHook(worker)).toBe(200);
      microvms.finish();
      await advance(0);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      await expectAcceptsAndCallsAgain(worker, microvms);
    });

    it("says that the refusal ended, when a suspend hook's 30 seconds ended during a call that outlasted the abort", async () => {
      // The fake client ignores the worker's 10-second abort, as a client
      // from createMicrovmsClient can. A dropped connection then ends the
      // call after the hook's 30 seconds.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      });
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      await advance(GRACE_MS - 1);
      expect(await job(worker, "cb-0")).toBe(503);
      await advance(1);
      // The call still runs. No second call started.
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(warn).not.toHaveBeenCalled();
      microvms.finish();
      await advance(0);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      await expectAcceptsAndCallsAgain(worker, microvms);
    });

    it("starts the idle time when the call ends, after the warning", async () => {
      // Without a job, the idle time that the resume hook asked for starts
      // when the call ends.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      await advance(IDLE_MS * 2);
      microvms.finish();
      await advance(0);
      microvms.hold = false;
      microvms.failure = undefined;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      await advance(IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("tries the call again one idle time after a job that still ran at the outcome ends", async () => {
      // The resume hook ends the refusal, so a job starts during the call.
      // The idle time cannot start while the job runs. So the next call
      // comes one idle time after the job ends, not after the warning.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      expect(await job(worker, "cb-1")).toBe(202);
      microvms.finish();
      await advance(0);
      microvms.hold = false;
      microvms.failure = undefined;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(ENDED_WARNING);
      await advance(GRACE_MS * 2);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await finishJob("cb-1");
      await advance(IDLE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });

    it("keeps the refusal text, when a resume hook and then a suspend hook arrived during the call", async () => {
      // The resume hook ends the refusal. The suspend hook starts a new one.
      // That refusal is in effect at the outcome. So it lasts 30 seconds
      // from the end of the call.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      await advance(5_000);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(REFUSING_WARNING);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(GRACE_MS - 1);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(1);
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("keeps the refusal text, when the call ends while the second of two suspend hooks still refuses jobs", async () => {
      // The fake client ignores the worker's 10-second abort, as a client
      // from createMicrovmsClient can. The second suspend hook replaces the
      // first hook's 30 seconds. So the refusal is still in effect when the
      // call ends, 40 seconds after the first hook.
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      await advance(20_000);
      expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(200);
      await advance(20_000);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(REFUSING_WARNING);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(GRACE_MS - 1);
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(1);
      expect(await job(worker, "cb-1")).toBe(202);
    });

    it("says that no call follows, when close() and a resume hook came during the call", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      worker.close();
      expect(await resumeHook(worker)).toBe(200);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "the suspend call for the idle MicroVM had an unknown outcome. The refusal of jobs already ended during the call, on a resume hook or after 30 seconds. So the worker accepts jobs. The worker is closed, so it does not try the call again.",
      );
      expect(await job(worker, "cb-1")).toBe(202);
      await finishJob("cb-1");
      await advance(IDLE_MS + GRACE_MS * 4);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("keeps the terminating text, when a resume hook and then a terminate hook came during the call", async () => {
      const microvms = new FakeMicrovmsClient();
      microvms.hold = true;
      microvms.failure = serverError();
      const warn = jest.fn();
      const worker = start(microvms, { info: () => {}, warn, error: () => {} });

      await runHook(worker, IDLE_SECONDS);
      await advance(IDLE_MS);
      expect(await resumeHook(worker)).toBe(200);
      expect(await call(worker, `${HOOK_PATH_PREFIX}terminate`, {})).toBe(200);
      microvms.finish();
      await advance(0);
      microvms.hold = false;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "the suspend call for the idle MicroVM had an unknown outcome. The MicroVM is terminating, so the worker refuses jobs and does not try the call again.",
      );
      expect(await job(worker, "cb-1")).toBe(503);
      await advance(IDLE_MS + GRACE_MS * 4);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it.each<[string, (worker: MicrovmWorkerListener) => Promise<void>]>([
      ["no hook", async () => {}],
      [
        "a suspend hook whose refusal is still in effect",
        async (worker) => {
          expect(await call(worker, `${HOOK_PATH_PREFIX}suspend`, {})).toBe(
            200,
          );
        },
      ],
      [
        "close() without a resume hook",
        async (worker) => {
          worker.close();
        },
      ],
    ])(
      "keeps the refusal text, and refuses jobs for 30 seconds after the call, after %s during the call",
      async (_label, duringCall) => {
        const microvms = new FakeMicrovmsClient();
        microvms.hold = true;
        microvms.failure = serverError();
        const warn = jest.fn();
        const worker = start(microvms, {
          info: () => {},
          warn,
          error: () => {},
        });

        await runHook(worker, IDLE_SECONDS);
        await advance(IDLE_MS);
        await duringCall(worker);
        microvms.finish();
        await advance(0);
        microvms.hold = false;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe(REFUSING_WARNING);
        expect(await job(worker, "cb-1")).toBe(503);
        await advance(GRACE_MS - 1);
        expect(await job(worker, "cb-1")).toBe(503);
        await advance(1);
        expect(await job(worker, "cb-1")).toBe(202);
      },
    );
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
