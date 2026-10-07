import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  LambdaMicrovmsClient,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  CallbackReporter,
  isError,
  isPermanentError,
  isTerminalCallbackError,
  ResultSerializationError,
  ResultTooLargeError,
  safeGet,
  textOr,
} from "./callback-reporter";
import {
  InvalidRunHookPayloadError,
  type MicrovmJobDocument,
  parseJobRequest,
  parseRunHookRequest,
} from "./payload";

/**
 * Lambda sends lifecycle hooks to paths under this prefix.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const HOOK_PATH_PREFIX = "/aws/lambda-microvms/runtime/v1/";

/**
 * The route that receives a job over HTTP when the durable function names no
 * route. The worker serves it with `handler`.
 *
 * `microvm` sends a job here when the job is too large for the `run` hook.
 * `vm.invoke` sends a job here when it has no `path`. So `handler` receives
 * every job that names no route, whatever its size. The value must equal
 * `DEFAULT_MICROVM_JOB_PATH` in `@aws/durable-execution-sdk-js-extras`.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MICROVM_JOB_PATH = "/durable-execution/v1/job";

/** The largest `run` hook body the worker reads. The payload itself is at most 16 KB. */
const MAX_HOOK_BODY_BYTES = 64 * 1024;

/** The largest job request body the worker reads. */
const MAX_JOB_BODY_BYTES = 6 * 1024 * 1024;

/**
 * How many finished callback IDs the worker remembers.
 *
 * The durable function can deliver a job again after it finished. Its
 * request step re-runs on replay when its success checkpoint was not saved,
 * and it resends a job whose 202 answer was lost. Each callback ID belongs
 * to one job. So the worker ignores a callback ID that it already ran. A
 * callback ID is a short string, so 1,000 of them use well under 1 MB.
 */
const MAX_FINISHED_JOBS = 1_000;

/**
 * The longest time the worker waits for its own SuspendMicrovm call. The
 * call measured 75 to 94 milliseconds from inside a MicroVM in us-east-1.
 */
const SUSPEND_CALL_TIMEOUT_MS = 10_000;

/**
 * How long the worker refuses jobs after its own SuspendMicrovm call
 * returned, when no `resume` hook arrives first. This applies after a
 * successful call and after a call whose outcome is unknown.
 *
 * The call returns before the MicroVM freezes, and the worker cannot see the
 * freeze. A job accepted in between would freeze with the MicroVM, and
 * nothing would resume it. So the worker answers such a job with 503, and
 * the durable function resumes the MicroVM and delivers the job again. The
 * `resume` hook ends the refusal at once. This period covers an image that
 * does not enable that hook, and a suspend that the service did not carry
 * out. It fits inside the durable function's default delivery retry window.
 */
const SUSPEND_GRACE_MS = 30_000;

/**
 * How long the worker holds the `terminate` hook open while it fails the
 * callbacks of running jobs.
 *
 * Lambda waits for the hook's answer, up to the image's
 * `terminateTimeoutInSeconds`, and then terminates the MicroVM. The network
 * and the credentials still work while the hook runs. So the worker reports
 * first and answers after. A failure report took 20 to 1,700 milliseconds in
 * testing. This budget leaves room for a slow report, and fits in the
 * 10-second hook timeout that the README recommends. Reports still running
 * after it continue until the MicroVM ends.
 */
const TERMINATE_REPORT_BUDGET_MS = 5_000;

/**
 * The error that the worker reports for a job that the `terminate` hook
 * stopped: a job that was running, a `run` hook job whose body arrived after
 * the hook, and a `run` hook job that a `suspend` hook deferred. A running
 * job's `context.signal` is aborted with it.
 *
 * The worker reports it as the callback's error type. The `microvm`
 * operation in the durable function then fails at once with a
 * `MicrovmJobFailedError` whose message contains `(MicrovmTerminatedError)`,
 * instead of at the job's heartbeat timeout or its timeout.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmTerminatedError extends Error {
  override readonly name = "MicrovmTerminatedError";

  constructor() {
    super("the MicroVM was terminated before the job finished");
  }
}

/**
 * Whether a lifecycle hook request comes from Lambda, not from a caller of
 * the MicroVM endpoint.
 *
 * The endpoint forwards a request to a hook path from any caller that holds
 * an auth token for the MicroVM. Probes in us-east-1 found two differences:
 *
 * 1. Lambda's own `run`, `resume`, `suspend`, and `terminate` calls carry
 *    `Host: localhost:<port>` and no `x-amzn-requestid` header.
 * 2. A forwarded request carries the endpoint's host name, and an
 *    `x-amzn-requestid` that the endpoint sets. The endpoint rejected a
 *    request that set `Host: localhost`, and it replaced a request ID that
 *    the caller set.
 *
 * The Lambda documentation does not state either behavior. So the worker
 * uses this check only where a false rejection costs little:
 *
 * - `suspend` and `terminate`: the worker would ignore them, which is what
 *   it did before it acted on them.
 * - `resume`: the refusal after a suspend would end after its 30-second
 *   limit instead of at once. A forwarded `resume` in the time between a
 *   suspend hook and the freeze would otherwise end the refusal early, and a
 *   job accepted then would freeze with the MicroVM.
 *
 * The `run` hook does not use the check, because a false rejection there
 * would lose every job.
 */
function isLambdaHookCall(request: IncomingMessage): boolean {
  const headers = request.headers ?? {};
  const host = (headers.host ?? "").toLowerCase();
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return isLocalHost && headers["x-amzn-requestid"] === undefined;
}

/**
 * What the job handler receives besides its input.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmJobContext {
  /** The callback ID that the worker completes with the handler's result. */
  callbackId: string;
  /**
   * The MicroVM identifier. The worker learns it from the `run` hook, or
   * from a job request that arrives first. It is `"unknown"` until then.
   */
  microvmId: string;
  /** The Region of the durable function. */
  region: string;
  /**
   * Aborted when the durable function stops accepting the result, for example
   * after a callback or heartbeat timeout, while the handler runs. The worker
   * learns this from a heartbeat answer, so this case fires only when the
   * job has a heartbeat timeout and a heartbeat reaches the service after
   * the callback ended. The handler should then stop its work. The worker
   * stops aborting the signal once it has seen the handler's promise settle,
   * which is at most a few microtasks after the settlement.
   *
   * The terminate hook also aborts the signal, with a
   * {@link MicrovmTerminatedError} as its reason.
   *
   * An `abort` listener must not throw. Node reports an error thrown by an
   * event listener as an uncaught exception, which ends the worker process.
   */
  signal: AbortSignal;
  /** The worker's logger. */
  logger: MicrovmWorkerLogger;
}

