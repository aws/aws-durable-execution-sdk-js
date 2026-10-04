/**
 * One job: the part of the contract that both delivery methods share.
 *
 * @remarks
 * The contract types in this file match the ones in
 * `@aws/durable-execution-sdk-js-extras`. The two packages do not depend on
 * each other, because one runs in the function and the other in the MicroVM.
 * So a change to one declaration must be made in the other too.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmJobDocument<TInput = unknown> {
  /** The callback ID that the worker completes with the job's outcome. */
  callbackId: string;
  /** The heartbeat timeout in seconds, when the caller set one. */
  heartbeatTimeoutSeconds?: number;
  /** The caller's input. */
  input: TInput;
}

/**
 * The JSON document in `runHookPayload`.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmRunHookPayload<TInput = unknown> {
  /** The payload format version. */
  version: 1;
  /** The Region of the durable function, for the callback API calls. */
  region: string;
  /** The job, when it is delivered through the `run` hook. */
  job?: MicrovmJobDocument<TInput>;
  /**
   * Suspend the MicroVM after it has run no job for this many seconds. Only
   * a session sets it. Without it, the worker never suspends the MicroVM.
   */
  autoSuspendIdleSeconds?: number;
}

/**
 * The body of the HTTP request that delivers a job to a route.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmJobRequest<TInput = unknown>
  extends MicrovmJobDocument<TInput> {
  /** The payload format version. */
  version: 1;
  /** The Region of the durable function, for the callback API calls. */
  region: string;
  /**
   * The MicroVM identifier. A job request can reach the worker before the
   * `run` hook, which also carries the identifier. Until the `run` hook
   * arrives, the worker takes it from the first job request that has one.
   */
  microvmId?: string;
}

/**
 * The body that Lambda sends to the `run` lifecycle hook.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface RunHookRequest {
  /** The MicroVM identifier. It must be a non-empty string. */
  microvmId: string;
  /** The `runHookPayload` string passed to RunMicrovm. */
  runHookPayload?: string;
}

/**
 * The payload versions this package can process.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const SUPPORTED_PAYLOAD_VERSION = 1;

/**
 * A MicroVM lives at most 8 hours. A longer idle time could never end, and a
 * timer delay above about 24.8 days would overflow to 1 millisecond.
 */
const MAX_MICROVM_LIFETIME_SECONDS = 8 * 60 * 60;

const MISSING_ID_MESSAGE =
  "run hook body must be an object with a non-empty string microvmId";

