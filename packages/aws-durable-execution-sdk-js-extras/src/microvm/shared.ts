// Building blocks that microvm() and microvmSession() share: validation, the
// launch step, HTTP job delivery, and the terminate step.
import { createHash } from "node:crypto";
import {
  type DurableContext,
  type Duration,
  defaultSerdes,
  type RetryDecision,
} from "@aws/durable-execution-sdk-js";
import {
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  type RunMicrovmCommandInput,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  DEFAULT_MICROVM_JOB_PATH,
  DEFAULT_MICROVM_PORT,
  DEFAULT_REQUEST_RETRY_WINDOW_MS,
  assertTimeToDeliver,
  sendJob,
} from "./request";
import { addRequestId, withOriginalMessage, withRequestId } from "./aws-errors";
import { ensureRunning } from "./lifecycle";
import { defaultMicrovmRetryStrategy } from "./retry";
import { MicrovmOperationSubType } from "./subtypes";
import type {
  MicrovmBaseConfig,
  MicrovmJobDocument,
  MicrovmJobRequest,
  MicrovmRequestConfig,
} from "./types";

/**
 * RunMicrovm accepts `maximumDurationInSeconds` up to 8 hours.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_MICROVM_DURATION_SECONDS = 28_800;

/**
 * RunMicrovm accepts a `runHookPayload` of at most 4096 Unicode code points.
 *
 * The service counts code points, not UTF-8 bytes or UTF-16 code units. A
 * probe against the service accepted 1,916 code points in 5,658 bytes, and
 * 4,096 code points of "😀" in 8,149 code units. It rejected 4,097 code
 * points. A code point is at most 4 bytes, so the payload is at most the
 * 16,384 bytes that the API model states.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_RUN_HOOK_PAYLOAD_LENGTH = 4_096;

/**
 * Returns true when `payload` has at most
 * {@link MAX_RUN_HOOK_PAYLOAD_LENGTH} Unicode code points. A payload that
 * fits goes in the `run` hook. A payload that does not fit goes over HTTP.
 *
 * Why code points:
 *
 * 1. RunMicrovm counts the limit in code points. The probe results are on
 *    {@link MAX_RUN_HOOK_PAYLOAD_LENGTH}.
 * 2. `string.length` counts UTF-16 code units. An emoji is 1 code point and
 *    2 code units. So `string.length` sends a job with emoji over HTTP
 *    before the service limit requires it.
 * 3. A UTF-8 byte count is larger still. "日" is 1 code point and 3 bytes.
 *    So a byte count sends most non-ASCII jobs over HTTP without need.
 * 4. Each extra HTTP delivery gives the MicroVM an ingress connector and
 *    adds a request step. So the check counts exactly what the service
 *    counts.
 *
 * How it counts:
 *
 * 1. A code point is one or two UTF-16 code units.
 * 2. So a string of at most the limit in code units has at most the limit
 *    in code points. It always fits.
 * 3. A string of more than twice the limit in code units has more than the
 *    limit in code points. It never fits.
 * 4. Only a string between those two lengths needs a count. The count stops
 *    at the first code point past the limit.
 *
 * `JSON.stringify` escapes a lone surrogate as `\uXXXX`. So the payload has
 * only well-formed code points, and the count matches the service's count.
 */
export function fitsRunHook(payload: string): boolean {
  // Case 2 above: always fits.
  if (payload.length <= MAX_RUN_HOOK_PAYLOAD_LENGTH) {
    return true;
  }
  // Case 3 above: never fits.
  if (payload.length > 2 * MAX_RUN_HOOK_PAYLOAD_LENGTH) {
    return false;
  }
  // Case 4 above. A string iterator yields one code point per step.
  let codePoints = 0;
  for (const _ of payload) {
    if (++codePoints > MAX_RUN_HOOK_PAYLOAD_LENGTH) {
      return false;
    }
  }
  return true;
}

/**
 * The largest job input that {@link microvm} and {@link MicrovmSession.invoke}
 * accept, in UTF-8 bytes of its JSON form: 6 MiB minus 8 KiB.
 *
 * 1. The worker refuses a job request body over 6 MiB.
 * 2. The body holds the input's JSON and fixed fields: the version, the
 *    Region, the MicroVM ID, the callback ID, and the heartbeat timeout.
 * 3. The callback ID has at most 1,024 base64 characters. The MicroVM ID has
 *    at most 256 characters, so at most 1,536 bytes as JSON. The other
 *    fields take less than 200 bytes.
 * 4. So the fixed fields take less than 3 KiB. So 8 KiB covers them.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_JOB_INPUT_BYTES = 6 * 1024 * 1024 - 8 * 1024;

/** The text before the input's JSON in `JSON.stringify({ input })`. */
const INPUT_MEMBER_PREFIX = '{"input":';