/**
 * The job to run. Its resolved value becomes the durable function's result.
 * A rejection fails the durable operation with the error's name and message.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type MicrovmJobHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: MicrovmJobContext,
) => Promise<TOutput>;

/**
 * The logger the worker writes to.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmWorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for {@link createMicrovmWorkerListener} and
 * {@link startMicrovmWorker}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmWorkerOptions<TInput = unknown, TOutput = unknown> {
  /**
   * The job to run when a job names no route. The durable function sends such
   * a job in the `run` hook payload, or over HTTP to {@link MICROVM_JOB_PATH}
   * when the job is too large for the `run` hook. The worker runs `handler`
   * for both.
   */
  handler?: MicrovmJobHandler<TInput, TOutput>;
  /**
   * The jobs to run when a job arrives over HTTP on a named route, keyed by
   * path. The durable function sends a job there when it sets
   * `request.path`, or `path` in `vm.invoke`.
   */
  routes?: Record<string, MicrovmJobHandler<TInput, TOutput>>;
  /**
   * Creates the Lambda client for a Region. Defaults to a client that uses
   * the default credential chain. Called for each job, after the job
   * arrives, never at image build. Also called to fail the callback of an
   * invalid request that names one. The worker never destroys a client
   * that this function returns; it destroys only the default clients it
   * creates itself.
   */
  createClient?: (region: string) => LambdaClient;
  /**
   * Creates the Lambda MicroVMs client that suspends this MicroVM when it is
   * idle. Defaults to a client that uses the default credential chain.
   * Called only when the session asks the worker to suspend when idle. The
   * worker never destroys a client that this function returns; it destroys
   * only the default clients it creates itself.
   */
  createMicrovmsClient?: (region: string) => LambdaMicrovmsClient;
  /**
   * The heartbeat interval in milliseconds. Defaults to one third of the
   * job's `heartbeatTimeoutSeconds`, at most 15 minutes. Each wait is the
   * interval minus 1 to 2 seconds, capped at half the interval. No
   * heartbeats are sent when the job has no heartbeat timeout. After a
   * failed heartbeat, the next one comes after an eighth to a quarter of the
   * interval, for at most two failures in a row.
   *
   * An explicit value must be a positive integer of at most 15 minutes.
   * Either way, a job's interval is at most a third of its heartbeat
   * timeout. Each heartbeat call gets half the interval, so an explicit
   * value under a few seconds suits tests only: a real call can take longer
   * than that, and every heartbeat would then time out.
   */
  heartbeatIntervalMs?: number;
  /** Defaults to single-line JSON on stdout and stderr. */
  logger?: MicrovmWorkerLogger;
}

/**
 * A request listener plus a way to wait for running jobs.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmWorkerListener {
  /** The Node.js request listener. */
  listener: RequestListener;
  /**
   * Resolves when every job started so far has ended, and
   * when a running SuspendMicrovm call has returned. That call takes at most
   * 10 seconds.
   */
  idle(): Promise<void>;
  /**
   * Stops the idle time. The listener then never suspends the MicroVM again.
   * Running jobs continue. A refusal that a suspend started still ends on
   * the `resume` hook or after 30 seconds.
   */
  close(): void;
}

