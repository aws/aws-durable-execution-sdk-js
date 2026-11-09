// Checks whether a MicroVM has ended, after a sign that it does not run.
import {
  GetMicrovmCommand,
  type GetMicrovmCommandOutput,
  type LambdaMicrovmsClient,
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

interface StateCheckOptions {
  client: LambdaMicrovmsClient;
  microvmId: string;
  /**
   * The remaining invocation time. `undefined`, as a value or as a result,
   * means the compute reports no deadline. A result that is not a finite
   * number means the same.
   */
  remainingTimeMs?: () => number | undefined;
}

/**
 * Thrown by {@link checkNotEnded} when its GetMicrovm call fails with a
 * transient error: throttling, a server error, a timeout, a connection
 * error, or any error other than `AccessDeniedException` and
 * `ResourceNotFoundException`.
 *
 * The request step runs that check only after a sign that the MicroVM does
 * not run. A later call can succeed. So the step logs one warning per step
 * attempt, and keeps sending the job. With the default retry strategy, that
 * is up to 5 warnings. `cause` is the error of the call.
 *
 * @internal
 */
export class MicrovmStateCheckError extends Error {
  override readonly name = "MicrovmStateCheckError";
}

/**
 * Thrown by {@link checkNotEnded} when GetMicrovm is denied.
 *
 * A later attempt is denied the same way. Without GetMicrovm, a job whose
 * MicroVM has ended keeps sending to the dead endpoint until both retry
 * tiers end. So the default retry strategy does not retry it, and the job
 * fails with `MicrovmDeliveryError` at once. The message names the denied
 * action and the permission, and ends with the request ID of the call.
 *
 * @internal
 */
export class MicrovmPermissionDeniedError extends Error {
  override readonly name = "MicrovmPermissionDeniedError";
}

/**
 * Checks the MicroVM state once, throws for a MicroVM that has ended, and
 * returns its current endpoint.
 *
 * @remarks
 * The request step calls it after a sign that the MicroVM does not run: an
 * HTTP 502 from the endpoint with `x-aws-proxy-error:
 * MICROVM_CONNECT_FAILED`, or no answer. The check runs for every job over
 * HTTP, from `microvm` and from a session. The endpoint of a terminated
 * MicroVM answers that 502, measured in us-east-1. So the check ends the job
 * of a dead MicroVM at once, instead of after both retry tiers.
 *
 * The endpoint of a suspended MicroVM answers the same 502. The check does
 * not resume it. The service resumes a MicroVM that was launched with
 * `idlePolicy.autoResumeEnabled: true` when a request arrives. So the
 * request step keeps sending the job.
 *
 * 1. GetMicrovm runs once. A denied call throws
 *    {@link MicrovmPermissionDeniedError}, and the job fails at once. A
 *    failure other than `AccessDeniedException` and
 *    `ResourceNotFoundException` throws {@link MicrovmStateCheckError}. The
 *    caller then keeps sending the job.
 * 2. `TERMINATING`, `TERMINATED`, or not found: it throws
 *    {@link MicrovmStateError}.
 * 3. Any other state, such as `RUNNING`, `PENDING`, `SUSPENDING`, or
 *    `SUSPENDED`: it returns the endpoint.
 *
 * @returns The endpoint that GetMicrovm reports, or `undefined` when it
 * reports none.
 */
export async function checkNotEnded(
  options: StateCheckOptions,
): Promise<string | undefined> {
  const started = Date.now();
  const { microvmId } = options;
  let current: GetMicrovmCommandOutput;
  try {
    // The call must end before the invocation reserve. A Lambda timeout
    // during the step attempt would record no outcome.
    current = await callBeforeDeadline(
      (sendOptions) =>
        options.client.send(
          new GetMicrovmCommand({ microvmIdentifier: microvmId }),
          sendOptions,
        ),
      reserveStartsAt(options.remainingTimeMs),
      () =>
        new MicrovmEndpointUnavailableError(
          `GetMicrovm for MicroVM ${microvmId} did not end before the invocation reserve, after ${Date.now() - started} ms.`,
        ),
    );
  } catch (error) {
    if (error instanceof MicrovmEndpointUnavailableError) {
      throw error;
    }
    const errorName = (error as Error).name;
    if (errorName === "ResourceNotFoundException") {
      throw microvmNotFound(microvmId, "GetMicrovm", error);
    }
    if (errorName === "AccessDeniedException") {
      throw new MicrovmPermissionDeniedError(
        withRequestId(
          `MicroVM ${microvmId} gave a sign that it does not run. GetMicrovm was denied, so the operation cannot check its state. The function's execution role needs lambda:GetMicrovm.`,
          "GetMicrovm",
          isMicrovmsServiceError(error) ? error : undefined,
        ),
        { cause: error },
      );
    }
    throw new MicrovmStateCheckError(
      (addRequestId("GetMicrovm", error) as Error).message,
      { cause: error },
    );
  }
  throwIfEnded(microvmId, current);
  return current.endpoint;
}

/**
 * Throws {@link MicrovmStateError} for a terminating or terminated MicroVM.
 * The GetMicrovm output carries the request ID in `$metadata`. The state
 * fails the step, so the message names that request ID. The service's
 * `stateReason` can end with a period, such as `Success.`. The message adds
 * its own period, so one trailing period of `stateReason` is removed.
 */
function throwIfEnded(
  microvmId: string,
  current: GetMicrovmCommandOutput,
): void {
  const { state } = current;
  const reason = current.stateReason?.replace(/\.$/, "");
  if (state === "TERMINATING" || state === "TERMINATED") {
    throw new MicrovmStateError(
      withRequestId(
        `MicroVM ${microvmId} is ${state}${reason ? `: ${reason}` : ""}.`,
        "GetMicrovm",
        current,
      ),
      state,
    );
  }
}