/**
 * Returns the text that names a value thrown during the input's encoding.
 *
 * 1. A `toJSON` method or a getter of the input can throw any value, such as
 *    `null` or a string.
 * 2. Reading `message` of `null` throws a new `TypeError`. That error would
 *    replace the wrapper that names the operation.
 * 3. So an `Error` gives its message, and any other value gives `String()`
 *    of it. A value whose conversion throws gives a fixed text.
 */
function thrownDetail(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "a thrown value that cannot be converted to a string";
  }
}

/**
 * Encodes a job input to JSON once, and rejects it when the JSON has more
 * than {@link MAX_JOB_INPUT_BYTES} UTF-8 bytes.
 *
 * @returns The input's JSON text as measured. It is `undefined` when the
 * input encodes to no value, such as `undefined` or a function. Then the
 * bodies have no `input` field.
 *
 * Without this check, an oversized job launches a MicroVM first. The worker
 * then refuses the body, with a 400 or a connection reset. The request step
 * retries a reset in both retry tiers, for minutes, while the MicroVM is
 * billed. So the caller checks the size before any durable operation starts.
 *
 * The check encodes the input with `JSON.stringify`, as the job body does.
 * So a value that `JSON.stringify` cannot encode, such as a `BigInt`, also
 * fails here. The error of `JSON.stringify` does not name the operation. So
 * the check throws a `TypeError` that names the operation, with the error of
 * `JSON.stringify` as its `cause`.
 *
 * The check encodes the input as the value of a property named `input`:
 *
 * 1. `JSON.stringify` passes a `toJSON` method the key of the value. The key
 *    of a root value is `""`.
 * 2. Every body that carries the input holds it under the key `input`. The
 *    HTTP job request does, and so does the `job` of the run hook payload.
 * 3. So a `toJSON` that depends on its key can return a short form at the
 *    root and a long form under `input`.
 * 4. So the check encodes `{ input }`, and the measured form is the form
 *    that the bodies send.
 *
 * The caller sends the returned text, and never encodes the input again:
 *
 * 1. `JSON.stringify` calls `toJSON` on every encode.
 * 2. A `toJSON` can return a different value on each call.
 * 3. So a second encode can produce a larger text than the measured one.
 *    That text could exceed the 6 MiB body limit after the check passed.
 * 4. A JSON parse and a second encode of the measured text are also
 *    inexact. A `Proxy` can list an object's keys in any order. A parsed
 *    object lists integer keys first. So the second text can order the
 *    members differently.
 * 5. So the caller inserts the returned text into each body with
 *    {@link withJsonMember}. Each body then holds the measured bytes.
 *
 * @throws \{TypeError\} When `JSON.stringify` cannot encode the input.
 * @throws \{RangeError\} When the input is too large.
 */
export function validateJobInput(
  name: string,
  input: unknown,
): string | undefined {
  let json: string;
  try {
    json = JSON.stringify({ input });
  } catch (error) {
    throw new TypeError(
      `MicroVM "${name}": the job input must be JSON-serializable: ${thrownDetail(error)}`,
      { cause: error },
    );
  }
  // 1. JSON.stringify omits a property whose value encodes to undefined.
  //    Then the result is `{}`, and the bodies have no `input` field.
  // 2. Any other result is `{"input":`, then the input's JSON, then `}`.
  if (json === "{}") {
    return undefined;
  }
  const inputJson = json.slice(INPUT_MEMBER_PREFIX.length, -1);
  const bytes = Buffer.byteLength(inputJson, "utf8");
  if (bytes > MAX_JOB_INPUT_BYTES) {
    throw new RangeError(
      `MicroVM "${name}": the job input is ${bytes} bytes as JSON. The limit is ${MAX_JOB_INPUT_BYTES} bytes, because the worker accepts a job body of at most 6 MiB. Pass larger data by reference, for example as an S3 key.`,
    );
  }
  return inputJson;
}