/**
 * Creates a request listener for the MicroVM lifecycle hooks and the job
 * routes.
 *
 * @remarks
 * On `POST .../run` the listener:
 *
 * 1. Parses the body and the run hook payload.
 * 2. Answers HTTP 200 at once. Lambda allows the `run` hook at most 60
 *    seconds, and a failed or slow hook can terminate the MicroVM. So work
 *    starts after the response.
 * 3. Runs `handler` for the payload's job, when the payload has one.
 *
 * A `run` hook without a job is normal. The jobs of such a MicroVM arrive
 * over HTTP.
 *
 * On `POST <route>` the listener parses the job request, answers HTTP 202,
 * and runs the route's handler. `POST` to {@link MICROVM_JOB_PATH} runs
 * `handler`.
 *
 * For every job, the listener sends heartbeats until the job's outcome is
 * reported, when the job sets a heartbeat timeout. A terminal heartbeat
 * error while the handler runs aborts `context.signal`. After the handler
 * has settled, it only stops the heartbeats. When the handler ends, the
 * listener completes the job's callback with the result, or fails it with
 * the error.
 *
 * A second delivery of a callback ID is answered like the first and ignored,
 * while that job runs and after it ended. The listener remembers the last
 * 1,000 finished callback IDs. So a retried delivery runs a job once, unless
 * more than 1,000 other jobs ended in between, or the worker process
 * restarted.
 *
 * A document that does not match the contract gets HTTP 400. If the document
 * still names a callback, the listener fails that callback. So the durable
 * function fails at once instead of at its timeout.
 *
 * A session's `run` hook payload can set `autoSuspendIdleSeconds`. The
 * listener then suspends its own MicroVM when no job has run for that many
 * seconds:
 *
 * 1. The idle time starts when the `run` hook arrives without a job, when a
 *    job ends, and when the `resume` lifecycle hook arrives.
 * 2. A job that starts cancels the idle time. So the listener never suspends
 *    the MicroVM during a job.
 * 3. When the idle time ends, the listener calls SuspendMicrovm with the
 *    MicroVM's own ID. The call returns before the MicroVM freezes. The
 *    MicroVM keeps its memory and files, and the durable function resumes it
 *    before the next job.
 * 4. From the moment the idle time ends, the listener answers every job with
 *    HTTP 503 and does not start it. A job accepted then would freeze with
 *    the MicroVM. After a 503, the durable function checks the MicroVM's
 *    state, resumes it, and delivers the job again.
 * 5. The refusal ends when the `resume` lifecycle hook arrives, or 30 seconds
 *    after the call returned. The 30-second case covers an image without the
 *    `resume` hook. In both cases the idle time then starts again.
 * 6. A call that the service rejected on its first attempt, for example for a
 *    missing permission, ends the refusal at once. The MicroVM keeps running,
 *    and the worker does not retry the call. The next job that ends starts
 *    the idle time again.
 * 7. A call whose outcome is unknown, such as a timeout, a throttle, a
 *    conflict, or a server error, is handled like a successful call. The
 *    service may have suspended the MicroVM anyway. A rejection after the
 *    client retried an earlier attempt also counts as unknown, because the
 *    earlier attempt may have suspended the MicroVM. When the refusal ends,
 *    the idle time starts again, so the worker tries the call again.
 *
 * The listener counts only jobs. It cannot see background processes, or
 * inbound traffic that is not a job. A MicroVM that must keep such work
 * running leaves `autoSuspendOnIdle` off in the session, which is the
 * default.
 *
 * When the image enables the `suspend` and `terminate` hooks, the listener
 * acts on them:
 *
 * - `suspend`: Lambda is about to freeze the MicroVM, for example after
 *   SuspendMicrovm or the idle policy. The listener answers HTTP 200 at once,
 *   because a suspend hook that runs past its timeout terminates the
 *   MicroVM. It then refuses jobs with HTTP 503, as after its own suspend,
 *   until the `resume` hook or for 30 seconds. Running jobs freeze with the
 *   MicroVM, and continue after a resume. A `run` hook job that arrives
 *   during the refusal starts when the refusal ends, because the durable
 *   function cannot deliver it again.
 * - `terminate`: Lambda is about to end the MicroVM, after TerminateMicrovm
 *   or at the end of `maximumDurationInSeconds`. The listener aborts each
 *   running job's `context.signal` and fails its callback with
 *   {@link MicrovmTerminatedError}. So the durable function fails the job at
 *   once. It answers HTTP 200 when the reports end, or after 5 seconds. The
 *   answer also waits for jobs that report their own outcome, for `run` hook
 *   requests in flight, and for the failure reports of invalid requests.
 *   From
 *   then on it refuses jobs with HTTP 503, and fails the callback of a
 *   `run` hook job instead of starting it. Lambda does not call the hook
 *   when it terminates a suspended MicroVM, because the process is frozen.
 *
 * The listener acts on these two hooks, and on `resume`, only when the
 * request's `Host` is `localhost`, `127.0.0.1`, or `[::1]`, with any port,
 * and it has no `x-amzn-requestid` header, as Lambda's own calls do. A
 * request that a caller of the MicroVM endpoint sent to one of these hook
 * paths gets HTTP 200 and is ignored.
 *
 * Every other lifecycle hook gets HTTP 200. This includes the `ready` image
 * hook, which the service requires whenever the `run` hook is enabled. Other
 * paths get HTTP 404.
 *
 * @throws \{TypeError\} When there is neither a handler nor a route, or a
 * route path is invalid.
 * @throws \{RangeError\} When `heartbeatIntervalMs` is not a positive integer
 * of at most 15 minutes.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createMicrovmWorkerListener<
  TInput = unknown,
  TOutput = unknown,
>(options: MicrovmWorkerOptions<TInput, TOutput>): MicrovmWorkerListener {
  if (!options.handler && Object.keys(options.routes ?? {}).length === 0) {
    throw new TypeError("the MicroVM worker needs a handler or routes");
  }
  if (
    options.heartbeatIntervalMs !== undefined &&
    !(
      Number.isInteger(options.heartbeatIntervalMs) &&
      options.heartbeatIntervalMs > 0 &&
      options.heartbeatIntervalMs <= MAX_HEARTBEAT_INTERVAL_MS
    )
  ) {
    throw new RangeError(
      `heartbeatIntervalMs must be a positive integer of at most ${MAX_HEARTBEAT_INTERVAL_MS}`,
    );
  }
  for (const path of Object.keys(options.routes ?? {})) {
    if (!path.startsWith("/") || path.startsWith(HOOK_PATH_PREFIX)) {
      throw new TypeError(
        `route "${path}" must start with "/" and must not use the lifecycle hook prefix`,
      );
    }
    if (path === MICROVM_JOB_PATH) {
      throw new TypeError(
        `route "${path}" is reserved for jobs that name no route; set handler instead`,
      );
    }
  }

  // A logger that throws must not reject a job's promise or a background
  // task. An unhandled rejection would end the worker process.
  const logger = safeLogger(options.logger ?? jsonLogger);
  const jobs = new Map<string, Promise<void>>();
  // Callback IDs of jobs that ended, oldest first. A Set keeps insertion
  // order, so the first entry is the oldest.
  const finished = new Set<string>();
  const remember = (callbackId: string): void => {
    finished.add(callbackId);
    if (finished.size > MAX_FINISHED_JOBS) {
      const oldest = finished.values().next().value;
      if (oldest !== undefined) {
        finished.delete(oldest);
      }
    }
  };
  /** Whether a job with this callback ID runs now, or ran recently. */
  const isKnownJob = (callbackId: string): boolean =>
    jobs.has(callbackId) || finished.has(callbackId);
  const background = new Set<Promise<void>>();
  // Set by the run hook. A job request that arrives first sets it too.
  let microvmId = "unknown";
  // Lambda sends one run hook per MicroVM. The endpoint also forwards a
  // request to the hook path from any caller that holds an auth token for
  // the MicroVM. A probe confirmed it: the worker answered such a request.
  // SuspendMicrovm authorizes on the image, so a later run hook could make
  // the worker suspend another MicroVM of the same image. So the worker acts
  // only on the first valid run hook, and ignores every later one.
  let runHookAccepted = false;
  // Set from the run hook payload of a session that suspends when idle.
  // `microvmId` here is the run hook's ID. SuspendMicrovm uses it, never an
  // ID from a job request.
  let autoSuspend:
    | { idleMs: number; region: string; microvmId: string }
    | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  // Set from the moment the idle time ends until the MicroVM runs again.
  // While set, the listener refuses jobs.
  let suspending = false;
  let graceTimer: NodeJS.Timeout | undefined;
  // Counts the suspend hooks from Lambda. A suspend call of the worker's own
  // that the service rejected must not end a refusal that a suspend hook
  // started meanwhile.
  let suspendHooks = 0;
  // Set by the terminate hook. The MicroVM is about to end, so no job can
  // start again.
  let terminating = false;
  // The jobs whose handlers run now, with what the terminate hook needs to
  // fail them.
  const active = new Map<
    string,
    { controller: AbortController; heartbeats: Heartbeats; region: string }
  >();
  // The jobs whose handlers have settled and whose outcome is being reported.
  const reporting = new Set<string>();
  // Run hook jobs that arrived while the worker refused jobs for a suspend.
  // The durable function cannot deliver a run hook job again, so the worker
  // starts it when the refusal ends, instead of refusing it.
  const deferred: { job: MicrovmJobDocument<TInput>; region: string }[] = [];
  // Run hook requests that are still being handled, including the report
  // of a job that a terminate hook stopped. The terminate hook waits for
  // them, because Lambda can end the MicroVM as soon as it gets the answer.
  const runHooks = new Set<Promise<void>>();
  // Callback failure reports in flight, from every place that fails a
  // callback. The terminate hook waits for them for the same reason.
  const callbackReports = new Set<Promise<void>>();
  // The work of the first terminate hook. Every later one waits for it too.
  let termination: Promise<void> | undefined;
  let closed = false;

  const track = (work: Promise<void>): void => {
    background.add(work);
    void work
      .catch((error: unknown) =>
        logger.error("background task failed", { error: describe(error) }),
      )
      .finally(() => background.delete(work))
      // A last guard: nothing above should reject, and a rejection here
      // would end the process.
      .catch(() => undefined);
  };

  /** Starts the idle time, when the session asked for it and no job runs. */
  const startIdleTime = (): void => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    if (
      closed ||
      terminating ||
      suspending ||
      autoSuspend === undefined ||
      jobs.size > 0
    ) {
      return;
    }
    const { idleMs, region, microvmId: target } = autoSuspend;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      // A job that started after the timer was set cancels it. This check
      // covers a job that started in the same event loop turn.
      if (jobs.size === 0 && !closed) {
        suspending = true;
        track(suspendSelf(region, idleMs, target));
      }
    }, idleMs);
    // The timer must not keep a test process, or a closed worker, alive.
    idleTimer.unref();
  };

  const stopIdleTime = (): void => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  /**
   * Ends the refusal after the grace period, unless the `resume` hook ends it
   * first. A timer set earlier is replaced, so only the latest one runs.
   */
  const startGrace = (): void => {
    clearTimeout(graceTimer);
    graceTimer = setTimeout(endSuspending, SUSPEND_GRACE_MS);
    graceTimer.unref();
  };

  /** Ends the refusal of jobs, and starts the idle time again. */
  const endSuspending = (): void => {
    clearTimeout(graceTimer);
    graceTimer = undefined;
    if (!suspending) {
      return;
    }
    suspending = false;
    startDeferredJobs();
    startIdleTime();
  };

  /** Starts the run hook jobs that arrived during a refusal. */
  function startDeferredJobs(): void {
    for (const { job, region } of deferred.splice(0)) {
      if (options.handler) {
        startJob(options.handler, job, region);
      }
    }
  }

  async function suspendSelf(
    region: string,
    idleMs: number,
    target: string,
  ): Promise<void> {
    let client: LambdaMicrovmsClient;
    // The worker destroys only a client that it created itself. A client
    // from createMicrovmsClient belongs to the caller.
    let ownsClient = false;
    try {
      const provided = options.createMicrovmsClient?.(region);
      ownsClient = provided === undefined;
      client = provided ?? new LambdaMicrovmsClient({ region });
    } catch (error) {
      // No call was made. So jobs can run again at once.
      logger.error("could not create the Lambda MicroVMs client", {
        microvmId: target,
        error: describe(error),
      });
      suspending = false;
      startDeferredJobs();
      return;
    }
    logger.info("suspending the idle MicroVM", {
      microvmId: target,
      idleMs,
    });
    const hooksBefore = suspendHooks;
    try {
      await client.send(
        new SuspendMicrovmCommand({ microvmIdentifier: target }),
        { abortSignal: AbortSignal.timeout(SUSPEND_CALL_TIMEOUT_MS) },
      );
    } catch (error) {
      if (isRejectedRequest(error)) {
        logger.warn(
          "could not suspend the idle MicroVM, because the service rejected the call. It keeps running. A missing permission needs lambda:SuspendMicrovm on the MicroVM image in its execution role.",
          { microvmId: target, error: describe(error) },
        );
        // The service did nothing. So jobs can run again at once. The idle
        // time does not start again, so a missing permission is not retried.
        // A suspend hook that arrived during the call means that the
        // MicroVM is suspending anyway, so its refusal stays.
        if (suspendHooks === hooksBefore) {
          clearTimeout(graceTimer);
          graceTimer = undefined;
          suspending = false;
          startDeferredJobs();
        }
        return;
      }
      // A timeout, a throttle, a conflict, a server error, or a rejection
      // after a retried attempt does not show whether the service suspended
      // the MicroVM. So the refusal continues, as after a successful call.
      logger.warn(
        "the suspend call for the idle MicroVM had an unknown outcome. The worker refuses jobs until the MicroVM resumes, or for 30 seconds.",
        { microvmId: target, error: describe(error) },
      );
    } finally {
      // Each suspend creates its own client. Destroying it releases its
      // connections, as CallbackReporter does for its clients.
      if (ownsClient) {
        client.destroy();
      }
    }
    // A resume hook that arrived during the call has already ended the
    // refusal. The grace timer also runs after close(), so a closed listener
    // does not refuse jobs forever.
    if (suspending) {
      startGrace();
    }
  }

  const listener: RequestListener = (request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      logger.error("request handling failed", { error: describe(error) });
      if (!response.headersSent) {
        respond(response, 500, { error: "internal error" });
      }
    });
  };

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = (request.url ?? "").split("?")[0];
    if (path.startsWith(HOOK_PATH_PREFIX) && request.method === "POST") {
      const hook = path.slice(HOOK_PATH_PREFIX.length);
      if (hook === "run") {
        const work = handleRunHook(request, response);
        runHooks.add(work);
        try {
          await work;
        } finally {
          runHooks.delete(work);
        }
        return;
      }
      if (
        (hook === "suspend" || hook === "terminate" || hook === "resume") &&
        !isLambdaHookCall(request)
      ) {
        // A caller of the endpoint, not Lambda, sent this request. Acting on
        // it would refuse or fail jobs that Lambda did not stop, or accept
        // jobs while the MicroVM is about to freeze.
        logger.warn("lifecycle hook ignored: it did not come from Lambda", {
          hook,
          microvmId,
        });
        respond(response, 200, {});
        return;
      }
      logger.info("lifecycle hook", { hook });
      if (hook === "terminate") {
        await handleTerminateHook(response);
        return;
      }
      respond(response, 200, {});
      if (hook === "suspend") {
        // Lambda freezes the MicroVM after this answer. A job accepted now
        // would freeze with it, so the worker refuses jobs until the resume
        // hook, as after its own suspend. The answer goes out first, because
        // a suspend hook that runs past its timeout terminates the MicroVM.
        suspendHooks++;
        stopIdleTime();
        suspending = true;
        startGrace();
      } else if (hook === "resume") {
        // The MicroVM runs again. So jobs can run again. A resume without
        // a job would otherwise leave the MicroVM running until the next
        // job ends.
        if (suspending) {
          endSuspending();
        } else {
          startIdleTime();
        }
      }
      return;
    }
    const route =
      path === MICROVM_JOB_PATH ? options.handler : options.routes?.[path];
    if (route && request.method === "POST") {
      await handleJobRequest(route, request, response);
      return;
    }
    respond(response, 404, { error: "not found" });
  }

  /**
   * Fails the callback of every running job, then answers the hook.
   *
   * Lambda terminates the MicroVM after the answer, or at the hook's
   * timeout. A running job cannot finish. So the worker aborts each job's
   * signal, stops its heartbeats, and fails its callback with
   * {@link MicrovmTerminatedError}. The durable function then fails the job
   * at once, instead of at its heartbeat timeout or its timeout. The answer
   * waits for the reports, for at most {@link TERMINATE_REPORT_BUDGET_MS}.
   */
  async function handleTerminateHook(response: ServerResponse): Promise<void> {
    // A second terminate hook can arrive while the first one waits. The
    // first one has already taken the running jobs out of the map, so the
    // second would find nothing to wait for and answer early. So every
    // terminate hook waits for the same work.
    termination ??= terminate();
    await termination;
    respond(response, 200, {});
  }

  /**
   * Stops the running jobs, fails their callbacks, and waits for the
   * reports. Runs once per listener.
   */
  async function terminate(): Promise<void> {
    terminating = true;
    stopIdleTime();
    // A job whose handler has settled reports its own outcome. The answer
    // waits for that report too.
    const reports: Promise<void>[] = [...jobs]
      .filter(([callbackId]) => reporting.has(callbackId))
      .map(([, run]) => run);
    let failed = 0;
    for (const [callbackId, job] of active) {
      // Removed first, so that a second terminate hook reports nothing again.
      active.delete(callbackId);
      if (job.controller.signal.aborted) {
        // A heartbeat found the callback gone, and aborted the signal. A
        // report would fail with the same terminal error.
        continue;
      }
      const error = new MicrovmTerminatedError();
      job.controller.abort(error);
      const report = job.heartbeats
        .stop()
        .then(() => failCallback(error, callbackId, job.region));
      track(report);
      reports.push(report);
      failed++;
    }
    for (const { job, region } of deferred.splice(0)) {
      const report = failCallback(
        new MicrovmTerminatedError(),
        job.callbackId,
        region,
      );
      track(report);
      reports.push(report);
      failed++;
    }
    if (failed > 0) {
      logger.warn("failing running jobs: the MicroVM is terminating", {
        microvmId,
        jobs: failed,
      });
    }
    // A run hook whose body is still arriving can name a job, and then fails
    // its callback. An invalid run hook or job request fails its callback in
    // the background. Either can begin while the worker waits here. So the
    // wait reads both sets again after each round, until both are empty or
    // the budget ends.
    let timer: NodeJS.Timeout | undefined;
    let budgetEnded = false;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        budgetEnded = true;
        resolve();
      }, TERMINATE_REPORT_BUDGET_MS);
      timer.unref();
    });
    for (;;) {
      const pending = [...reports, ...runHooks, ...callbackReports];
      if (pending.length === 0 || budgetEnded) {
        break;
      }
      await Promise.race([Promise.allSettled(pending), budget]);
      // The reports have settled, unless the budget ended. A settled run hook
      // or report has left its set, so the next round waits only for new
      // ones.
      reports.length = 0;
    }
    clearTimeout(timer);
  }

  async function handleRunHook(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let parsed: ReturnType<typeof parseRunHookRequest<TInput>>;
    try {
      parsed = parseRunHookRequest<TInput>(
        await readJson(request, MAX_HOOK_BODY_BYTES),
      );
    } catch (error) {
      reject(error, response);
      return;
    }

    if (runHookAccepted) {
      logger.warn("later run hook ignored", {
        microvmId,
        hookMicrovmId: parsed.microvmId,
      });
      respond(response, 200, {});
      return;
    }
    runHookAccepted = true;
    microvmId = parsed.microvmId;
    const payload = parsed.payload;
    if (!payload) {
      logger.warn("run hook without runHookPayload", { microvmId });
      respond(response, 200, {});
      return;
    }
    if (payload.autoSuspendIdleSeconds !== undefined) {
      autoSuspend = {
        idleMs: Math.round(payload.autoSuspendIdleSeconds * 1_000),
        region: payload.region,
        microvmId: parsed.microvmId,
      };
    }

    const job = payload.job;
    if (job && isKnownJob(job.callbackId)) {
      logger.warn("duplicate job ignored", { microvmId });
      respond(response, 200, {});
      return;
    }

    // The body is read before these checks. So a suspend or terminate hook
    // can arrive while the body of this request is still being read.
    if (job && options.handler && terminating) {
      // The job could not finish. The durable function cannot deliver a run
      // hook job again, so the worker fails its callback, as for a job that
      // was running when the terminate hook arrived.
      logger.info("run hook job not started: the MicroVM is terminating", {
        microvmId,
      });
      respond(response, 200, {});
      const report = failCallback(
        new MicrovmTerminatedError(),
        job.callbackId,
        payload.region,
      );
      // failCallback records the report in callbackReports, and the
      // terminate hook waits for that set.
      track(report);
      return;
    }
    if (job && options.handler && suspending) {
      // A job started now would freeze with the MicroVM. The worker starts it
      // when the refusal ends.
      logger.info("run hook job deferred: the MicroVM is suspending", {
        microvmId,
      });
      respond(response, 200, {});
      deferred.push({ job, region: payload.region });
      return;
    }

    respond(response, 200, {});

    if (job && options.handler) {
      startJob(options.handler, job, payload.region);
      return;
    }
    if (job) {
      track(
        failCallback(
          new InvalidRunHookPayloadError(
            "the run hook delivered a job, and this worker has no handler for run hook jobs",
          ),
          job.callbackId,
          payload.region,
        ),
      );
    }
    // No run hook job. A session's HTTP jobs can arrive before or after
    // this hook. The idle time does not start while one runs, and each one
    // starts it again when it ends.
    startIdleTime();
  }

  async function handleJobRequest(
    handler: MicrovmJobHandler<TInput, TOutput>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let job: ReturnType<typeof parseJobRequest<TInput>>;
    try {
      job = parseJobRequest<TInput>(
        await readJson(request, MAX_JOB_BODY_BYTES),
      );
    } catch (error) {
      reject(error, response);
      return;
    }
    if (microvmId === "unknown" && job.microvmId !== undefined) {
      // The endpoint can accept a request before Lambda has sent the run
      // hook. The run hook sets the same identifier when it arrives.
      microvmId = job.microvmId;
    }
    if (terminating) {
      // The MicroVM is about to end. The job could not finish.
      logger.info("job refused: the MicroVM is terminating", { microvmId });
      respond(response, 503, { error: "the MicroVM is terminating" });
      return;
    }
    if (suspending) {
      // The MicroVM is about to freeze. The durable function resumes it and
      // delivers the job again.
      logger.info("job refused: the MicroVM is suspending", { microvmId });
      respond(response, 503, { error: "the MicroVM is suspending" });
      return;
    }
    respond(response, 202, {});
    if (isKnownJob(job.callbackId)) {
      logger.warn("duplicate job ignored", { microvmId });
      return;
    }
    startJob(handler, job, job.region);
  }

  /**
   * Answers 400 to a request that the worker could not accept.
   *
   * Only the worker's own validation messages are sent back. They describe
   * the request, not the worker. Any other error, such as a connection that
   * failed while the body was read, is logged, and the caller gets a generic
   * message. So no internal error text reaches the HTTP response.
   */
  function reject(error: unknown, response: ServerResponse): void {
    if (!(error instanceof InvalidRunHookPayloadError)) {
      logger.error("could not read the request", { error: describe(error) });
      respond(response, 400, { error: "invalid request" });
      return;
    }
    logger.error("invalid request", { error: error.message });
    respond(response, 400, { error: error.message });
    if (error.callbackId) {
      const region = error.region ?? process.env.AWS_REGION;
      if (region) {
        track(failCallback(error, error.callbackId, region));
      }
    }
  }

  /**
   * Fails a callback. The report stays in {@link callbackReports} until it
   * ends, so that a terminate hook does not answer before it.
   */
  function failCallback(
    error: Error,
    callbackId: string,
    region: string,
  ): Promise<void> {
    const report = sendFailure(error, callbackId, region);
    callbackReports.add(report);
    const remove = (): void => {
      callbackReports.delete(report);
    };
    // Both callbacks are handled, so this chain cannot reject unhandled.
    void report.then(remove, remove);
    return report;
  }

  async function sendFailure(
    error: Error,
    callbackId: string,
    region: string,
  ): Promise<void> {
    let reporter: CallbackReporter | undefined;
    try {
      reporter = reporterFor(callbackId, region);
      await reporter.fail(error);
    } catch (reportError) {
      if (isTerminalCallbackError(reportError)) {
        // The callback has already ended, for example at its timeout. The
        // durable function no longer waits for this report.
        logger.info("the callback no longer accepts a failure", {
          error: describe(reportError),
        });
      } else {
        logger.error("could not fail the callback", {
          error: describe(reportError),
        });
      }
    } finally {
      // A client whose destroy() throws must not reject the report. Callers
      // await it, and the terminate hook waits for it.
      try {
        reporter?.close();
      } catch (closeError) {
        logger.error("could not close the Lambda client", {
          error: describe(closeError),
        });
      }
    }
  }

  // Each job gets its own client. A client kept across jobs would keep its
  // connections across a suspend of the MicroVM, and those can be dead after
  // the resume.
  function reporterFor(callbackId: string, region: string): CallbackReporter {
    return new CallbackReporter({
      callbackId,
      region,
      client: options.createClient?.(region),
      warn: (message, data) => logger.warn(message, { microvmId, ...data }),
    });
  }

  function startJob(
    handler: MicrovmJobHandler<TInput, TOutput>,
    job: MicrovmJobDocument<TInput>,
    region: string,
  ): void {
    stopIdleTime();
    const run = runJob(handler, job, region)
      .catch((error: unknown) =>
        logger.error("job failed inside the worker", {
          microvmId,
          error: describe(error),
        }),
      )
      .finally(() => {
        jobs.delete(job.callbackId);
        remember(job.callbackId);
        startIdleTime();
      })
      // A last guard: nothing above should reject, and a rejection here
      // would end the process.
      .catch(() => undefined);
    jobs.set(job.callbackId, run);
  }

  async function runJob(
    handler: MicrovmJobHandler<TInput, TOutput>,
    job: MicrovmJobDocument<TInput>,
    region: string,
  ): Promise<void> {
    const { callbackId } = job;
    let reporter: CallbackReporter;
    try {
      reporter = reporterFor(callbackId, region);
    } catch (error) {
      // Without a client, the worker cannot report anything. The durable
      // function fails the job at its heartbeat timeout or its timeout.
      logger.error("could not create the Lambda client for the job", {
        microvmId,
        error: describe(error),
      });
      return;
    }
    const controller = new AbortController();
    const heartbeats = startHeartbeats(
      reporter,
      job,
      controller,
      options.heartbeatIntervalMs,
      logger,
    );
    active.set(callbackId, { controller, heartbeats, region });
    logger.info("job started", { microvmId });

    let outcome: { ok: true; value: TOutput } | { ok: false; error: unknown };
    try {
      outcome = {
        ok: true,
        // The flag is set one microtask after the handler's promise settles.
        // A heartbeat answer handled after that no longer aborts the signal.
        value: await Promise.resolve(
          handler(job.input, {
            callbackId,
            microvmId,
            region,
            signal: controller.signal,
            logger,
          }),
        ).finally(() => heartbeats.handlerSettled()),
      };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // Heartbeats keep running while the outcome is reported. A completion
    // attempt can stall for up to 30 seconds, and without heartbeats a short
    // heartbeat timeout would expire before the retry.
    heartbeats.handlerSettled();
    // The terminate hook takes the job out of the map when it fails the
    // callback. Then the abort skips the report below.
    if (active.delete(callbackId)) {
      reporting.add(callbackId);
    }
    try {
      await reportOutcome(reporter, controller, outcome);
    } finally {
      reporting.delete(callbackId);
      await heartbeats.stop();
      reporter.close();
    }
  }

  async function reportOutcome(
    reporter: CallbackReporter,
    controller: AbortController,
    outcome: { ok: true; value: TOutput } | { ok: false; error: unknown },
  ): Promise<void> {
    if (controller.signal.reason instanceof MicrovmTerminatedError) {
      // The terminate hook has already failed the callback.
      logger.info("job outcome not reported: the MicroVM is terminating", {
        microvmId,
      });
      return;
    }
    if (controller.signal.aborted) {
      logger.warn("job outcome not reported: the callback is gone", {
        microvmId,
        reason: describe(controller.signal.reason),
      });
      return;
    }

    try {
      if (outcome.ok) {
        try {
          await reporter.succeed(outcome.value);
        } catch (error) {
          // A result over the size limit, or one that is not
          // JSON-serializable, is never sent. Report it as a failure, so the
          // durable function learns why instead of waiting for its timeout.
          if (
            !(error instanceof ResultTooLargeError) &&
            !(error instanceof ResultSerializationError)
          ) {
            throw error;
          }
          await reporter.fail(error);
        }
        logger.info("job succeeded", { microvmId });
      } else {
        await reporter.fail(outcome.error);
        logger.info("job failed", {
          microvmId,
          error: describe(outcome.error),
        });
      }
    } catch (error) {
      logger.error("job outcome could not be reported", {
        microvmId,
        terminal: isTerminalCallbackError(error),
        error: describe(error),
      });
    }
  }

  return {
    listener,
    idle: async (): Promise<void> => {
      while (jobs.size > 0 || background.size > 0) {
        await Promise.allSettled([...jobs.values(), ...background]);
      }
    },
    close: (): void => {
      closed = true;
      stopIdleTime();
    },
  };
}

