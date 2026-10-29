import { PassThrough } from "node:stream";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  createMicrovmWorkerListener,
  HOOK_PATH_PREFIX,
  type MicrovmWorkerListener,
} from "..";
import {
  advance,
  call,
  callWithHeaders,
  callWithStream,
  FakeMicrovmsClient,
} from "./helpers";

const IDLE_SECONDS = 10;
const IDLE_MS = IDLE_SECONDS * 1_000;
/** The worker's refusal period after a successful SuspendMicrovm call. */
const GRACE_MS = 30_000;
const ACK = { "X-Microvm-Suspend-After": "accepted" };

/**
 * Records each callback call as `<command>:<callbackId>`. With `hold`, each
 * call stays pending until `release()`. So a test controls when a report
 * ends.
 */
class FakeLambda {
  readonly sent: string[] = [];
  hold = false;
  private pending: (() => void)[] = [];

  async send(command: {
    constructor: { name: string };
    input: { CallbackId?: string };
  }): Promise<unknown> {
    this.sent.push(`${command.constructor.name}:${command.input.CallbackId}`);
    if (this.hold) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
    return {};
  }

  /** Lets every held call return. */
  release(): void {
    for (const resolve of this.pending.splice(0)) {
      resolve();
    }
  }

  asClient(): LambdaClient {
    return this as unknown as LambdaClient;
  }
}

const WAIT_WARNING =
  "a job asked to suspend the MicroVM before the run hook arrived. The worker waits for the run hook to name the MicroVM.";

