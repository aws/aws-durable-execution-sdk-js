import {
  CreateMicrovmAuthTokenCommand,
  type CreateMicrovmAuthTokenCommandOutput,
  type LambdaMicrovmsClient,
} from "@aws-sdk/client-lambda-microvms";
import { addRequestId, microvmNotFound, withRequestId } from "./aws-errors";
import { MicrovmDeliveryError } from "./errors";

/**
 * The MicroVM endpoint forwards to this port when no port header is sent.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const DEFAULT_MICROVM_PORT = 8080;

/**
 * The path that receives a job over HTTP when the caller names no route.
 *
 * The worker package serves this path with its `handler`. So the same handler
 * receives a job whether it arrives in the `run` hook or over HTTP. The value
 * must equal `MICROVM_JOB_PATH` in `@aws/durable-execution-sdk-js-microvm-worker`.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const DEFAULT_MICROVM_JOB_PATH = "/durable-execution/v1/job";

/** The default length of the first retry tier, inside one step attempt. */
export const DEFAULT_REQUEST_RETRY_WINDOW_MS = 60_000;

/**
 * The first retry tier stops this long before the invocation times out. A
 * Lambda timeout during a step attempt records no outcome for the attempt.
 * So the step keeps time to throw and to checkpoint the second-tier retry.
 */
export const INVOCATION_RESERVE_MS = 10_000;

/**
 * A call that would start with less than this much time before the reserve
 * is not started. A shorter call is unlikely to finish, and the step retries
 * the job in a later invocation anyway.
 */
const MIN_CALL_MS = 1_000;

const INITIAL_DELAY_MS = 250;
const MAX_DELAY_MS = 4_000;
const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_TOKEN_MINUTES = 5;

/**
 * The endpoint answers HTTP 502 with `x-aws-proxy-error:
 * MICROVM_CONNECT_FAILED` for a terminated MicroVM, for a suspended MicroVM
 * that the service does not resume, and for about 5 seconds after a
 * suspend. A probe measured the answer in about 60 to 200 milliseconds.
 */
const PROXY_ERROR_HEADER = "x-aws-proxy-error";
const CONNECT_FAILED = "MICROVM_CONNECT_FAILED";

/** The shortest time between two calls of {@link SendJobOptions.stateCheck}. */
const STATE_CHECK_INTERVAL_MS = 2_000;

/**
 * Returns the time by which every call of the first tier must end: the
 * start of the invocation reserve. Returns `undefined` when the compute
 * reports no deadline.
 *
 * A Lambda timeout during a step attempt records no outcome for the attempt.
 * So the reserve is a hard limit. A call that is still running at the reserve
 * uses the time that the step needs to throw and to checkpoint.
 */
export function reserveStartsAt(
  remainingTimeMs: (() => number | undefined) | undefined,
): number | undefined {
  const remaining = remainingTimeMs?.();
  // remainingTime() passes on the compute's value unchanged. So this check
  // turns a value that is not a finite number into no deadline.
  return remaining === undefined || !Number.isFinite(remaining)
    ? undefined
    : Date.now() + remaining - INVOCATION_RESERVE_MS;
}

/**
 * Returns how long the next call may run: at most `capMs`, and never past
 * `hardDeadline`. Throws the result of `onExpired` when less than
 * {@link MIN_CALL_MS} remains before `hardDeadline`.
 */
function callBudgetMs(
  hardDeadline: number | undefined,
  capMs: number,
  onExpired: () => Error,
): number {
  if (hardDeadline === undefined) {
    return capMs;
  }
  const left = hardDeadline - Date.now();
  if (left < MIN_CALL_MS) {
    throw onExpired();
  }
  return Math.min(capMs, left);
}

/**
 * Runs one AWS SDK call that must end before `hardDeadline`.
 *
 * 1. Without a deadline, the call runs with the client's own settings.
 * 2. With a deadline, the call gets an abort signal that fires at the
 *    deadline. The signal also stops the AWS SDK's own retries of the call.
 * 3. An aborted call throws the result of `onExpired`. That error is
 *    retryable, so the step retries the job in a later invocation. The
 *    AWS SDK's `AbortError` is not retryable, so it is not rethrown.
 *
 * @internal
 */