/**
 * A running worker server.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmWorker {
  /** The port the server listens on. */
  port: number;
  /**
   * Resolves when every job started so far has ended, and
   * when a running SuspendMicrovm call has returned.
   */
  idle(): Promise<void>;
  /**
   * Stops accepting connections and stops the idle time. Running jobs
   * continue, and the worker no longer suspends the MicroVM.
   */
  close(): Promise<void>;
}

/**
 * Starts an HTTP server that answers the MicroVM lifecycle hooks and the job
 * routes.
 *
 * @remarks
 * Start it when the image's process starts, before Lambda takes the build
 * snapshot. The image's hook port must match `port`. See
 * {@link createMicrovmWorkerListener} for the request handling.
 *
 * @param options - The worker options.
 * @param port - The port to listen on. Defaults to 8080, the MicroVM default.
 * @returns The running worker. The promise rejects with the errors of
 * {@link createMicrovmWorkerListener}, and when the port cannot be bound.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export async function startMicrovmWorker<TInput = unknown, TOutput = unknown>(
  options: MicrovmWorkerOptions<TInput, TOutput>,
  port = 8080,
): Promise<MicrovmWorker> {
  const { listener, idle, close } = createMicrovmWorkerListener(options);
  const server: Server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    idle,
    close: () => {
      close();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/**
 * Sends a heartbeat now and then about every interval until stopped.
 *
 * A terminal error means the durable function no longer waits for this job.
 * While the handler runs, it aborts the job's signal and stops the
 * heartbeats. After the handler has settled, it only stops the heartbeats
 * and logs any answer other than "already complete".
 *
 * Another rejection, such as `AccessDeniedException` for a missing
 * `lambda:SendDurableExecutionCallbackHeartbeat` permission, is unlikely to
 * clear soon, but it can. It is logged once as an error, and heartbeats
 * continue. The same rejection is not logged again until a heartbeat
 * succeeds. Throttling, clock-skew, and expired-credential errors, and
 * errors that the SDK marks as retryable, count as transient. A transient
 * error is logged as a warning.
 *
 * After any failure, the next heartbeat comes after a short retry delay, for
 * at most two failures in a row, and on the normal schedule after that.
 * Stopping cancels a heartbeat in flight.
 *
 * @internal
 */
