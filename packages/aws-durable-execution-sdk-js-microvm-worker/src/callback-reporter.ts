import {
  LambdaClient,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";

/**
 * SendDurableExecutionCallbackSuccess accepts a result of at most 256 KB.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_CALLBACK_RESULT_BYTES = 256 * 1024;

/**
 * The longest error message that the worker sends. A handler error can embed
 * a large response body. The message reaches the durable execution history,
 * so the worker keeps it short.
 */
const MAX_ERROR_MESSAGE_CHARS = 8 * 1024;

/** The longest error type that the worker sends. */
const MAX_ERROR_TYPE_CHARS = 256;

/**
 * Error names that mean the callback can no longer be completed.
 *
 * `CallbackTimeoutException` means the callback or its heartbeat timed out.
 * `InvalidParameterValueException` means the service does not accept the
 * callback ID, for example because the callback is already complete.
 * `ResourceNotFoundException` means the callback does not exist. A later
 * attempt fails the same way, so none of them is retried.
 */
const TERMINAL_ERROR_NAMES: ReadonlySet<string> = new Set([
  "CallbackTimeoutException",
  "InvalidParameterValueException",
  "ResourceNotFoundException",
]);

const COMPLETION_ATTEMPTS = 5;

/**
 * How long one completion attempt may take. A request on a dead connection
 * would otherwise wait for the operating system's TCP timeout, which is
 * minutes. A timed-out attempt is retried like any transient failure.
 */
const COMPLETION_CALL_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_DELAY_MS = 16_000;

/**
 * Returns true when an error from a callback API means the durable function
 * no longer accepts results for this callback.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function isTerminalCallbackError(error: unknown): boolean {
  return (
    isError(error) &&
    TERMINAL_ERROR_NAMES.has(
      safeString(
        safeGet(() => error.name),
        "",
      ),
    )
  );
}

/**
 * `value instanceof Error`, and `false` instead of a throw. A Proxy whose
 * `getPrototypeOf` trap throws makes `instanceof` throw.
 *
 * @internal
 */
export function isError(value: unknown): value is Error {
  return safeGet(() => value instanceof Error) === true;
}

/**
 * Returns `value` as text, or `fallback` when the value is missing or cannot
 * be converted. A string is returned as it is, and never throws.
 *
 * @internal
 */
export function textOr(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return safeString(value, fallback);
}

/**
 * Thrown by {@link CallbackReporter.succeed} when the result cannot be
 * serialized as JSON, for example because it has a cycle or a BigInt. No
 * call is made, so the caller can report a failure instead.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class ResultSerializationError extends TypeError {
  constructor(cause: unknown) {
    super(
      `The job result is not JSON-serializable: ${textOr(
        isError(cause) ? safeGet(() => cause.message) : cause,
        "unknown error",
      )}`,
      { cause },
    );
    this.name = "ResultSerializationError";
  }
}

/**
 * The error of a job result that is larger than
 * {@link MAX_CALLBACK_RESULT_BYTES} once serialized. No call is made for
 * such a result.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class ResultTooLargeError extends RangeError {
  /** The size of the serialized result, in bytes. */
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `The job result is ${bytes} bytes, and SendDurableExecutionCallbackSuccess accepts at most ${MAX_CALLBACK_RESULT_BYTES}. Store large results elsewhere, for example in S3, and return a reference.`,
    );
    this.name = "ResultTooLargeError";
    this.bytes = bytes;
  }
}

/**
 * Converts a value to a string, and never throws. A value without a usable
 * `toString`, such as `Object.create(null)`, returns `fallback`.
 *
 * @internal
 */
export function safeString(value: unknown, fallback: string): string {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

/**
 * Reads a property through `read`, and returns `undefined` when a getter
 * throws.
 *
 * @internal
 */
export function safeGet<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Expired credentials are refreshed by the credential provider. So a later
 * attempt can succeed, although the service answers 403.
 */
const EXPIRED_CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  "ExpiredTokenException",
  "ExpiredToken",
]);

/**
 * 4xx errors that a later attempt can fix: throttling, and a signature that
 * the service rejected because of a clock offset. The names are those of
 * `@smithy/service-error-classification` 4.2.12. The AWS SDK retries some of
 * them itself, but not a clock offset below its 240 second correction
 * threshold, for example a stale offset after a clock step.
 */
