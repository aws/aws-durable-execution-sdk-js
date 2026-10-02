import {
  CreateMicrovmAuthTokenCommand,
  type LambdaMicrovmsClient,
} from "@aws-sdk/client-lambda-microvms";

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

const INITIAL_DELAY_MS = 250;
const MAX_DELAY_MS = 4_000;
const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_TOKEN_MINUTES = 5;

/**
 * Thrown when the endpoint rejects the job with a status that a retry cannot
 * change, such as 400 or 404. The default step retry strategy does not retry
 * it.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmRequestRejectedError extends Error {
  override readonly name = "MicrovmRequestRejectedError";

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
export class MicrovmRequestUnauthorizedError extends Error {
  override readonly name = "MicrovmRequestUnauthorizedError";

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
export class MicrovmEndpointUnavailableError extends Error {
  override readonly name = "MicrovmEndpointUnavailableError";
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
   * When the retry window started, in milliseconds since the epoch. The
   * default is the moment `sendJob` is called. A session sets it to the start
   * of the state check that runs before delivery. So the wait for a resume
   * and the request's own retries share one window.
   */
  windowStartedAt?: number;
  /**
   * The remaining invocation time. `undefined`, as a value or as a result,
   * means the compute reports no deadline, and only the retry window applies.
   */
  remainingTimeMs?: () => number | undefined;
  log: (message: string, data: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Makes sure the MicroVM runs, and returns its current endpoint. A session
   * sets it, because its MicroVM can suspend itself while no job runs. The
   * suspend can land between the state check before delivery and the
   * request. The endpoint then answers 502, or the worker answers 503 while
   * it suspends. So after a 502, 503, or 504, or a request that failed
   * without a status, such as a refused connection or a timeout, the next
   * attempt calls this first.
   *
   * `maxWaitMs` is what remains of the retry tier. So the wait for a resume
   * never extends the tier.
   */
  recheck?: (maxWaitMs: number) => Promise<string | undefined>;
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
 *
 * The backoff starts at 250 milliseconds and doubles up to 4 seconds. The
 * tier ends at the retry window, or 10 seconds before the invocation times
 * out, whichever comes first. It then throws
 * {@link MicrovmEndpointUnavailableError}, and the step retry strategy takes
 * over.
 *
 * The endpoint can accept a request before Lambda has sent the `run` hook.
 * So the job request carries the MicroVM identifier too.
 *
 * A request can reach the MicroVM while its response is lost. The next
 * request then delivers the same job again. The worker ignores a second
 * request for a callback ID that runs or recently ended, so the job still
 * runs once.
 *
 * @returns The status that accepted the job.
 */
export async function sendJob(options: SendJobOptions): Promise<number> {
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)));
  const started = options.windowStartedAt ?? Date.now();
  const deadline = (): number => {
    const byWindow = started + options.retryWindowMs;
    const remaining = options.remainingTimeMs?.();
    // remainingTime() already turns a value that is not a finite number into
    // undefined. This check also covers a caller that passes its own reader.
    // A NaN deadline would make every comparison false, and Infinity means no
    // deadline. So both count as unknown, and only the window applies.
    return remaining === undefined || !Number.isFinite(remaining)
      ? byWindow
      : Math.min(byWindow, Date.now() + remaining - INVOCATION_RESERVE_MS);
  };

  let endpoint = options.endpoint;
  let url = endpointUrl(endpoint, options.path);
  let token = await createAuthToken(options);
  let refreshedToken = false;
  let delay = INITIAL_DELAY_MS;
  let lastFailure = "no attempt";

  for (let attempt = 1; ; attempt++) {
    let status: number | undefined;
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      // The body is not used. Reading it releases the connection.
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      lastFailure = `${(error as Error).name}: ${(error as Error).message}`;
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
        token = await createAuthToken(options);
        options.log("auth token refreshed", { attempt, status });
        continue;
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

    const unavailable = (): MicrovmEndpointUnavailableError =>
      new MicrovmEndpointUnavailableError(
        `The MicroVM did not accept the job at ${options.path} after ${attempt} attempts in ${Date.now() - started} ms. Last failure: ${lastFailure}.`,
      );
    if (Date.now() + delay > deadline()) {
      throw unavailable();
    }
    options.log("job not accepted yet", { attempt, failure: lastFailure });
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
    // A failed request or a gateway error can mean that the MicroVM
    // suspended itself. So a session checks the state, and resumes the
    // MicroVM, before it retries.
    if (
      options.recheck &&
      (status === undefined || (status >= 502 && status <= 504))
    ) {
      const remainingMs = deadline() - Date.now();
      if (remainingMs <= 0) {
        throw unavailable();
      }
      endpoint = (await options.recheck(remainingMs)) ?? endpoint;
      url = endpointUrl(endpoint, options.path);
    }
  }
}

async function createAuthToken(
  options: SendJobOptions,
): Promise<Record<string, string>> {
  const response = await options.client.send(
    new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: options.microvmId,
      expirationInMinutes: AUTH_TOKEN_MINUTES,
      allowedPorts: [{ port: options.port }],
    }),
  );
  if (!response.authToken) {
    throw new Error("CreateMicrovmAuthToken returned no authToken");
  }
  return response.authToken;
}

/** RunMicrovm returns the endpoint as a host name without a scheme. */
function endpointUrl(endpoint: string, path: string): string {
  const base = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`;
  return `${base.replace(/\/+$/, "")}${path}`;
}