export function startHeartbeats<TInput>(
  reporter: CallbackReporter,
  job: MicrovmJobDocument<TInput>,
  controller: AbortController,
  intervalOverrideMs: number | undefined,
  logger: MicrovmWorkerLogger,
): Heartbeats {
  if (job.heartbeatTimeoutSeconds === undefined) {
    return { handlerSettled: () => {}, stop: async () => {} };
  }
  const intervalMs = heartbeatIntervalMs(
    job.heartbeatTimeoutSeconds,
    intervalOverrideMs,
  );
  const callTimeoutMs = heartbeatCallTimeoutMs(intervalMs);
  // The jitter comes from the callback ID, not from Math.random. See
  // jitterSource for why.
  const random = jitterSource(job.callbackId);

  let stopped = false;
  // Set when the handler has settled. A terminal heartbeat error then only
  // stops the heartbeats. The durable function has probably received the
  // outcome already, so the handler's signal must not fire.
  let handlerSettled = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  // Cancels a heartbeat in flight when the job ends, so the job does not
  // wait for a stalled call's timeout, which can be minutes.
  const cancel = new AbortController();
  // Failed heartbeats since the last success, rejections included. The
  // first two are retried after a short delay, so a failure costs less of
  // the heartbeat timeout. Later ones wait for the normal schedule. So a run
  // of failures costs at most two extra calls.
  let failures = 0;
  // The names of the rejections logged as errors since the last success.
  // Each is logged once until a heartbeat succeeds again.
  const loggedRejections = new Set<string>();
  const beat = async (): Promise<void> => {
    let failed = false;
    try {
      // A stalled call ends after callTimeoutMs, so it holds back the next
      // heartbeat by at most that time.
      await reporter.heartbeat(callTimeoutMs, cancel.signal);
    } catch (error) {
      if (stopped) {
        // The job has ended. A late failure, for example from the client
        // being closed, says nothing about the job.
        return;
      }
      if (isTerminalCallbackError(error)) {
        stopped = true;
        if (handlerSettled) {
          // The outcome is being reported. "Already complete" usually means
          // that the completion landed while this heartbeat was in flight,
          // so it is not logged. Any other terminal answer is logged, and
          // the completion call meets it too and reports it.
          if (
            safeGet(() => (error as Error).name) !==
            "InvalidParameterValueException"
          ) {
            logger.info("the callback no longer accepts heartbeats", {
              error: describe(error),
            });
          }
        } else {
          controller.abort(error);
        }
        return;
      }
      failed = true;
      if (isPermanentError(error)) {
        // A rejection such as AccessDeniedException is unlikely to clear
        // soon, but it can, for example while an IAM change propagates. So
        // heartbeats continue, and stopping would lose the job for sure. A
        // rejection shares the two quick retries with the other failures,
        // so any two failures in a row keep the gap bound.
        const name = textOr(
          safeGet(() => (error as Error).name),
          "Error",
        );
        if (!loggedRejections.has(name)) {
          loggedRejections.add(name);
          logger.error(
            "the service rejected a heartbeat. Heartbeats continue, and the same rejection is not logged again until a heartbeat succeeds. A missing permission, for example, needs lambda:SendDurableExecutionCallbackHeartbeat in the MicroVM's execution role.",
            { error: describe(error), handlerSettled },
          );
        }
      } else {
        logger.warn("heartbeat failed", { error: describe(error) });
      }
    }
    if (stopped) {
      // The job ended while the call was in flight.
      return;
    }
    if (!failed && loggedRejections.size > 0) {
      loggedRejections.clear();
      logger.info("heartbeats are accepted again", {});
    }
    failures = failed ? failures + 1 : 0;
    timer = setTimeout(
      run,
      failures > 0 && failures <= MAX_QUICK_HEARTBEAT_RETRIES
        ? heartbeatRetryDelayMs(intervalMs, random)
        : heartbeatDelayMs(intervalMs, random),
    );
  };
  const run = (): void => {
    const current = beat().catch(() => undefined);
    inFlight = current;
    void current.finally(() => {
      if (inFlight === current) {
        inFlight = undefined;
      }
    });
  };
  run();

  return {
    handlerSettled: () => {
      handlerSettled = true;
    },
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      // A heartbeat in flight is cancelled, and its race ends within
      // microtasks. Its HTTP request is aborted at once. An SDK call that
      // stalls before the request, for example on credentials, can still be
      // pending when the client is closed. Its late rejection is ignored.
      cancel.abort();
      await inFlight;
    },
  };
}

