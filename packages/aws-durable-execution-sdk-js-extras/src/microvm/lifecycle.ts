// Resumes a suspended session MicroVM before the next job.
import {
  GetMicrovmCommand,
  type LambdaMicrovmsClient,
  ResumeMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import { MICROVM_STATE_ERROR_NAME } from "./errors";
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

/**
 * Thrown inside the request step when the MicroVM is terminating,
 * terminated, or removed. A later attempt finds the same state. So the name
 * is not in the retryable set, and the step fails at once. The delivery stage
 * then reports `MicrovmNotRunningError`.
 */
export class MicrovmStateError extends Error {
  override readonly name = MICROVM_STATE_ERROR_NAME;

  constructor(
    message: string,
    /** The MicroVM state, or `undefined` when the MicroVM no longer exists. */
    readonly state?: string,
  ) {
    super(message);
  }
}

export interface EnsureRunningOptions {
  client: LambdaMicrovmsClient;
  microvmId: string;
  /** The longest time to wait for a transition, in milliseconds. */
  maxWaitMs: number;
  /**
   * The remaining invocation time. `undefined`, as a value or as a result,
   * means the compute reports no deadline, and only `maxWaitMs` applies.
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
 * for the session's idle time. An idle policy can also suspend it. So the
 * next job can find the MicroVM in any of these states:
 *
 * - `RUNNING`: the function returns at once.
 * - `PENDING`: the function returns at once. A new MicroVM reports `PENDING`
 *   until it boots. The request's own retries wait for the `run` hook, as
 *   they did before the session suspended MicroVMs.
 * - `SUSPENDED`: it calls ResumeMicrovm once, then waits for `RUNNING`. The
 *   MicroVM stays `SUSPENDED` while its `resume` hook runs. So the function
 *   does not call ResumeMicrovm again for each `SUSPENDED` answer.
 * - `SUSPENDING`: it waits. The MicroVM becomes `SUSPENDED`, and the function
 *   then resumes it.
 * - `TERMINATING`, `TERMINATED`, or not found: it throws
 *   {@link MicrovmStateError}.
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
  let resumeSent = false;
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

  for (;;) {
    let state: string | undefined;
    let endpoint: string | undefined;
    let stateReason: string | undefined;
    try {
      const current = await getMicrovm();
      state = current.state;
      lastState = state;
      endpoint = current.endpoint;
      stateReason = current.stateReason;
    } catch (error) {
      if ((error as Error).name === "ResourceNotFoundException") {
        throw new MicrovmStateError(
          `MicroVM ${options.microvmId} no longer exists. A session MicroVM lives at most its session timeout plus 5 minutes, and never longer than 8 hours.`,
        );
      }
      throw error;
    }

    if (state === "RUNNING" || (state === "PENDING" && !resumeSent)) {
      if (resumeSent) {
        options.log("MicroVM resumed", { waitedMs: Date.now() - started });
      }
      return endpoint;
    }
    if (state === "TERMINATING" || state === "TERMINATED") {
      throw new MicrovmStateError(
        `MicroVM ${options.microvmId} is ${state}${stateReason ? `: ${stateReason}` : ""}.`,
        state,
      );
    }
    if (state === "SUSPENDED" && !resumeSent) {
      try {
        await resumeMicrovm();
      } catch (error) {
        // ConflictException means a transition is already in progress, for
        // example an auto-resume. Polling continues either way.
        if ((error as Error).name !== "ConflictException") {
          throw error;
        }
      }
      resumeSent = true;
      options.log("resuming MicroVM", { state });
    }

    if (Date.now() + delay > deadline) {
      throw unavailable();
    }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_POLL_MS);
  }
}