export async function callBeforeDeadline<T>(
  call: (options: { abortSignal?: AbortSignal }) => Promise<T>,
  hardDeadline: number | undefined,
  onExpired: () => Error,
): Promise<T> {
  if (hardDeadline === undefined) {
    return call({});
  }
  const signal = AbortSignal.timeout(
    callBudgetMs(hardDeadline, Number.MAX_SAFE_INTEGER, onExpired),
  );
  try {
    return await call({ abortSignal: signal });
  } catch (error) {
    if (signal.aborted) {
      throw onExpired();
    }
    throw error;
  }
}

/**
 * Thrown when the endpoint rejects the job with a status that a retry cannot
 * change, such as 400 or 404. A redirect, 3xx, is rejected too, because the
 * request step does not follow redirects. So is a redirect that a custom
 * `fetch` followed, and `status` is then the status of the final response.
 * The default step retry strategy does not retry it.
 *
 * @remarks
 * This error and {@link MicrovmRequestUnauthorizedError} and
 * {@link MicrovmEndpointUnavailableError} are thrown inside the request step.
 * Only the step retry strategy sees them. When the step fails, the operation
 * reports a {@link MicrovmDeliveryError} or a `MicrovmNotRunningError`.
 * The name of this error is in the checkpointed step error type and in the
 * message.
 *
 * Each of them extends {@link MicrovmDeliveryError}, and records its own name
 * as its checkpointed type, as it did before it extended it.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmRequestRejectedError extends MicrovmDeliveryError {
  override readonly name = "MicrovmRequestRejectedError";
  readonly errorType: string = "MicrovmRequestRejectedError";

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Thrown when the endpoint refuses the job with 401 or 403 even after a new
 * auth token. The default step retry strategy retries it, outside the
 * invocation.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmRequestUnauthorizedError extends MicrovmDeliveryError {
  override readonly name = "MicrovmRequestUnauthorizedError";
  readonly errorType: string = "MicrovmRequestUnauthorizedError";

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Thrown when the first retry tier ends without an accepted request. The
 * default step retry strategy retries it, outside the invocation.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmEndpointUnavailableError extends MicrovmDeliveryError {
  override readonly name = "MicrovmEndpointUnavailableError";
  readonly errorType: string = "MicrovmEndpointUnavailableError";

  /**
   * Takes the same arguments as the `Error` constructor, which this class
   * extended before it extended {@link MicrovmDeliveryError}.
   */
  constructor(message?: string, options?: ErrorOptions) {
    super(message ?? "");
    // As in Error: a second argument that is not an object is ignored.
    const value: unknown = options;
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      "cause" in value
    ) {
      this.cause = (value as ErrorOptions).cause as Error;
    }
  }
}

/**
 * Throws when the request step has too little time left to make its first
 * call.
 *
 * A call that would start with less than {@link MIN_CALL_MS} before the
 * invocation reserve does not start. So with less than 11 seconds left, the
 * step makes no call, and the first tier's own error would blame the
 * MicroVM. The cause is the function timeout. The error stays retryable: a
 * retry in a new invocation has more time when this invocation spent its
 * time before the step.
 *
 * The message rounds the time down. So it never reads "11.0 seconds left" next
 * to "needs at least 11 seconds".
 *
 * @internal
 */
export function assertTimeToDeliver(
  remainingTimeMs: (() => number | undefined) | undefined,
): void {
  const remaining = remainingTimeMs?.();
  const neededMs = INVOCATION_RESERVE_MS + MIN_CALL_MS;
  if (
    remaining !== undefined &&
    Number.isFinite(remaining) &&
    remaining < neededMs
  ) {
    throw new MicrovmEndpointUnavailableError(
      `The request step had ${(Math.floor(remaining / 100) / 10).toFixed(1)} seconds left in the Lambda invocation, and it needs at least ${neededMs / 1000} seconds to send the job. Raise the function timeout.`,
    );
  }
}