/**
 * Controls the heartbeats of one job.
 *
 * @internal
 */
export interface Heartbeats {
  /** Marks the handler as settled. The signal no longer fires after it. */
  handlerSettled(): void;
  /** Stops the heartbeats, cancels one in flight, and resolves when it ended. */
  stop(): Promise<void>;
}

/** The longest heartbeat interval, 15 minutes. */
const MAX_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1_000;

/**
 * Returns the heartbeat interval for a job.
 *
 * The default is a third of the heartbeat timeout, at most 15 minutes. An
 * explicit interval replaces the default. Either way the interval is at most
 * a third of the heartbeat timeout, so a large explicit interval cannot leave
 * the job without heartbeats. The job payload requires a heartbeat timeout
 * of at least 1 second, so the default interval is at least 333
 * milliseconds. An explicit interval can be shorter.
 *
 * @internal
 */
export function heartbeatIntervalMs(
  heartbeatTimeoutSeconds: number,
  overrideMs: number | undefined,
): number {
  const thirdMs = Math.max(
    1,
    Math.floor((heartbeatTimeoutSeconds * 1_000) / 3),
  );
  return Math.min(overrideMs ?? MAX_HEARTBEAT_INTERVAL_MS, thirdMs);
}

/**
 * Returns a source of numbers in [0, 1) that differs per job: the n-th call
 * returns the first 32 bits of SHA-256 of `<callbackId>:<n>`, scaled to [0, 1).
 *
 * Why not Math.random:
 *
 * 1. Lambda snapshots the running worker process when it builds the image.
 * 2. Math.random keeps its generator state in that process's memory.
 * 3. So every MicroVM restored from the snapshot starts with the same
 *    generator state, and the same calls return the same values.
 * 4. So MicroVMs that start together, for example from a `map`, would get
 *    the same heartbeat delays, and would retry failed heartbeats together.
 * 5. Each job has its own callback ID. So a hash of the ID differs per job,
 *    whatever the generator state is after a restore.
 *
 * @internal
 */