describe("suspend after a job", () => {
  let target: MicrovmWorkerListener | undefined;
  let releases: Map<string, (fail?: boolean) => void>;
  let microvms: FakeMicrovmsClient;
  let lambda: FakeLambda;
  let info: jest.Mock;
  let warn: jest.Mock;

  beforeEach(() => {
    // The requests go straight to the listener, so no socket timer runs.
    // Stream reads use nextTick and microtasks, which stay real.
    jest.useFakeTimers({
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
    releases = new Map();
    microvms = new FakeMicrovmsClient();
    lambda = new FakeLambda();
    info = jest.fn();
    warn = jest.fn();
  });

  afterEach(async () => {
    target?.close();
    lambda.release();
    microvms.finish();
    for (const release of releases.values()) {
      release();
    }
    await jest.runOnlyPendingTimersAsync();
    await target?.idle();
    target = undefined;
    jest.useRealTimers();
  });

  const start = (): MicrovmWorkerListener => {
    target = createMicrovmWorkerListener({
      handler: async () => "run hook job done",
      routes: {
        "/job": (_input, context) =>
          new Promise((resolve, reject) => {
            releases.set(context.callbackId, (fail) =>
              fail ? reject(new Error("job failed")) : resolve("done"),
            );
          }),
      },
      createClient: () => lambda.asClient(),
      createMicrovmsClient: () => microvms.asClient(),
      logger: { info, warn, error: () => {} },
    });
    return target;
  };

  const runHookBody = (idleSeconds?: number) => ({
    microvmId: "mvm-1",
    runHookPayload: JSON.stringify({
      version: 1,
      region: "us-east-1",
      ...(idleSeconds !== undefined && {
        autoSuspendIdleSeconds: idleSeconds,
      }),
    }),
  });

  const runHook = (worker: MicrovmWorkerListener, idleSeconds?: number) =>
    call(worker, `${HOOK_PATH_PREFIX}run`, runHookBody(idleSeconds));

  const hook = (worker: MicrovmWorkerListener, name: string) =>
    call(worker, `${HOOK_PATH_PREFIX}${name}`, {});

  const job = (
    worker: MicrovmWorkerListener,
    callbackId: string,
    fields: Record<string, unknown> = { suspendAfter: true },
  ) =>
    callWithHeaders(worker, "/job", {
      version: 1,
      region: "us-east-1",
      callbackId,
      // A job request names a MicroVM. The worker must never suspend it.
      microvmId: "mvm-from-job",
      input: {},
      ...fields,
    });

  /** Ends a running job, and lets it report its outcome. */
  const finishJob = async (callbackId: string, fail = false): Promise<void> => {
    releases.get(callbackId)?.(fail);
    releases.delete(callbackId);
    await advance(0);
  };

  const infoMessages = (): string[] => info.mock.calls.map(([m]) => m);

  describe("the acknowledgement", () => {
    it("answers a job with suspendAfter: true with 202 and the header", async () => {
      const worker = start();
      await runHook(worker);

      const answer = await job(worker, "cb-1");

      expect(answer.status).toBe(202);
      expect(answer.headers).toMatchObject(ACK);
    });

    it.each<[string, Record<string, unknown>]>([
      ["no field", {}],
      ["false", { suspendAfter: false }],
      ['the string "true"', { suspendAfter: "true" }],
      ["the number 1", { suspendAfter: 1 }],
      ["null", { suspendAfter: null }],
    ])("ignores %s: no header, and no suspend", async (_label, fields) => {
      const worker = start();
      await runHook(worker);

      const answer = await job(worker, "cb-1", fields);
      await finishJob("cb-1");
      await advance(GRACE_MS);

      expect(answer.status).toBe(202);
      expect(answer.headers).not.toHaveProperty("X-Microvm-Suspend-After");
      expect(microvms.suspended).toEqual([]);
    });

    it("answers a second delivery of the job with 202 and the header, while the job runs and after the suspend", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      const whileRunning = await job(worker, "cb-1");
      await finishJob("cb-1");
      const whileSuspending = await job(worker, "cb-1");

      expect(whileRunning).toEqual({
        status: 202,
        headers: expect.objectContaining(ACK),
      });
      // The worker refuses new jobs now. A second delivery starts no job.
      expect(whileSuspending).toEqual({
        status: 202,
        headers: expect.objectContaining(ACK),
      });
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("answers a second delivery of the running job with 503 and no header during a suspend hook refusal, and with 202 and the header after the resume hook", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await hook(worker, "suspend");

      const refused = await job(worker, "cb-1");
      expect(refused.status).toBe(503);
      expect(refused.headers).not.toHaveProperty("X-Microvm-Suspend-After");

      await hook(worker, "resume");
      const accepted = await job(worker, "cb-1");
      expect(accepted).toEqual({
        status: 202,
        headers: expect.objectContaining(ACK),
      });
    });

    it("acknowledges a second delivery by what the first request carried, not by the resend", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-on");
      await job(worker, "cb-off", {});

      // While the jobs run.
      const onWithout = await job(worker, "cb-on", {});
      const offWith = await job(worker, "cb-off");
      expect(onWithout).toEqual({
        status: 202,
        headers: expect.objectContaining(ACK),
      });
      expect(offWith.status).toBe(202);
      expect(offWith.headers).not.toHaveProperty("X-Microvm-Suspend-After");

      // After the jobs ended, from the finished record.
      await finishJob("cb-off");
      await finishJob("cb-on");
      expect(microvms.suspended).toEqual(["mvm-1"]);
      const onAfter = await job(worker, "cb-on", {});
      const offAfter = await job(worker, "cb-off");
      expect(onAfter).toEqual({
        status: 202,
        headers: expect.objectContaining(ACK),
      });
      expect(offAfter.status).toBe(202);
      expect(offAfter.headers).not.toHaveProperty("X-Microvm-Suspend-After");
    });

    it("refuses a job with suspendAfter while it suspends, and records no suspend for it", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      const refused = await job(worker, "cb-2");
      expect(refused.status).toBe(503);
      expect(refused.headers).not.toHaveProperty("X-Microvm-Suspend-After");

      await hook(worker, "resume");
      await advance(GRACE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });
  });

  describe("the trigger", () => {
    it("suspends the run hook's MicroVM after the job, in a session without auto-suspend", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      expect(microvms.suspended).toEqual([]);

      await finishJob("cb-1");

      // Never the MicroVM ID of the job request.
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(info).toHaveBeenCalledWith("suspending the MicroVM after a job", {
        microvmId: "mvm-1",
        callbackId: "cb-1",
      });
      expect(
        Object.keys(
          info.mock.calls.find(
            ([m]) => m === "suspending the MicroVM after a job",
          )?.[1],
        ),
      ).toEqual(["microvmId", "callbackId"]);
    });

    it("suspends after a job whose handler failed", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      await finishJob("cb-1", true);

      expect(lambda.sent).toEqual([
        "SendDurableExecutionCallbackFailureCommand:cb-1",
      ]);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("suspends only after the outcome report ends", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      lambda.hold = true;

      await finishJob("cb-1");
      expect(lambda.sent).toEqual([
        "SendDurableExecutionCallbackSuccessCommand:cb-1",
      ]);
      expect(microvms.suspended).toEqual([]);

      lambda.release();
      await advance(0);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("refuses jobs from the decision on, and the resume hook ends the refusal without a second suspend", async () => {
      const worker = start();
      await runHook(worker);
      microvms.hold = true;
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      // The call has not returned. The worker refuses jobs already.
      expect((await job(worker, "cb-2", {})).status).toBe(503);
      microvms.finish();
      await advance(0);
      expect((await job(worker, "cb-2", {})).status).toBe(503);

      await hook(worker, "resume");
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      await advance(GRACE_MS * 2);

      // The resume hook does not record the request again.
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("ends the refusal after 30 seconds without a resume hook, and does not suspend again", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await finishJob("cb-1");

      await advance(GRACE_MS - 1);
      expect((await job(worker, "cb-2", {})).status).toBe(503);
      await advance(1);
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      await advance(GRACE_MS * 2);

      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("ignores suspendAfter in a run hook job", async () => {
      const worker = start();
      await call(worker, `${HOOK_PATH_PREFIX}run`, {
        microvmId: "mvm-1",
        runHookPayload: JSON.stringify({
          version: 1,
          region: "us-east-1",
          job: { callbackId: "cb-run", input: {}, suspendAfter: true },
        }),
      });
      await advance(0);
      await target?.idle();
      await advance(GRACE_MS);

      expect(lambda.sent).toEqual([
        "SendDurableExecutionCallbackSuccessCommand:cb-run",
      ]);
      expect(microvms.suspended).toEqual([]);
    });
  });

  describe("work that delays the suspend", () => {
    it("waits for every other job to end, also one without suspendAfter", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await job(worker, "cb-2", {});

      await finishJob("cb-1");
      await advance(GRACE_MS);
      expect(microvms.suspended).toEqual([]);

      await finishJob("cb-2");
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(info).toHaveBeenCalledWith("suspending the MicroVM after a job", {
        microvmId: "mvm-1",
        callbackId: "cb-1",
      });
    });

    it("suspends once when two suspendAfter jobs end", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await job(worker, "cb-2");

      await finishJob("cb-1");
      await finishJob("cb-2");
      await advance(GRACE_MS);

      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("waits for a failure report in the background", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      lambda.hold = true;
      // An invalid request that names a callback. The worker fails that
      // callback in the background.
      const invalid = await job(worker, "cb-bad", {
        heartbeatTimeoutSeconds: 0,
      });
      expect(invalid.status).toBe(400);
      lambda.hold = false;

      await finishJob("cb-1");
      expect(microvms.suspended).toEqual([]);

      lambda.release();
      await advance(0);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("waits for a run hook in flight, and suspends the MicroVM that it names", async () => {
      const worker = start();
      // The job arrives before the run hook. Its request names a MicroVM.
      await job(worker, "cb-1");
      const body = new PassThrough();
      const runHookAnswer = callWithStream(
        worker,
        `${HOOK_PATH_PREFIX}run`,
        body,
      );

      await finishJob("cb-1");
      // The run hook is not accepted yet. So the request waits, and the
      // worker logs the wait.
      expect(microvms.suspended).toEqual([]);
      expect(warn.mock.calls).toEqual([[WAIT_WARNING, { callbackId: "cb-1" }]]);

      body.end(Buffer.from(JSON.stringify(runHookBody())));
      expect((await runHookAnswer).status).toBe(200);
      await advance(0);
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });

    it("waits for a running SuspendMicrovm call, and starts one call at a time", async () => {
      const worker = start();
      await runHook(worker);
      microvms.hold = true;
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      // The resume hook aborts the call and ends the refusal. The fake call
      // ignores the abort, so the call still runs.
      await hook(worker, "resume");
      expect((await job(worker, "cb-2")).status).toBe(202);
      await finishJob("cb-2");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      microvms.finish();
      await advance(0);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(microvms.maxRunning).toBe(1);
    });
  });

  describe("a request that meets a refusal", () => {
    /** Starts a failure report in the background that stays pending. */
    const holdFailureReport = async (
      worker: MicrovmWorkerListener,
    ): Promise<void> => {
      lambda.hold = true;
      const invalid = await job(worker, "cb-bad", {
        heartbeatTimeoutSeconds: 0,
      });
      expect(invalid.status).toBe(400);
      lambda.hold = false;
    };

    it("is dropped by the idle suspend, so a later plain job does not suspend", async () => {
      const worker = start();
      await runHook(worker, IDLE_SECONDS);
      await job(worker, "cb-1");
      await holdFailureReport(worker);
      // The report blocks the suspend after the job. The idle time does not
      // count reports.
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual([]);

      await advance(IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      lambda.release();
      await advance(0);
      await hook(worker, "resume");
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");

      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(infoMessages()).not.toContain(
        "suspending the MicroVM after a job",
      );
    });

    it("is dropped by a suspend hook, so a later plain job does not suspend", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await holdFailureReport(worker);
      await finishJob("cb-1");

      await hook(worker, "suspend");
      lambda.release();
      await advance(0);
      await hook(worker, "resume");
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      await advance(GRACE_MS);

      expect(microvms.suspended).toEqual([]);
    });

    it.each<[string, (worker: MicrovmWorkerListener) => Promise<unknown>]>([
      ["the resume hook", (worker) => hook(worker, "resume")],
      ["the end of the 30 seconds", () => advance(GRACE_MS)],
    ])(
      "is not recorded by a job that ends during a suspend hook refusal, which %s ends",
      async (_label, endRefusal) => {
        const worker = start();
        await runHook(worker);
        await job(worker, "cb-1");
        await hook(worker, "suspend");

        await finishJob("cb-1");
        expect(microvms.suspended).toEqual([]);
        await endRefusal(worker);
        expect((await job(worker, "cb-2", {})).status).toBe(202);
        await finishJob("cb-2");
        await advance(GRACE_MS);

        expect(microvms.suspended).toEqual([]);
      },
    );
  });

  describe("auto-suspend together with suspendAfter", () => {
    it("replaces the idle timer, so the idle time starts no second call", async () => {
      const worker = start();
      await runHook(worker, IDLE_SECONDS);
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      // The refusal lasts 30 seconds without a resume hook. The idle timer
      // that the job's end armed would end inside it.
      await advance(IDLE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(infoMessages()).not.toContain("suspending the idle MicroVM");
    });

    it("suspends after the idle time again after the resume hook", async () => {
      const worker = start();
      await runHook(worker, IDLE_SECONDS);
      await job(worker, "cb-1");
      await finishJob("cb-1");
      await hook(worker, "resume");

      await advance(IDLE_MS);

      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
      expect(infoMessages()).toEqual(
        expect.arrayContaining([
          "suspending the MicroVM after a job",
          "suspending the idle MicroVM",
        ]),
      );
    });

    it("retries a refusal for now after at least 30 seconds", async () => {
      const worker = start();
      await runHook(worker, IDLE_SECONDS);
      microvms.failure = Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 400, attempts: 1 },
      });
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(microvms.suspended).toEqual(["mvm-1"]);

      await advance(GRACE_MS - 1);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      await advance(1);
      expect(microvms.suspended).toEqual(["mvm-1", "mvm-1"]);
    });
  });

  describe("failed calls", () => {
    it("logs the failed-call warning with trigger job as the last field", async () => {
      const worker = start();
      await runHook(worker);
      microvms.failure = Object.assign(new Error("not authorized"), {
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403, attempts: 1 },
      });
      await job(worker, "cb-1");
      await finishJob("cb-1");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual([
        "could not suspend the idle MicroVM, because the service rejected the call. A missing permission needs lambda:SuspendMicrovm on the MicroVM image in its execution role.",
        {
          microvmId: "mvm-1",
          error: { name: "AccessDeniedException", message: "not authorized" },
          outcome: "rejected",
          suspendHookArrived: false,
          terminating: false,
          closed: false,
          refusingJobs: false,
          trigger: "job",
        },
      ]);
      expect(Object.keys(warn.mock.calls[0][1]).at(-1)).toBe("trigger");
      // A rejection ends the refusal at once.
      expect((await job(worker, "cb-2", {})).status).toBe(202);
    });

    it("does not retry a refusal for now without auto-suspend", async () => {
      const worker = start();
      await runHook(worker);
      microvms.failure = Object.assign(new Error("slow down"), {
        name: "ThrottlingException",
        $metadata: { httpStatusCode: 400, attempts: 1 },
      });
      await job(worker, "cb-1");
      await finishJob("cb-1");

      await advance(10 * GRACE_MS);

      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(warn.mock.calls[0][1]).toMatchObject({
        outcome: "refusedForNow",
        refusingJobs: false,
        trigger: "job",
      });
    });

    it("refuses jobs for 30 seconds after an unknown outcome", async () => {
      const worker = start();
      await runHook(worker);
      microvms.failure = Object.assign(new Error("conflict"), {
        name: "ConflictException",
        $metadata: { httpStatusCode: 409, attempts: 1 },
      });
      await job(worker, "cb-1");
      await finishJob("cb-1");

      expect(warn.mock.calls[0][1]).toMatchObject({
        outcome: "unknown",
        refusingJobs: true,
        trigger: "job",
      });
      expect((await job(worker, "cb-2", {})).status).toBe(503);
      await advance(GRACE_MS);
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      expect(microvms.suspended).toEqual(["mvm-1"]);
    });
  });

  describe("a job that ends before the run hook", () => {
    const SKIP_WARNING =
      "cannot suspend the MicroVM after a job: the run hook named no MicroVM";
    const skipWarnings = () =>
      warn.mock.calls.filter(([m]) => m === SKIP_WARNING);
    const waitWarnings = () =>
      warn.mock.calls.filter(([m]) => m === WAIT_WARNING);

    it("keeps the request until the run hook arrives, then suspends the MicroVM that it names", async () => {
      const worker = start();
      // The job request names a MicroVM. The worker must never suspend it.
      await job(worker, "cb-1");
      await finishJob("cb-1");

      // No run hook has been handled. So the request waits, and the worker
      // logs the wait.
      expect(microvms.suspended).toEqual([]);
      expect(warn.mock.calls).toEqual([[WAIT_WARNING, { callbackId: "cb-1" }]]);
      warn.mockClear();

      expect(await runHook(worker)).toBe(200);
      await advance(0);

      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(info).toHaveBeenCalledWith("suspending the MicroVM after a job", {
        microvmId: "mvm-1",
        callbackId: "cb-1",
      });

      // The start cleared the request. The resume hook and a later plain
      // job start no second suspend.
      await hook(worker, "resume");
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      await advance(GRACE_MS);
      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("warns once and does not suspend when the run hook names no MicroVM", async () => {
      const worker = start();
      await job(worker, "cb-1");
      await finishJob("cb-1");
      expect(skipWarnings()).toEqual([]);

      await call(worker, `${HOOK_PATH_PREFIX}run`, { microvmId: "mvm-1" });
      await advance(0);

      expect(microvms.suspended).toEqual([]);
      expect(skipWarnings()).toEqual([[SKIP_WARNING, { callbackId: "cb-1" }]]);
      // The request is consumed. A later event does not warn again.
      expect((await job(worker, "cb-2", {})).status).toBe(202);
      await finishJob("cb-2");
      expect(skipWarnings()).toHaveLength(1);
      expect(microvms.suspended).toEqual([]);
    });

    it("drops the waiting request on close(), so the run hook starts no suspend", async () => {
      const worker = start();
      await job(worker, "cb-1");
      await finishJob("cb-1");

      worker.close();
      await runHook(worker);
      await advance(0);

      expect(microvms.suspended).toEqual([]);
      expect(skipWarnings()).toEqual([]);
    });

    it("logs the wait once for two jobs that end before the run hook", async () => {
      const worker = start();
      await job(worker, "cb-1");
      await finishJob("cb-1");
      // cb-2 ends while cb-1's request still waits. Its request waits too.
      await job(worker, "cb-2");
      await finishJob("cb-2");

      expect(microvms.suspended).toEqual([]);
      expect(waitWarnings()).toEqual([[WAIT_WARNING, { callbackId: "cb-1" }]]);
    });

    it("does not log the wait when the run hook came first", async () => {
      const worker = start();
      // The job request arrives before the run hook, and ends after it.
      await job(worker, "cb-1");
      expect(await runHook(worker)).toBe(200);

      await finishJob("cb-1");
      await advance(0);

      expect(microvms.suspended).toEqual(["mvm-1"]);
      expect(waitWarnings()).toEqual([]);
    });
  });

  describe("no suspend", () => {
    it("warns and does not suspend when the run hook had no payload", async () => {
      const worker = start();
      await call(worker, `${HOOK_PATH_PREFIX}run`, { microvmId: "mvm-1" });
      warn.mockClear();
      await job(worker, "cb-1");

      await finishJob("cb-1");

      expect(microvms.suspended).toEqual([]);
      expect(warn.mock.calls).toEqual([
        [
          "cannot suspend the MicroVM after a job: the run hook named no MicroVM",
          { callbackId: "cb-1" },
        ],
      ]);
    });

    it("drops the request on a terminate hook", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await job(worker, "cb-2", {});
      await finishJob("cb-1");

      await hook(worker, "terminate");
      // The handler of cb-2 ignores its signal, so it ends now.
      await finishJob("cb-2");
      await advance(GRACE_MS);

      expect(microvms.suspended).toEqual([]);
    });

    it("drops the request on close()", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");
      await job(worker, "cb-2", {});
      await finishJob("cb-1");

      worker.close();
      await finishJob("cb-2");
      await advance(GRACE_MS);

      expect(microvms.suspended).toEqual([]);
    });

    it("records no request for a job that ends after a terminate hook", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      await hook(worker, "terminate");
      // The handler of cb-1 ignores its signal, so it ends now.
      await finishJob("cb-1");
      await advance(GRACE_MS);

      expect(microvms.suspended).toEqual([]);
    });

    it("records no request for a job that ends after close()", async () => {
      const worker = start();
      await runHook(worker);
      await job(worker, "cb-1");

      worker.close();
      await finishJob("cb-1");

      expect(microvms.suspended).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