const TRANSIENT_4XX_NAMES: ReadonlySet<string> = new Set([
  ...EXPIRED_CREDENTIAL_NAMES,
  // Clock skew.
  "AuthFailure",
  "InvalidSignatureException",
  "RequestExpired",
  "RequestInTheFuture",
  "RequestTimeTooSkewed",
  "SignatureDoesNotMatch",
  // Throttling.
  "BandwidthLimitExceeded",
  "EC2ThrottledException",
  "LimitExceededException",
  "PriorRequestNotComplete",
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "RequestThrottled",
  "RequestThrottledException",
  "SlowDown",
  "ThrottledException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
  "TransactionInProgressException",
]);

/**
 * Whether a failed callback call is unlikely to succeed on a later attempt:
 * a terminal callback error, or a 4xx other than 408, 409, and 429, such as
 * `AccessDeniedException`. Throttling, clock-skew, and expired-credential
 * errors are retried, and so is an error that the SDK marks as retryable.
 * `CredentialsProviderError` is retried too: the SDK raises it both for
 * missing credentials and for a credential endpoint that did not answer in
 * time, which is likely right after a MicroVM starts or resumes.
 *
 * An `AccessDeniedException` can still clear later, for example while an IAM
 * change propagates. So a caller that loses a job by giving up, such as the
 * heartbeats, should keep trying, as the heartbeats do.
 *
 * @internal
 */
export function isPermanentError(error: unknown): boolean {
  if (isTerminalCallbackError(error)) {
    return true;
  }
  if (!isError(error)) {
    return false;
  }
  if (
    TRANSIENT_4XX_NAMES.has(
      safeString(
        safeGet(() => error.name),
        "",
      ),
    ) ||
    safeGet(() => (error as { $retryable?: unknown }).$retryable) !== undefined
  ) {
    return false;
  }
  const status = safeGet(
    () =>
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode,
  );
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

/** The error of a call that was cancelled because the job ended. */
function cancelledError(label: string): Error {
  return Object.assign(new Error(`the ${label} call was cancelled`), {
    name: "AbortError",
  });
}

/**
 * Cuts a string to at most `max` UTF-16 code units, ending in "...". The cut
 * never splits a surrogate pair, so the result has no lone surrogate.
 */
const truncate = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  let end = max - 3;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end--;
  }
  return `${value.slice(0, end)}...`;
};

/**
 * Options for {@link CallbackReporter}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface CallbackReporterOptions {
  /** The callback ID from the run hook payload. */
  callbackId: string;
  /** The Region of the durable function. */
  region: string;
  /**
   * The Lambda client. Defaults to a client for `region` that uses the
   * default credential chain, which resolves the MicroVM execution role.
   */
  client?: LambdaClient;
  /** Waits between completion attempts. Tests replace it. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Receives a warning when a completion was probably delivered by an
   * earlier attempt whose answer never arrived. Defaults to no logging.
   */
  warn?: (message: string, data?: Record<string, unknown>) => void;
}

/** The number of tries the AWS SDK made inside one call, when it reports it. */
function sdkAttemptsOf(error: unknown): number | undefined {
  return safeGet(
    () => (error as { $metadata?: { attempts?: number } }).$metadata?.attempts,
  );
}

/**
 * Whether a failed attempt leaves open whether the service applied it: an
 * error without an HTTP status, such as a timeout or a dropped connection,
 * or a server error. A credential error on the only try is certain: no
 * request was sent.
 */
function isUncertainOutcome(error: unknown): boolean {
  // An SDK retry inside the attempt means that an earlier try may have
  // reached the service, whatever the last try failed with.
  if ((sdkAttemptsOf(error) ?? 1) > 1) {
    return true;
  }
  if (safeGet(() => (error as Error).name) === "CredentialsProviderError") {
    return false;
  }
  const status = safeGet(
    () =>
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode,
  );
  return status === undefined || status >= 500;
}