export interface SendJobOptions {
  client: LambdaMicrovmsClient;
  fetch: typeof fetch;
  microvmId: string;
  endpoint: string;
  path: string;
  port: number;
  body: string;
  /** The first-tier retry window in milliseconds. */
  retryWindowMs: number;
  /**
   * The remaining invocation time. `undefined`, as a value or as a result,
   * means the compute reports no deadline, and only the retry window applies.
   * A result that is not a finite number means the same.
   */
  remainingTimeMs?: () => number | undefined;
  log: (message: string, data: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Checks the MicroVM state once. It throws for a MicroVM that has ended,
   * and returns the current endpoint.
   *
   * Every job over HTTP sets it, from `microvm` and from a session. A
   * terminated MicroVM gets no answer to a request, or its endpoint answers
   * HTTP 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, measured in
   * us-east-1. A suspending or suspended MicroVM gives the same signs. So
   * the next attempt calls it after either sign, at most once per 2
   * seconds. A booting MicroVM gets neither sign, because its endpoint holds
   * the request until the worker listens. That holds unless the worker
   * takes more than 10 seconds to start listening. Then the first delivery
   * gets no answer, and the operation makes one GetMicrovm call. So a job
   * whose MicroVM runs makes no extra call, except in that case.
   *
   * The call runs before the retry window and the backoff decide. So the
   * window does not limit it, and only the invocation reserve does. At the
   * reserve, the call does not start. `undefined` from it keeps the current
   * endpoint.
   */
  stateCheck?: () => Promise<string | undefined>;
}

/**
 * Delivers one job to a MicroVM route. It is the first retry tier: it runs
 * inside one step attempt.
 *
 * @remarks
 * The function handles each failure this way:
 *
 * - A connection error, 429, or any 5xx: wait and retry. The endpoint can
 *   answer this way while the MicroVM starts.
 * - 401 or 403: create a new auth token and retry once. A second 401 or 403
 *   in the same attempt throws {@link MicrovmRequestUnauthorizedError}, and
 *   the step retry strategy takes over.
 * - Any other 4xx: throw {@link MicrovmRequestRejectedError} at once.
 * - CreateMicrovmAuthToken answers `ResourceNotFoundException`, for the first
 *   token or for the new one: throw `MicrovmStateError` at once. The MicroVM
 *   no longer exists.
 * - A redirect, 3xx: throw {@link MicrovmRequestRejectedError} at once. A
 *   followed 301, 302, or 303 would turn the POST into a GET without the job,
 *   and a followed redirect to another host would receive the auth token. A
 *   custom `fetch` that follows the redirect anyway fails the same way. The
 *   server sets the `Location` header. A query in the `Location` can hold a
 *   secret, for example a presigned signature. The step failure is
 *   checkpointed. So the message names the path, and the status of a 3xx
 *   answer. It omits the `Location`, and the URL that a followed redirect
 *   reached.
 *
 * The backoff starts at 250 milliseconds and doubles up to 4 seconds. The
 * tier ends at the retry window, or 10 seconds before the invocation times
 * out, whichever comes first. It then throws
 * {@link MicrovmEndpointUnavailableError}, and the step retry strategy takes
 * over.
 *
 * The two limits differ:
 *
 * - The retry window limits when an attempt may start. An attempt that
 *   starts inside the window may end after it.
 * - The invocation reserve limits when every call must end. Each request and
 *   each `CreateMicrovmAuthToken` call stops at the reserve. A call that
 *   would start with less than 1 second before the reserve does not start.
 *   A Lambda timeout during the attempt would record no outcome, and the
 *   reserve exists to prevent that.
 *
 * The endpoint can accept a request before Lambda has sent the `run` hook.
 * So the job request carries the MicroVM identifier too.
 *
 * A request can reach the MicroVM while its response is lost. The next
 * request then delivers the same job again. The worker ignores a second
 * request for a callback ID that runs or recently ended, so the job still
 * runs once.
 *
 * With {@link SendJobOptions.stateCheck}, a job checks the MicroVM state
 * after a 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED` or a request
 * without an answer, at most once per 2 seconds. That check runs first,
 * before the retry window and the backoff decide, so a short window cannot
 * skip it. A check that finds the
 * MicroVM terminating, terminated, or removed throws `MicrovmStateError`,
 * and the job fails with `MicrovmNotRunningError`. Otherwise the function
 * sends the job again to the endpoint that the check reports.
 *
 * The function does not resume a suspended MicroVM. The service resumes a
 * MicroVM that was launched with `idlePolicy.autoResumeEnabled: true` when a
 * request arrives. For about 5 seconds after a suspend, the endpoint
 * answers that 502 and does not resume the MicroVM, measured in us-east-1.
 * The backoff reaches 7.75 seconds after 5 retries. So the retries outlast
 * that window. With a `retryWindow` under about 9 seconds, the step retry
 * strategy covers the rest of that window, at the cost of one or two more
 * step attempts. A job sent right after a suspend can take up to about 10
 * seconds.
 *
 * @returns The status that accepted the job.
 */
export async function sendJob(options: SendJobOptions): Promise<number> {
  assertTimeToDeliver(options.remainingTimeMs);
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  const deadline = (): number => {
    const byWindow = started + options.retryWindowMs;
    const reserve = reserveStartsAt(options.remainingTimeMs);
    // A NaN deadline would make every comparison false, and Infinity means
    // no deadline. reserveStartsAt returns undefined for both. So only the
    // window applies then.
    return reserve === undefined ? byWindow : Math.min(byWindow, reserve);
  };

  let attempt = 0;
  let lastFailure = "no attempt";
  const unavailable = (): MicrovmEndpointUnavailableError =>
    new MicrovmEndpointUnavailableError(
      `The MicroVM did not accept the job at ${options.path} after ${attempt} attempts in ${Date.now() - started} ms. Last failure: ${lastFailure}.`,
    );
  const newToken = (): Promise<Record<string, string>> =>
    callBeforeDeadline(
      (sendOptions) => createAuthToken(options, sendOptions),
      reserveStartsAt(options.remainingTimeMs),
      unavailable,
    );

  let endpoint = options.endpoint;
  let url = endpointUrl(endpoint, options.path);
  let token = await newToken();
  let refreshedToken = false;
  let delay = INITIAL_DELAY_MS;
  let lastStateCheck: number | undefined;

  for (attempt = 1; ; attempt++) {
    // The request must end before the reserve, like every call in the tier.
    const timeoutMs = callBudgetMs(
      reserveStartsAt(options.remainingTimeMs),
      REQUEST_TIMEOUT_MS,
      unavailable,
    );
    let status: number | undefined;
    let hasLocation = false;
    let followed = false;
    let connectFailed = false;
    try {
      const response = await options.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...token,
          ...(options.port !== DEFAULT_MICROVM_PORT && {
            "X-aws-proxy-port": String(options.port),
          }),
        },
        body: options.body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      hasLocation = Boolean(response.headers.get("location"));
      followed = response.redirected;
      connectFailed =
        status === 502 &&
        response.headers.get(PROXY_ERROR_HEADER) === CONNECT_FAILED;
      // The body is not used. Reading it releases the connection.
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      lastFailure = `${(error as Error).name}: ${(error as Error).message}`;
    }

    if (status !== undefined && followed) {
      // A custom fetch that does not pass `redirect` on followed a redirect.
      // A followed 301, 302, or 303 drops the job, and a followed 307 or 308
      // sent it to a route that the caller did not set. So the step fails
      // either way.
      throw new MicrovmRequestRejectedError(
        `The MicroVM answered the job at ${options.path} with a redirect, and the fetch function followed it. The operation does not follow redirects, so set the path that the route serves, and make the fetch function honor init.redirect.`,
        status,
      );
    }
    if (status !== undefined && status >= 200 && status < 300) {
      options.log("job accepted", { attempt, status });
      return status;
    }
    if (status !== undefined) {
      lastFailure = `HTTP ${status}`;
      if (status === 401 || status === 403) {
        if (refreshedToken) {
          throw new MicrovmRequestUnauthorizedError(
            `The MicroVM refused a new auth token at ${options.path} with HTTP ${status}`,
            status,
          );
        }
        refreshedToken = true;
        // The refresh checks the reserve like every other call. The next
        // request then checks it again.
        token = await newToken();
        options.log("auth token refreshed", { attempt, status });
        continue;
      }
      if (status >= 300 && status < 400) {
        // A 3xx without a Location, such as a 304, is not a redirect, but it
        // does not accept the job either.
        throw new MicrovmRequestRejectedError(
          hasLocation
            ? `The MicroVM answered the job at ${options.path} with HTTP ${status}, a redirect. The operation does not follow redirects, so set the path that the route serves.`
            : `The MicroVM answered the job at ${options.path} with HTTP ${status}`,
          status,
        );
      }
      if (
        status >= 400 &&
        status < 500 &&
        status !== 401 &&
        status !== 403 &&
        status !== 429
      ) {
        throw new MicrovmRequestRejectedError(
          `The MicroVM rejected the job at ${options.path} with HTTP ${status}`,
          status,
        );
      }
    }

    // A failed request or a 502 with MICROVM_CONNECT_FAILED can mean that
    // the MicroVM ended. So the job checks the state first, before the
    // window and the backoff decide, and the check throws for a MicroVM that
    // ended. A booting MicroVM gives no such sign, unless the worker takes
    // more than 10 seconds to start listening. A suspended MicroVM gives the
    // same signs, and the check lets the job retry. The check repeats after
    // each such failure, at most once per 2 seconds. Only the invocation
    // reserve limits it, so a short retry window cannot skip it.
    if (
      options.stateCheck &&
      (status === undefined || connectFailed) &&
      (lastStateCheck === undefined ||
        Date.now() - lastStateCheck >= STATE_CHECK_INTERVAL_MS)
    ) {
      // At the reserve, no call starts, and the tier ends as without a check.
      callBudgetMs(reserveStartsAt(options.remainingTimeMs), 0, unavailable);
      lastStateCheck = Date.now();
      endpoint = (await options.stateCheck()) ?? endpoint;
      url = endpointUrl(endpoint, options.path);
    }

    if (Date.now() + delay > deadline()) {
      throw unavailable();
    }
    options.log("job not accepted yet", { attempt, failure: lastFailure });
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}

/**
 * Calls CreateMicrovmAuthToken and returns the auth token headers.
 *
 * The request step calls it before the first request, and again after a 401
 * or 403. Each call handles a failure this way:
 *
 * - `ResourceNotFoundException`: the MicroVM was removed after the launch or
 *   after the state check. So the call throws the same
 *   `MicrovmStateError` as GetMicrovm. The step fails
 *   at once, and the job fails with `MicrovmNotRunningError`.
 * - Any other error: the call rethrows the same error object. An error of
 *   the Lambda MicroVMs service gets the request ID in its message. See
 *   {@link addRequestId}.
 * - An answer without `authToken`: the call throws an `Error` whose message
 *   ends with the request ID of the answer.
 */
async function createAuthToken(
  options: SendJobOptions,
  sendOptions: { abortSignal?: AbortSignal },
): Promise<Record<string, string>> {
  let response: CreateMicrovmAuthTokenCommandOutput;
  try {
    response = await options.client.send(
      new CreateMicrovmAuthTokenCommand({
        microvmIdentifier: options.microvmId,
        expirationInMinutes: AUTH_TOKEN_MINUTES,
        allowedPorts: [{ port: options.port }],
      }),
      sendOptions,
    );
  } catch (error) {
    if ((error as Error).name === "ResourceNotFoundException") {
      throw microvmNotFound(options.microvmId, "CreateMicrovmAuthToken", error);
    }
    throw addRequestId("CreateMicrovmAuthToken", error);
  }
  if (!response.authToken) {
    throw new Error(
      withRequestId(
        "CreateMicrovmAuthToken returned no authToken",
        "CreateMicrovmAuthToken",
        response,
      ),
    );
  }
  return response.authToken;
}

/**
 * RunMicrovm returns the endpoint as a host name without a scheme.
 *
 * `fetch` parses the URL with the WHATWG URL parser, which can change the
 * path. `validateRequest` accepts only RFC 3986 paths without a `.` or `..`
 * segment, and the parser leaves each of them unchanged. So the worker
 * receives the path as written.
 */
function endpointUrl(endpoint: string, path: string): string {
  const base = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`;
  return `${base.replace(/\/+$/, "")}${path}`;
}