export function jitterSource(callbackId: string): () => number {
  let n = 0;
  return () =>
    createHash("sha256")
      .update(`${callbackId}:${n++}`)
      .digest()
      .readUInt32BE(0) /
    2 ** 32;
}

/** Failed heartbeats in a row that are retried after a short delay. */
const MAX_QUICK_HEARTBEAT_RETRIES = 2;

/**
 * Returns the delay before a heartbeat that follows a failed one: a value
 * between an eighth and a quarter of the interval, from `random`. The jitter
 * keeps MicroVMs that failed together from retrying together.
 *
 * @internal
 */
export function heartbeatRetryDelayMs(
  intervalMs: number,
  random: () => number,
): number {
  return Math.max(1, Math.floor(intervalMs / 4 - (random() * intervalMs) / 8));
}

/**
 * Returns how long one heartbeat call may take before it is aborted: half
 * the interval.
 *
 * With interval I, the heartbeat timeout is at least 3I. The wait after a
 * success is at most I minus a jitter j of at least min(1 s, I/2). The wait
 * after one of the first two failures in a row is at most I/4. Each call,
 * including the one that ends the gap, takes at most I/2. So the gap between
 * two successful heartbeats, from the end of one to the arrival of the next,
 * is at most:
 *
 * - no failure: I - j + I/2, about 1.5I;
 * - one failed or stalled call: I - j + I/2 + I/4 + I/2, about 2.25I;
 * - two in a row: I - j + 2 (I/2 + I/4) + I/2 = 3I - j, under the heartbeat
 *   timeout by the jitter.
 *
 * The bounds assume that the response of the last successful call arrives
 * promptly and that timers fire on time. The service's timer starts when it
 * receives that call, and a busy event loop delays every timer. Both come
 * out of the jitter in the two-failure case, a margin of 1 to 2 seconds, or
 * I/2 for an interval under 2 seconds. The other cases keep at least 0.75I.
 * A third failure in a row waits a full interval, and the job can then
 * reach its heartbeat timeout. A rejection, such as AccessDeniedException,
 * counts as a failure here too, so any two failures in a row keep the bound.
 *
 * An explicit interval of 1 millisecond gives a call timeout of 1
 * millisecond, more than I/2. Such an interval suits tests only.
 *
 * @internal
 */