/**
 * Returns the JSON text of `fields` with one more member at the end: `key`,
 * whose value is the JSON text `valueJson`. With `valueJson` `undefined`,
 * it returns the JSON text of `fields` alone.
 *
 * The function inserts `valueJson` as it is, and does not encode it again.
 * So the result holds the exact text that {@link validateJobInput} measured.
 * `fields` must be a plain object without `toJSON`, so that its JSON text
 * is an object.
 */
export function withJsonMember(
  fields: object,
  key: string,
  valueJson: string | undefined,
): string {
  const json = JSON.stringify(fields);
  if (valueJson === undefined) {
    return json;
  }
  const member = `${JSON.stringify(key)}:${valueJson}`;
  // `{}` has no member to follow, so the new member needs no comma.
  return json === "{}" ? `{${member}}` : `${json.slice(0, -1)},${member}}`;
}

/**
 * The time added to the operation timeout to get the MicroVM's maximum
 * duration. The margin covers the launch. The MicroVM must outlive every job
 * callback, or the platform terminates it before the job can report.
 */
const LAUNCH_MARGIN_SECONDS = 300;

const defaultClients = new Map<string, LambdaMicrovmsClient>();

/**
 * How the job reaches the MicroVM.
 *
 * - `run-hook`: the job is in the RunMicrovm request's `runHookPayload`.
 * - `http`: the RunMicrovm request has no job. A request step POSTs it to
 *   the MicroVM's endpoint after the launch.
 */
export type JobDelivery = "run-hook" | "http";

/** The checkpointed result of the launch step. */
export interface LaunchResult {
  microvmId: string;
  /** Present only for `http` delivery. */
  endpoint?: string;
  /**
   * The delivery that the launch used. Replay reads it from the checkpoint.
   * So every replay delivers the job the way the launch prepared for.
   */
  delivery: JobDelivery;
  /**
   * Whether each session job checks the MicroVM state, and resumes a
   * suspended MicroVM, before delivery. Replay reads it from the checkpoint.
   * So every replay follows the mode that the launch prepared the MicroVM
   * for. A session launch always records it. A `microvm()` launch does not
   * record it, because a single job never resumes its MicroVM. So the field
   * is optional.
   */
  resumeBeforeDelivery?: boolean;
}

export type RetryStrategy = (
  error: Error,
  attemptCount: number,
) => RetryDecision;

/** Values that every step of one operation uses. */
export interface OperationScope {
  name: string;
  config: MicrovmBaseConfig;
  partition: string;
  region: string;
  retryStrategy: RetryStrategy;
}

/**
 * Resolves the values that every step of one operation uses.
 *
 * @throws \{TypeError\} When the Region cannot be determined. The MicroVM
 * worker rejects a payload without a Region, and the connector ARNs need it.
 * So the operation fails before any durable operation instead.
 */
export function createScope(
  context: DurableContext,
  name: string,
  config: MicrovmBaseConfig,
): OperationScope {
  const { partition, region } = parseExecutionArn(
    context.executionContext.durableExecutionArn,
  );
  if (!region) {
    throw new TypeError(
      `MicroVM "${name}": cannot determine the AWS Region. The durable execution ARN has none, and AWS_REGION is not set.`,
    );
  }
  return {
    name,
    config,
    partition,
    region,
    retryStrategy: decideOnOriginalMessage(
      config.retryStrategy ?? defaultMicrovmRetryStrategy,
    ),
  };
}

/**
 * Returns a retry strategy that calls `strategy` with the original message of
 * an AWS SDK error.
 *
 * @remarks
 * Each step adds the request ID to the message of an AWS SDK error. See
 * {@link addRequestId}. A strategy that matches the message, such as
 * `createRetryStrategy({ retryableErrors: [...] })`, would then match the
 * longer message. So it could decide differently. The returned strategy
 * calls `strategy` through {@link withOriginalMessage}. So `strategy` decides
 * on the message that the AWS SDK error had. The core SDK checkpoints the
 * message after the strategy returns. So the handler and the execution
 * history still get the message with the request ID.
 *
 * Every step of the operation gets its strategy from {@link createScope}. So
 * the launch, request, and terminate steps all use the returned strategy.
 *
 * {@link defaultMicrovmRetryStrategy} reads only `name`, `code`, and
 * `$retryable`. So the wrapper does not change its decisions. It wraps the
 * default strategy too, so that every step has one code path.
 *
 * The returned strategy passes on `this`, the arguments, the return value,
 * and any exception of `strategy`.
 */