/**
 * Thrown when a `run` hook body or a job request does not match the
 * contract.
 *
 * `callbackId` and `region` are set when the document had them. The worker
 * then reports the error to that callback, so the durable function fails at
 * once instead of waiting for the callback timeout.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class InvalidRunHookPayloadError extends Error {
  override readonly name = "InvalidRunHookPayloadError";

  constructor(
    message: string,
    readonly callbackId?: string,
    readonly region?: string,
  ) {
    super(message);
  }
}

/**
 * Parses and validates a `run` lifecycle hook body.
 *
 * @param body - The parsed JSON body of the `run` hook request.
 * @returns The MicroVM ID and the decoded payload. `payload` is undefined when
 * the body has no `runHookPayload`, which happens when the MicroVM was not
 * started by a durable operation.
 * @throws \{InvalidRunHookPayloadError\} When the body or the payload does not
 * match the contract, or the payload version is not supported. The payload
 * is checked before the MicroVM ID. So an error for a missing ID carries the
 * job's callback ID and Region, when the payload delivered a valid job.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function parseRunHookRequest<TInput = unknown>(
  body: unknown,
): { microvmId: string; payload?: MicrovmRunHookPayload<TInput> } {
  if (!isRecord(body)) {
    throw new InvalidRunHookPayloadError(MISSING_ID_MESSAGE);
  }
  const microvmId = nonEmptyString(body.microvmId);
  if (body.runHookPayload === undefined || body.runHookPayload === "") {
    if (microvmId === undefined) {
      throw new InvalidRunHookPayloadError(MISSING_ID_MESSAGE);
    }
    return { microvmId };
  }
  if (typeof body.runHookPayload !== "string") {
    throw new InvalidRunHookPayloadError("runHookPayload must be a string");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.runHookPayload);
  } catch {
    throw new InvalidRunHookPayloadError("runHookPayload is not valid JSON");
  }
  if (!isRecord(payload)) {
    throw new InvalidRunHookPayloadError("runHookPayload must be an object");
  }

  const region = nonEmptyString(payload.region);
  const job = payload.job;
  const jobCallbackId =
    isRecord(job) && typeof job.callbackId === "string"
      ? job.callbackId
      : undefined;
  checkVersion(payload.version, jobCallbackId, region);
  if (region === undefined) {
    throw new InvalidRunHookPayloadError(
      "runHookPayload must have a non-empty region",
      jobCallbackId,
    );
  }
  if (job !== undefined) {
    validateJob(job, region, "runHookPayload job");
  }
  if (
    payload.autoSuspendIdleSeconds !== undefined &&
    !(
      typeof payload.autoSuspendIdleSeconds === "number" &&
      Number.isFinite(payload.autoSuspendIdleSeconds) &&
      payload.autoSuspendIdleSeconds > 0 &&
      payload.autoSuspendIdleSeconds <= MAX_MICROVM_LIFETIME_SECONDS
    )
  ) {
    throw new InvalidRunHookPayloadError(
      `runHookPayload autoSuspendIdleSeconds must be a positive number of at most ${MAX_MICROVM_LIFETIME_SECONDS}`,
      jobCallbackId,
      region,
    );
  }

  if (microvmId === undefined) {
    // Checked after the payload, so the job's callback fails at once.
    throw new InvalidRunHookPayloadError(
      MISSING_ID_MESSAGE,
      jobCallbackId,
      region,
    );
  }
  return {
    microvmId,
    payload: payload as unknown as MicrovmRunHookPayload<TInput>,
  };
}

/**
 * Parses and validates the body of a job request to a route.
 *
 * @param body - The parsed JSON body of the request.
 * @throws \{InvalidRunHookPayloadError\} When the body does not match the
 * contract, or its version is not supported.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function parseJobRequest<TInput = unknown>(
  body: unknown,
): MicrovmJobRequest<TInput> {
  if (!isRecord(body)) {
    throw new InvalidRunHookPayloadError("job request body must be an object");
  }
  const callbackId = nonEmptyString(body.callbackId);
  const region = nonEmptyString(body.region);
  checkVersion(body.version, callbackId, region);
  if (region === undefined) {
    throw new InvalidRunHookPayloadError(
      "job request must have a non-empty region",
      callbackId,
    );
  }
  validateJob(body, region, "job request");
  if (
    body.microvmId !== undefined &&
    nonEmptyString(body.microvmId) === undefined
  ) {
    throw new InvalidRunHookPayloadError(
      "job request microvmId must be a non-empty string",
      callbackId,
      region,
    );
  }
  return body as unknown as MicrovmJobRequest<TInput>;
}

function checkVersion(
  version: unknown,
  callbackId: string | undefined,
  region: string | undefined,
): void {
  if (version !== SUPPORTED_PAYLOAD_VERSION) {
    throw new InvalidRunHookPayloadError(
      `payload version ${String(version)} is not supported. This worker supports version ${SUPPORTED_PAYLOAD_VERSION}.`,
      callbackId,
      region,
    );
  }
}

function validateJob(job: unknown, region: string, label: string): void {
  if (!isRecord(job) || nonEmptyString(job.callbackId) === undefined) {
    throw new InvalidRunHookPayloadError(
      `${label} must be an object with a non-empty callbackId`,
    );
  }
  const callbackId = job.callbackId as string;
  if (
    job.heartbeatTimeoutSeconds !== undefined &&
    !(
      typeof job.heartbeatTimeoutSeconds === "number" &&
      job.heartbeatTimeoutSeconds >= 1
    )
  ) {
    // A shorter heartbeat timeout would need heartbeats many times a second.
    throw new InvalidRunHookPayloadError(
      `${label} heartbeatTimeoutSeconds must be a number of at least 1`,
      callbackId,
      region,
    );
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