export function heartbeatCallTimeoutMs(intervalMs: number): number {
  return Math.max(1, Math.floor(intervalMs / 2));
}

const MIN_HEARTBEAT_JITTER_MS = 1_000;
const MAX_HEARTBEAT_JITTER_MS = 2_000;

/**
 * Returns the delay before the next heartbeat.
 *
 * Many MicroVMs can start at the same moment, for example from a `map`. With a
 * fixed interval, their heartbeats would reach the service at the same
 * moments. So each delay is the interval minus 1 to 2 seconds. The value
 * comes from `random`, which {@link jitterSource} derives from the job's
 * callback ID.
 *
 * The jitter is subtracted, not added. So a heartbeat never arrives later
 * than the interval, and the interval stays below the heartbeat timeout. The
 * jitter is capped at half the interval. So a short interval stays positive.
 *
 * @internal
 */
export function heartbeatDelayMs(
  intervalMs: number,
  random: () => number,
): number {
  const jitterMs = Math.min(
    MIN_HEARTBEAT_JITTER_MS +
      random() * (MAX_HEARTBEAT_JITTER_MS - MIN_HEARTBEAT_JITTER_MS),
    intervalMs / 2,
  );
  return Math.round(intervalMs - jitterMs);
}

async function readJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > maxBytes) {
      throw new InvalidRunHookPayloadError(
        `request body exceeds ${maxBytes} bytes`,
      );
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidRunHookPayloadError("request body is not valid JSON");
  }
}

function respond(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Errors that show that the service, or the client, did nothing. */
const REJECTION_NAMES = new Set([
  "AccessDeniedException",
  "ValidationException",
  "ResourceNotFoundException",
  // Missing credentials stop the request before it is sent.
  "CredentialsProviderError",
]);

/**
 * Whether a failed call shows that the service did nothing: a known rejection,
 * or a 4xx other than 408, 409, and 429, on the client's first attempt.
 *
 * The client retries a 5xx, a throttle, and a network error, and reports only
 * the last attempt's error. An earlier attempt may have suspended the
 * MicroVM before its response was lost. So a rejection after more than one
 * attempt does not show that the service did nothing.
 */
function isRejectedRequest(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const metadata = (
    error as { $metadata?: { httpStatusCode?: number; attempts?: number } }
  ).$metadata;
  if (metadata?.attempts !== undefined && metadata.attempts > 1) {
    return false;
  }
  if (REJECTION_NAMES.has(error.name)) {
    return true;
  }
  const status = metadata?.httpStatusCode;
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

/** Describes an error for a log line, and never throws. */
function describe(value: unknown): unknown {
  if (!isError(value)) {
    return value;
  }
  return {
    name:
      textOr(
        safeGet(() => value.name),
        "Error",
      ) || "Error",
    message: textOr(
      safeGet(() => value.message),
      "unknown error",
    ),
  };
}

/**
 * Wraps a logger so that an error it throws, or a promise it returns that
 * rejects, is dropped.
 */
function safeLogger(inner: MicrovmWorkerLogger): MicrovmWorkerLogger {
  const guard =
    (write: MicrovmWorkerLogger["info"]): MicrovmWorkerLogger["info"] =>
    (message, data) => {
      try {
        // The type says void, but an async logger returns a promise. Its
        // rejection would otherwise be unhandled.
        const result: unknown = write.call(inner, message, data);
        if (
          result !== null &&
          typeof result === "object" &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          (result as PromiseLike<unknown>).then(undefined, () => undefined);
        }
      } catch {
        // A log line is not worth the worker process.
      }
    };
  return {
    info: guard(inner.info),
    warn: guard(inner.warn),
    error: guard(inner.error),
  };
}

const jsonLogger: MicrovmWorkerLogger = {
  info: (message, data) =>
    console.log(JSON.stringify({ level: "INFO", message, ...data })),
  warn: (message, data) =>
    console.warn(JSON.stringify({ level: "WARN", message, ...data })),
  error: (message, data) =>
    console.error(JSON.stringify({ level: "ERROR", message, ...data })),
};