function decideOnOriginalMessage(strategy: RetryStrategy): RetryStrategy {
  return function (this: unknown, error, attemptCount) {
    return withOriginalMessage(error, () =>
      strategy.call(this, error, attemptCount),
    );
  };
}

/**
 * Validates the fields that both operations share.
 *
 * RunMicrovm accepts a launch without `executionRoleArn`. The MicroVM then
 * has no role. The MicroVM reports the job result through the durable
 * callback APIs, and those calls need the role. So a MicroVM without a role
 * cannot complete the job. So this function throws a `TypeError` when
 * `executionRoleArn` is not a string.
 *
 * The RunMicrovm model requires `imageIdentifier`. So RunMicrovm rejects a
 * launch without it, and this function does not check it.
 *
 * RunMicrovm rejects an empty `imageIdentifier` or `executionRoleArn` with
 * `ValidationException`. So this function does not check for an empty
 * string. The default retry strategy does not retry the exception. So the
 * operation fails with `MicrovmLaunchError` after one launch attempt.
 *
 * @returns The timeout in seconds.
 */
export function validateBaseConfig(
  name: string,
  config: MicrovmBaseConfig & { timeout: Duration },
): number {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("a MicroVM operation requires a non-empty name");
  }
  if (typeof config?.executionRoleArn !== "string") {
    throw new TypeError(`MicroVM "${name}": executionRoleArn is required`);
  }
  return validateTimeout(name, "timeout", config.timeout);
}

/**
 * A MicroVM lives at most 8 hours. So no timeout that the MicroVM must
 * outlive can be longer.
 */
export function validateTimeout(
  name: string,
  field: string,
  timeout: Duration | undefined,
): number {
  const seconds = durationToSeconds(timeout);
  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > MAX_MICROVM_DURATION_SECONDS
  ) {
    throw new RangeError(
      `MicroVM "${name}": ${field} must be between 1 second and ${MAX_MICROVM_DURATION_SECONDS} seconds (8 hours), because a MicroVM lives at most 8 hours. Got ${seconds} seconds.`,
    );
  }
  return seconds;
}

export function validateRequest(
  name: string,
  request: MicrovmRequestConfig,
): void {
  const { path, port, retryWindow } = request ?? {};
  // No path selects the worker's default job route. The operation sends the
  // path as written, and the worker matches the raw request path. So the
  // path must be valid as written: the config and the route then use the
  // same string.
  if (
    path !== undefined &&
    (typeof path !== "string" || !ROUTE_PATH.test(path))
  ) {
    throw new TypeError(
      `MicroVM "${name}": the request path must be an RFC 3986 path that starts with "/". Percent-encode any other character, for example a space as %20.`,
    );
  }
  // fetch resolves a dot segment before it sends the request. So a path
  // with one would reach a route other than the one written, and it could
  // pass the prefix check below and still reach a lifecycle hook path.
  if (path !== undefined && DOT_SEGMENT.test(path)) {
    throw new TypeError(
      `MicroVM "${name}": the request path must not have a "." or ".." segment, because fetch resolves it before sending the request.`,
    );
  }
  if (path?.startsWith("/aws/lambda-microvms/")) {
    throw new TypeError(
      `MicroVM "${name}": the request path must not use the lifecycle hook prefix /aws/lambda-microvms/`,
    );
  }
  if (
    port !== undefined &&
    !(Number.isInteger(port) && port >= 1 && port <= 65_535)
  ) {
    throw new TypeError(
      `MicroVM "${name}": the request port must be an integer between 1 and 65535`,
    );
  }
  if (retryWindow !== undefined) {
    // A NaN window would make the retry tier's deadline NaN, so the tier
    // would never end. A window over 10 minutes outlives the auth token and
    // its one refresh.
    const seconds = durationToSeconds(retryWindow);
    if (
      !Number.isFinite(seconds) ||
      seconds < 1 ||
      seconds > MAX_REQUEST_RETRY_WINDOW_SECONDS
    ) {
      throw new RangeError(
        `MicroVM "${name}": the request retryWindow must be between 1 second and ${MAX_REQUEST_RETRY_WINDOW_SECONDS / 60} minutes`,
      );
    }
  }
}

/** The longest request retry window. */
const MAX_REQUEST_RETRY_WINDOW_SECONDS = 10 * 60;