/**
 * Reports heartbeats and the job outcome for one durable callback.
 *
 * @remarks
 * Create the reporter after the `run` hook, not at image build. Lambda
 * snapshots the running process at build time. A client created then would
 * carry build-time state into every MicroVM.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class CallbackReporter {
  readonly callbackId: string;
  private readonly client: LambdaClient;
  private readonly ownsClient: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly warn: NonNullable<CallbackReporterOptions["warn"]>;

  constructor(options: CallbackReporterOptions) {
    this.callbackId = options.callbackId;
    this.ownsClient = options.client === undefined;
    this.client =
      options.client ?? new LambdaClient({ region: options.region });
    this.warn = options.warn ?? (() => undefined);
    this.sleep =
      options.sleep ??
      ((ms): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Releases the connections of a client that the reporter created itself.
   * A client passed in `client` stays open, because the caller owns it.
   */
  close(): void {
    if (this.ownsClient) {
      this.client.destroy();
    }
  }

  /**
   * Sends one heartbeat.
   *
   * @param timeoutMs - Aborts the call after this many milliseconds. A
   * stalled call would otherwise hold back every later heartbeat.
   * @param cancel - Ends the call at once when it fires, including a call
   * that is still resolving credentials.
   * @throws The service error. Use {@link isTerminalCallbackError} to tell a
   * callback that is gone from a transient failure. A `TimeoutError` when
   * the call took longer than `timeoutMs`, and an `AbortError` when `cancel`
   * fired.
   */
  async heartbeat(timeoutMs?: number, cancel?: AbortSignal): Promise<void> {
    await this.send(
      new SendDurableExecutionCallbackHeartbeatCommand({
        CallbackId: this.callbackId,
      }),
      timeoutMs,
      "heartbeat",
      cancel,
    );
  }

  /**
   * Sends one command. The call ends early after `timeoutMs`, or when
   * `cancel` fires: a per-call abort signal cancels the HTTP request, and
   * the race also ends the credential and endpoint resolution that run
   * before it. A call that settles later is ignored.
   *
   * The per-call signal is a plain AbortController, not `AbortSignal.any`
   * over the job's cancel signal. On Node 22 (other versions may differ),
   * `AbortSignal.any` keeps an entry on its source for every call until the
   * source is released, so a long job would grow its memory with every
   * heartbeat.
   */
  private async send(
    command:
      | SendDurableExecutionCallbackHeartbeatCommand
      | SendDurableExecutionCallbackSuccessCommand
      | SendDurableExecutionCallbackFailureCommand,
    timeoutMs: number | undefined,
    label: string,
    cancel?: AbortSignal,
  ): Promise<void> {
    if (cancel?.aborted) {
      throw cancelledError(label);
    }
    const bounded = timeoutMs !== undefined || cancel !== undefined;
    const abort = bounded ? new AbortController() : undefined;
    // The three commands share a client, but their overloads differ. The
    // cast picks the generic overload.
    const call = (
      this.client.send as (
        command: unknown,
        options?: { abortSignal?: AbortSignal },
      ) => Promise<unknown>
    ).call(
      this.client,
      command,
      abort === undefined ? undefined : { abortSignal: abort.signal },
    );
    if (abort === undefined) {
      await call;
      return;
    }
    call.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    let onCancel: (() => void) | undefined;
    try {
      await Promise.race([
        call,
        new Promise<never>((_resolve, reject) => {
          const end = (error: Error): void => {
            abort.abort(error);
            reject(error);
          };
          // A cancelled call ends at once, without waiting for its timeout.
          onCancel = () => end(cancelledError(label));
          cancel?.addEventListener("abort", onCancel, { once: true });
          if (timeoutMs === undefined) {
            return;
          }
          timer = setTimeout(
            () =>
              end(
                Object.assign(
                  new Error(
                    `the ${label} call took longer than ${timeoutMs} ms`,
                  ),
                  { name: "TimeoutError" },
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onCancel !== undefined) {
        cancel?.removeEventListener("abort", onCancel);
      }
    }
  }

  /**
   * Completes the callback with a result.
   *
   * @param result - A JSON-serializable value. `undefined` sends no result,
   * and the durable function receives `undefined`.
   * @throws \{ResultTooLargeError\} When the serialized result exceeds
   * 256 KB. It extends `RangeError`. No call is made in that case, so the
   * caller can report a failure instead.
   * @throws \{ResultSerializationError\} When the result cannot be serialized
   * as JSON. No call is made in that case either.
   * @throws The last error when every attempt fails: a service error, or a
   * `TimeoutError` or `AbortError` when the last attempt got no answer. An
   * "already complete" answer after an attempt without an answer resolves
   * with a warning instead.
   */
  async succeed(result: unknown): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(result);
    } catch (error) {
      throw new ResultSerializationError(error);
    }
    const bytes = json === undefined ? undefined : Buffer.from(json, "utf8");
    if (bytes !== undefined && bytes.byteLength > MAX_CALLBACK_RESULT_BYTES) {
      throw new ResultTooLargeError(bytes.byteLength);
    }
    await this.withRetry(() =>
      this.send(
        new SendDurableExecutionCallbackSuccessCommand({
          CallbackId: this.callbackId,
          Result: bytes,
        }),
        COMPLETION_CALL_TIMEOUT_MS,
        "completion",
      ),
    );
  }

  /**
   * Completes the callback with an error.
   *
   * @param error - The job's error. The durable function receives its name
   * and message, cut to 256 and 8,192 characters. The stack is not sent,
   * like the core SDK, because it would expose the image's file paths in the
   * durable execution history.
   * @throws The last error when every attempt fails: a service error, or a
   * `TimeoutError` or `AbortError` when the last attempt got no answer. An
   * "already complete" answer after an attempt without an answer resolves
   * with a warning instead.
   */
  async fail(error: unknown): Promise<void> {
    // The payload is built once, before the retries. A value with a throwing
    // getter or no usable toString must still be reported, not fail every
    // attempt the same way.
    // A missing or unreadable name becomes "Error", and a missing or
    // unreadable message becomes "unknown error". An empty message stays
    // empty, as `new Error()` sends it.
    const errorLike = isError(error);
    const name = errorLike ? safeGet(() => error.name) : "Error";
    const message = errorLike ? safeGet(() => error.message) : error;
    const errorType = truncate(
      textOr(name, "Error") || "Error",
      MAX_ERROR_TYPE_CHARS,
    );
    const errorMessage = truncate(
      textOr(message, "unknown error"),
      MAX_ERROR_MESSAGE_CHARS,
    );
    await this.withRetry(() =>
      this.send(
        new SendDurableExecutionCallbackFailureCommand({
          CallbackId: this.callbackId,
          Error: { ErrorType: errorType, ErrorMessage: errorMessage },
        }),
        COMPLETION_CALL_TIMEOUT_MS,
        "completion",
      ),
    );
  }

  /**
   * Retries a completion call. A lost completion leaves the durable function
   * waiting until its callback timeout, so a transient failure is worth up to
   * 5 attempts. A permanent error, such as a terminal callback error or
   * `AccessDeniedException`, is returned at once.
   *
   * One exception: `InvalidParameterValueException` ("already complete")
   * after an attempt that ended without an answer, or after an SDK-internal
   * retry, most likely means that an earlier try delivered the outcome. The
   * call then warns and resolves.
   */
  private async withRetry(call: () => Promise<unknown>): Promise<void> {
    // Set when an attempt failed without showing whether the service applied
    // it. A later "already complete" answer then most likely means that the
    // earlier attempt delivered the outcome.
    let uncertain = false;
    for (let attempt = 1; ; attempt++) {
      try {
        await call();
        return;
      } catch (error) {
        // The SDK retries a dropped connection inside one attempt, and
        // counts its tries in $metadata.attempts. So an answer after an SDK
        // retry is uncertain in the same way.
        if (
          (uncertain || (sdkAttemptsOf(error) ?? 1) > 1) &&
          safeGet(() => (error as Error).name) ===
            "InvalidParameterValueException"
        ) {
          this.warn(
            "the callback is already complete. An earlier attempt whose answer never arrived probably reported the outcome.",
            { callbackId: this.callbackId, attempt },
          );
          return;
        }
        if (isPermanentError(error) || attempt >= COMPLETION_ATTEMPTS) {
          throw error;
        }
        uncertain ||= isUncertainOutcome(error);
        await this.sleep(
          Math.min(1000 * 2 ** (attempt - 1), MAX_COMPLETION_DELAY_MS),
        );
      }
    }
  }
}
