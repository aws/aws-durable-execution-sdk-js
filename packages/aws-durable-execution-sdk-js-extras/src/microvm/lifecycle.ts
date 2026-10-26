// Resumes a suspended session MicroVM before the next job.
import {
  GetMicrovmCommand,
  type GetMicrovmCommandOutput,
  type LambdaMicrovmsClient,
  ResumeMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  addRequestId,
  isMicrovmsServiceError,
  MicrovmStateError,
  microvmNotFound,
  withRequestId,
} from "./aws-errors";
import {
  callBeforeDeadline,
  MicrovmEndpointUnavailableError,
  reserveStartsAt,
} from "./request";

/**
 * The first poll comes soon, because a resume measured in us-east-1 took
 * about one second. Later polls back off, so a slow transition costs few
 * GetMicrovm calls.
 */
const INITIAL_POLL_MS = 250;
const MAX_POLL_MS = 2_000;

export interface EnsureRunningOptions {
  client: LambdaMicrovmsClient;
  microvmId: string;
  /** The longest time to wait for a transition, in milliseconds. */
  maxWaitMs: number;
  /**
   * The remaining invocation time. `undefined`, as a value or as a result,
   * means the compute reports no deadline, and only `maxWaitMs` applies.
   * A result that is not a finite number means the same.
   */
  remainingTimeMs?: () => number | undefined;
  log: (message: string, data: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Makes sure the MicroVM can take a job, and returns its current endpoint.
 *
 * @remarks
 * The worker in a session MicroVM suspends its own MicroVM when no job has run
 * for the session's idle time, and after a job with `suspendAfter`. An idle
 * policy can also suspend it. So the next job can find the MicroVM in any of
 * these states:
 *
 * - `RUNNING`: the function returns at once.
 * - `PENDING`: the function returns at once. A new MicroVM reports `PENDING`
 *   until it boots. The request's own retries wait for the `run` hook, as
 *   they did before the session suspended MicroVMs.
 * - `SUSPENDED`: it calls ResumeMicrovm, then waits for `RUNNING`. The
 *   MicroVM stays `SUSPENDED` while its `resume` hook runs. So after the
 *   service accepts a resume, the function does not call ResumeMicrovm again
 *   for each `SUSPENDED` answer. A resume rejected with `ConflictException`
 *   was not accepted. So the next `SUSPENDED` answer sends it again.
 * - `SUSPENDING`: it waits. The MicroVM becomes `SUSPENDED`, and the function
 *   then resumes it.
 * - `TERMINATING`, `TERMINATED`, or not found: it throws
 *   {@link MicrovmStateError}. GetMicrovm or ResumeMicrovm can report that
 *   the MicroVM is not found. The message ends with the request ID of the
 *   call that reported the state, in the form
 *   `GetMicrovm request ID: <id>.`.
 *
 * Any other GetMicrovm or ResumeMicrovm error, such as
 * `AccessDeniedException`, is rethrown as the same error object. When it is
 * an error of the Lambda MicroVMs service, its message then ends with the
 * request ID of the call. See {@link addRequestId}. A `ConflictException`
 * from ResumeMicrovm is not an error: polling continues, and the next
 * `SUSPENDED` answer sends ResumeMicrovm again. Each poll makes at most one
 * ResumeMicrovm call.
 *
 * It polls after 250 milliseconds, doubling the wait up to 2 seconds. It
 * stops after `maxWaitMs`, or 10 seconds before the invocation times out. It
 * then throws `MicrovmEndpointUnavailableError`, and the step retry strategy
 * takes over. Each GetMicrovm and ResumeMicrovm call also stops 10 seconds
 * before the invocation times out, with the same error.
 *
 * @returns The endpoint that GetMicrovm reports, or `undefined` when it
 * reports none.
 */
export async function ensureRunning(
  options: EnsureRunningOptions,
): Promise<string | undefined> {
  return waitUntilRunning(options, { attempted: false, accepted: false });
}

/**
 * Thrown by {@link resumeIfSuspended} when its GetMicrovm call fails.
 *
 * The request step of a session without the resume mode runs that check
 * only after a sign of a suspended MicroVM. The session may never have
 * asked to suspend. So the step logs one warning per job, and keeps sending
 * the job. `cause` is the error of the call.
 *
 * @internal
 */
export class MicrovmStateCheckError extends Error {
  override readonly name = "MicrovmStateCheckError";

  constructor(
    message: string,
    /** Whether the service answered `AccessDeniedException`. */
    readonly denied: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Thrown when ResumeMicrovm is denied for a suspending or suspended MicroVM.
 *
 * Nothing else resumes the MicroVM, and a later attempt is denied the same
 * way. So the default retry strategy does not retry it, and the job fails
 * with `MicrovmDeliveryError` at once. The message names the permission,
 * and ends with the request ID of the call.
 *
 * @internal
 */
export class MicrovmResumeDeniedError extends Error {
  override readonly name = "MicrovmResumeDeniedError";
}

/**
 * Checks the MicroVM state once, resumes a suspended MicroVM, and returns
 * its current endpoint.
 *
 * @remarks
 * The request step of a session without the resume mode calls it after a
 * sign that the MicroVM may be suspended: an HTTP 502 from the endpoint with
 * `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, or no answer. A worker can
 * suspend its MicroVM after a `suspendAfter` job. The session can lose the
 * record of that job on replay. So this check runs for every session job.
 *
 * 1. GetMicrovm runs once. A failure other than `ResourceNotFoundException`
 *    throws {@link MicrovmStateCheckError}. The caller then keeps sending
 *    the job.
 * 2. `RUNNING` or `PENDING`: the function returns at once.
 * 3. `SUSPENDING` or `SUSPENDED`: it calls ResumeMicrovm once. The service
 *    can honor a resume during `SUSPENDING`. It then waits for `RUNNING`,
 *    as {@link ensureRunning} does after its own resume.
 * 4. `TERMINATING`, `TERMINATED`, or not found: it throws
 *    {@link MicrovmStateError}.
 *
 * A denied ResumeMicrovm throws {@link MicrovmResumeDeniedError}. A
 * `ConflictException` is not an error: polling continues. ResumeMicrovm
 * requires `SUSPENDED`, so the service can reject a resume during
 * `SUSPENDING` with that error. The wait then sends ResumeMicrovm again at
 * the next `SUSPENDED` answer, as {@link ensureRunning} does. Any other
 * ResumeMicrovm error is rethrown as the same error object, as in
 * {@link ensureRunning}. So is any error of a GetMicrovm call after the
 * resume.
 *
 * @returns The endpoint that GetMicrovm reports, or `undefined` when it
 * reports none.
 */
export async function resumeIfSuspended(
  options: EnsureRunningOptions,
): Promise<string | undefined> {
  const started = Date.now();
  const reserve = reserveStartsAt(options.remainingTimeMs);
  const { microvmId } = options;
  const unavailable = (): MicrovmEndpointUnavailableError =>
    new MicrovmEndpointUnavailableError(
      `MicroVM ${microvmId} did not reach RUNNING in ${Date.now() - started} ms. Last state: unknown.`,
    );

  let current: GetMicrovmCommandOutput;
  try {
    current = await callBeforeDeadline(
      (sendOptions) =>
        options.client.send(
          new GetMicrovmCommand({ microvmIdentifier: microvmId }),
          sendOptions,
        ),
      reserve,
      unavailable,
    );
  } catch (error) {
    if (error instanceof MicrovmEndpointUnavailableError) {
      throw error;
    }
    const errorName = (error as Error).name;
    if (errorName === "ResourceNotFoundException") {
      throw microvmNotFound(microvmId, "GetMicrovm", error);
    }
    throw new MicrovmStateCheckError(
      (addRequestId("GetMicrovm", error) as Error).message,
      errorName === "AccessDeniedException",
      { cause: error },
    );
  }
  const state = current.state;
  throwIfEnded(microvmId, current);
  if (state !== "SUSPENDING" && state !== "SUSPENDED") {
    return current.endpoint;
  }
  // A resume during SUSPENDING saves a poll when the service accepts it. The
  // service can also reject it with ConflictException, because ResumeMicrovm
  // requires SUSPENDED. That resume did not take effect. So the wait sends
  // ResumeMicrovm again when it sees SUSPENDED.
  let accepted = true;
  try {
    await callBeforeDeadline(
      (sendOptions) =>
        options.client.send(
          new ResumeMicrovmCommand({ microvmIdentifier: microvmId }),
          sendOptions,
        ),
      reserve,
      unavailable,
    );
  } catch (error) {
    if (error instanceof MicrovmEndpointUnavailableError) {
      throw error;
    }
    const errorName = (error as Error).name;
    if (errorName === "ResourceNotFoundException") {
      throw microvmNotFound(microvmId, "ResumeMicrovm", error);
    }
    if (errorName === "AccessDeniedException") {
      throw new MicrovmResumeDeniedError(
        withRequestId(
          `MicroVM ${microvmId} is ${state}. ResumeMicrovm was denied, so the operation cannot resume it. The function's execution role needs lambda:ResumeMicrovm.`,
          "ResumeMicrovm",
          isMicrovmsServiceError(error) ? error : undefined,
        ),
        { cause: error },
      );
    }
    if (errorName !== "ConflictException") {
      throw addRequestId("ResumeMicrovm", error);
    }
    accepted = false;
  }
  options.log("resuming MicroVM", { state });
  return waitUntilRunning(
    { ...options, maxWaitMs: options.maxWaitMs - (Date.now() - started) },
    { attempted: true, accepted },
  );
}

/**
 * Throws {@link MicrovmStateError} for a terminating or terminated MicroVM.
 * The GetMicrovm output carries the request ID in `$metadata`. The state
 * fails the step, so the message names that request ID.
 */
function throwIfEnded(
  microvmId: string,
  current: { state?: string; stateReason?: string },
): void {
  const { state, stateReason } = current;
  if (state === "TERMINATING" || state === "TERMINATED") {
    throw new MicrovmStateError(
      withRequestId(
        `MicroVM ${microvmId} is ${state}${stateReason ? `: ${stateReason}` : ""}.`,
        "GetMicrovm",
        current,
      ),
      state,
    );
  }
}

/**
 * What the caller of {@link waitUntilRunning} has done.
 *
 * `attempted` states that a ResumeMicrovm call was made. `PENDING` then
 * means a resume in progress, not a new MicroVM. `accepted` states that the
 * service accepted a ResumeMicrovm call. A call rejected with
 * `ConflictException` is attempted but not accepted.
 */
interface ResumeProgress {
  attempted: boolean;
  accepted: boolean;
}

/**
 * The loop of {@link ensureRunning}.
 *
 * It calls ResumeMicrovm for each `SUSPENDED` answer until the service
 * accepts a call. A `ConflictException` does not count as accepted. So the
 * next `SUSPENDED` answer sends ResumeMicrovm again. Each poll makes at most
 * one ResumeMicrovm call, and the poll delay and the deadline apply. So a
 * repeated conflict ends with `MicrovmEndpointUnavailableError` at the
 * deadline.
 */
async function waitUntilRunning(
  options: EnsureRunningOptions,
  progress: ResumeProgress,
): Promise<string | undefined> {
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)));
  const started = Date.now();
  // A NaN deadline would make every comparison false, and Infinity means no
  // deadline. reserveStartsAt returns undefined for both. So only maxWaitMs
  // applies then.
  const reserve = reserveStartsAt(options.remainingTimeMs);
  const deadline =
    reserve === undefined
      ? started + options.maxWaitMs
      : Math.min(started + options.maxWaitMs, reserve);
  let { attempted, accepted } = progress;
  let delay = INITIAL_POLL_MS;
  let lastState: string | undefined;
  const unavailable = (): MicrovmEndpointUnavailableError =>
    new MicrovmEndpointUnavailableError(
      `MicroVM ${options.microvmId} did not reach RUNNING in ${Date.now() - started} ms. Last state: ${lastState ?? "unknown"}.`,
    );
  // Each GetMicrovm and ResumeMicrovm call must end before the invocation
  // reserve. A Lambda timeout during the step attempt would record no
  // outcome. So each call gets an abort signal at the reserve.
  const getMicrovm = () =>
    callBeforeDeadline(
      (sendOptions) =>
        options.client.send(
          new GetMicrovmCommand({ microvmIdentifier: options.microvmId }),
          sendOptions,
        ),
      reserve,
      unavailable,
    );
  const resumeMicrovm = () =>
    callBeforeDeadline(
      (sendOptions) =>
        options.client.send(
          new ResumeMicrovmCommand({ microvmIdentifier: options.microvmId }),
          sendOptions,
        ),
      reserve,
      unavailable,
    );

  // GetMicrovm and ResumeMicrovm both return ResourceNotFoundException for
  // a removed MicroVM. ResumeMicrovm returns it when the MicroVM is removed
  // after the state check. So `ensureRunning` throws the same
  // `MicrovmStateError` for both. Every other error of either call keeps its
  // class and its retry fields. An error of the Lambda MicroVMs service also
  // gets the request ID in its message. See `addRequestId`.
  for (;;) {
    let state: string | undefined;
    let endpoint: string | undefined;
    // The GetMicrovm output carries the request ID in `$metadata`. A
    // terminating or terminated MicroVM fails the step, so its message names
    // that request ID too.
    let current: Awaited<ReturnType<typeof getMicrovm>>;
    try {
      current = await getMicrovm();
      state = current.state;
      lastState = state;
      endpoint = current.endpoint;
    } catch (error) {
      if ((error as Error).name === "ResourceNotFoundException") {
        throw microvmNotFound(options.microvmId, "GetMicrovm", error);
      }
      throw addRequestId("GetMicrovm", error);
    }

    if (state === "RUNNING" || (state === "PENDING" && !attempted)) {
      if (attempted) {
        options.log("MicroVM resumed", { waitedMs: Date.now() - started });
      }
      return endpoint;
    }
    throwIfEnded(options.microvmId, current);
    if (state === "SUSPENDED" && !accepted) {
      attempted = true;
      try {
        await resumeMicrovm();
        accepted = true;
      } catch (error) {
        // ConflictException means that the service did not take this resume,
        // for example while a transition is in progress. The next SUSPENDED
        // answer sends ResumeMicrovm again. ResourceNotFoundException means
        // that the MicroVM was removed after the state check.
        const errorName = (error as Error).name;
        if (errorName === "ResourceNotFoundException") {
          throw microvmNotFound(options.microvmId, "ResumeMicrovm", error);
        }
        if (errorName !== "ConflictException") {
          throw addRequestId("ResumeMicrovm", error);
        }
      }
      options.log("resuming MicroVM", { state });
    }

    if (Date.now() + delay > deadline) {
      throw unavailable();
    }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_POLL_MS);
  }
}