/**
 * An RFC 3986 path, section 3.3: segments of pchar characters and `%XX`
 * escapes. The WHATWG URL parser in `fetch` leaves such a path unchanged,
 * unless it has a {@link DOT_SEGMENT}.
 */
const ROUTE_PATH =
  /^(?:\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})*)+$/;

/**
 * A `.` or `..` segment, also with `%2e` for a dot. The WHATWG URL parser in
 * `fetch` resolves such a segment, so a path with one does not reach the
 * worker as written. A segment with other characters next to its dots, such
 * as `/.well-known`, and a segment of three dots stay unchanged.
 */
const DOT_SEGMENT = /\/(?:\.|%2e){1,2}(?=\/|$)/i;

/**
 * Runs the launch step.
 *
 * The client token must be unique per launch and stable across retries. The
 * caller derives it from a checkpointed value, so a retried or replayed launch
 * returns the same MicroVM.
 */
export function launch(
  child: DurableContext,
  scope: OperationScope,
  options: {
    tokenSource: string;
    timeoutSeconds: number;
    defaultIngress: "NO_INGRESS" | "ALL_INGRESS";
    runHookPayload: string;
    delivery: JobDelivery;
    /** The resume mode to record. Only a session launch sets it. */
    resumeBeforeDelivery?: boolean;
    extra?: Partial<RunMicrovmCommandInput>;
  },
): Promise<LaunchResult> {
  const { config, partition, region } = scope;
  return child.step<LaunchResult>(
    `${scope.name}.launch`,
    async () => {
      // The core SDK checkpoints only the message of a step failure. So a
      // RunMicrovm error of the Lambda MicroVMs service gets the request ID
      // in its message, and keeps its class and retry fields. See
      // `addRequestId`.
      const response = await getClient(config, region)
        .send(
          new RunMicrovmCommand({
            imageIdentifier: config.imageIdentifier,
            imageVersion: config.imageVersion,
            executionRoleArn: config.executionRoleArn,
            // A callback ID can be 1024 characters, and the client token
            // allows 128. The digest is 64 characters.
            clientToken: sha256Hex(options.tokenSource),
            ingressNetworkConnectors: config.ingressNetworkConnectors ?? [
              connectorArn(partition, region, options.defaultIngress),
            ],
            egressNetworkConnectors: config.egressNetworkConnectors ?? [
              connectorArn(partition, region, "INTERNET_EGRESS"),
            ],
            maximumDurationInSeconds: Math.min(
              options.timeoutSeconds + LAUNCH_MARGIN_SECONDS,
              MAX_MICROVM_DURATION_SECONDS,
            ),
            logging: config.logging,
            runHookPayload: options.runHookPayload,
            ...options.extra,
          }),
        )
        .catch((error: unknown) => {
          throw addRequestId("RunMicrovm", error);
        });
      if (!response.microvmId) {
        throw new Error(
          withRequestId(
            "RunMicrovm returned no microvmId",
            "RunMicrovm",
            response,
          ),
        );
      }
      const overHttp = options.delivery === "http";
      if (overHttp && !response.endpoint) {
        throw new Error(
          withRequestId(
            "RunMicrovm returned no endpoint",
            "RunMicrovm",
            response,
          ),
        );
      }
      return {
        microvmId: response.microvmId,
        ...(overHttp && { endpoint: response.endpoint }),
        delivery: options.delivery,
        ...(options.resumeBeforeDelivery !== undefined && {
          resumeBeforeDelivery: options.resumeBeforeDelivery,
        }),
      };
    },
    {
      retryStrategy: scope.retryStrategy,
      subType: MicrovmOperationSubType.LAUNCH,
    },
  ) as Promise<LaunchResult>;
}

/**
 * Creates a job callback. The MicroVM sends a JSON string, and the default
 * callback deserializer returns the raw string. So the callback parses it.
 */
export function createJobCallback<TOutput>(
  child: DurableContext,
  jobName: string,
  timeout: Duration,
  heartbeatTimeout: Duration | undefined,
): Promise<[Promise<TOutput>, string]> {
  return child.createCallback<TOutput>(`${jobName}.callback`, {
    timeout,
    heartbeatTimeout,
    serdes: defaultSerdes,
    subType: MicrovmOperationSubType.CALLBACK,
  }) as unknown as Promise<[Promise<TOutput>, string]>;
}

/**
 * One job before delivery: the job document's fields other than `input`,
 * and the input's JSON text from {@link validateJobInput}. Each body
 * inserts that text with {@link withJsonMember}. So no body encodes the
 * input again.
 */
export interface MeasuredJob {
  fields: Omit<MicrovmJobDocument, "input">;
  /** `undefined` when the input encodes to no value. */
  inputJson: string | undefined;
}

export function measuredJob(
  callbackId: string,
  inputJson: string | undefined,
  heartbeatTimeout: Duration | undefined,
): MeasuredJob {
  return {
    fields: {
      callbackId,
      ...(heartbeatTimeout !== undefined && {
        heartbeatTimeoutSeconds: durationToSeconds(heartbeatTimeout),
      }),
    },
    inputJson,
  };
}

/** Returns the JSON text of the job document, with the measured input. */
export function jobDocumentJson(job: MeasuredJob): string {
  return withJsonMember(job.fields, "input", job.inputJson);
}

/**
 * Runs the request step: delivers one job over HTTP with the first retry
 * tier inside the step, and the step retry strategy as the second tier.
 */
export async function deliverJob(
  child: DurableContext,
  scope: OperationScope,
  jobName: string,
  launched: LaunchResult,
  request: MicrovmRequestConfig,
  job: MeasuredJob,
  options: { resume?: boolean } = {},
): Promise<void> {
  // The body ends with the input's measured JSON text. So it has the size
  // that validateJobInput checked.
  const body = withJsonMember(
    {
      version: 1,
      region: scope.region,
      microvmId: launched.microvmId,
      ...job.fields,
    } satisfies Omit<MicrovmJobRequest, "input">,
    "input",
    job.inputJson,
  );
  await child.step(
    `${jobName}.request`,
    async (stepContext) => {
      // A session job calls GetMicrovm before sendJob, and that call has the
      // same limit as the request. So the step checks the time before
      // either call, and both kinds of job get the message that names the
      // function timeout.
      assertTimeToDeliver(remainingTime(child));
      const client = getClient(scope.config, scope.region);
      const log = (message: string, data: Record<string, unknown>): void =>
        stepContext.logger.info(`MicroVM "${jobName}": ${message}`, data);
      const retryWindowMs =
        request.retryWindow === undefined
          ? DEFAULT_REQUEST_RETRY_WINDOW_MS
          : durationToSeconds(request.retryWindow) * 1_000;
      // A session MicroVM can be suspended between jobs. So a session job
      // first makes sure the MicroVM runs, and uses the endpoint that
      // GetMicrovm reports now.
      // A transition must fit in the first retry tier, like the request
      // that follows it. A recheck gets what remains of the tier.
      // The state check before delivery and the request's retries share
      // one window. So the wait for a resume counts toward it.
      const windowStartedAt = Date.now();
      const running = (
        maxWaitMs = retryWindowMs,
      ): Promise<string | undefined> =>
        ensureRunning({
          client,
          microvmId: launched.microvmId,
          maxWaitMs,
          remainingTimeMs: remainingTime(child),
          log,
        });
      const endpoint = options.resume
        ? ((await running()) ?? launched.endpoint)
        : launched.endpoint;
      // The launch records an endpoint for every `http` delivery, and the
      // caller delivers over HTTP only then. So a missing endpoint is a
      // defect, not a transient failure. The error name is not retryable,
      // so the step fails at once instead of sending to "https://undefined".
      if (endpoint === undefined) {
        throw new Error(
          `MicroVM "${jobName}": the launch recorded no endpoint for MicroVM ${launched.microvmId}, so the job cannot be sent over HTTP`,
        );
      }
      await sendJob({
        client,
        fetch: scope.config.fetch ?? fetch,
        microvmId: launched.microvmId,
        endpoint,
        path: request.path ?? DEFAULT_MICROVM_JOB_PATH,
        port: request.port ?? DEFAULT_MICROVM_PORT,
        body,
        retryWindowMs,
        windowStartedAt,
        remainingTimeMs: remainingTime(child),
        log,
        ...(options.resume && { recheck: running }),
      });
    },
    {
      retryStrategy: scope.retryStrategy,
      subType: MicrovmOperationSubType.REQUEST,
    },
  );
}

/**
 * Terminates the MicroVM and logs, instead of throwing, a final failure.
 *
 * When terminate runs, the job callbacks already hold their outcomes, and
 * `maximumDurationInSeconds` bounds how long the MicroVM can keep running. So
 * a terminate failure must not discard those outcomes.
 *
 * The step's failure is checkpointed. So on replay the step fails again at
 * once, this function catches it again, and the outcome stays the same.
 */
export async function terminate(
  child: DurableContext,
  scope: OperationScope,
  microvmId: string,
): Promise<void> {
  try {
    await child.step(
      `${scope.name}.terminate`,
      async () => {
        try {
          await getClient(scope.config, scope.region).send(
            new TerminateMicrovmCommand({ microvmIdentifier: microvmId }),
          );
        } catch (error) {
          // TerminateMicrovm succeeds for an already-terminated MicroVM. A
          // MicroVM whose record the service has already removed returns
          // ResourceNotFoundException. Either way, the MicroVM is gone.
          if ((error as Error).name !== "ResourceNotFoundException") {
            throw addRequestId("TerminateMicrovm", error);
          }
        }
      },
      {
        retryStrategy: scope.retryStrategy,
        subType: MicrovmOperationSubType.TERMINATE,
      },
    );
  } catch (error) {
    // The job's outcome is already recorded, so the operation still returns
    // it. But the MicroVM keeps running, and is billed, until the platform
    // ends it at maximumDurationInSeconds: the timeout plus 5 minutes, at
    // most 8 hours. A
    // missing permission fails every terminate this way, and the default
    // retry strategy does not retry AccessDeniedException. This log is the
    // only sign of it. So it is an error, not a warning.
    child.logger.error(
      `MicroVM "${scope.name}": terminate failed for ${microvmId}. The MicroVM keeps running, and is billed, until the platform ends it at maximumDurationInSeconds, the operation timeout plus 5 minutes, at most 8 hours. A missing permission needs lambda:TerminateMicrovm in the function's execution role.`,
      { error },
    );
  }
}

/**
 * Converts a Duration to whole seconds, rounding up.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function durationToSeconds(duration: Duration | undefined): number {
  if (duration === undefined) {
    return Number.NaN;
  }
  const parts = duration as {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  };
  return Math.ceil(
    (parts.days ?? 0) * 86_400 +
      (parts.hours ?? 0) * 3_600 +
      (parts.minutes ?? 0) * 60 +
      (parts.seconds ?? 0),
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Returns a function that reads the invocation's remaining time in
 * milliseconds. The first retry tier uses it to stop before the invocation
 * times out.
 *
 * AWS Lambda's context has `getRemainingTimeInMillis()`. A local or test
 * runner can pass no Lambda context, or one without that function. The
 * returned function then returns `undefined`, and the caller applies only its
 * own time limit.
 *
 * Otherwise the returned function passes on the value of
 * `getRemainingTimeInMillis()` unchanged. `reserveStartsAt` and
 * `assertTimeToDeliver` read it, and both treat a value that is not a finite
 * number as no deadline. A `getRemainingTimeInMillis()` that throws fails the
 * step that reads it. One that returns a value that is not a finite number
 * turns the reserve off.
 */
export function remainingTime(
  context: DurableContext,
): () => number | undefined {
  const lambdaContext = context.lambdaContext as
    | { getRemainingTimeInMillis?: unknown }
    | undefined;
  const read = lambdaContext?.getRemainingTimeInMillis;
  if (typeof read !== "function") {
    return (): undefined => undefined;
  }
  return () => read.call(lambdaContext) as number | undefined;
}

/**
 * Reads the partition and Region from a durable execution ARN, in the form
 * `arn:<partition>:lambda:<region>:<account>:...`. Falls back to `aws` and
 * `AWS_REGION` when the ARN does not have that form.
 */
function parseExecutionArn(arn: string): {
  partition: string;
  region: string;
} {
  const [prefix, partition, , region] = arn.split(":");
  if (prefix === "arn" && partition && region) {
    return { partition, region };
  }
  return { partition: "aws", region: process.env.AWS_REGION ?? "" };
}

function connectorArn(
  partition: string,
  region: string,
  connector: string,
): string {
  return `arn:${partition}:lambda:${region}:aws:network-connector:aws-network-connector:${connector}`;
}

export function getClient(
  config: MicrovmBaseConfig,
  region: string,
): LambdaMicrovmsClient {
  if (config.client) {
    return config.client;
  }
  let client = defaultClients.get(region);
  if (!client) {
    client = new LambdaMicrovmsClient({ region });
    defaultClients.set(region, client);
  }
  return client;
}
