import {
  CallbackTimeoutError,
  ChildContextError,
  DurableOperationError,
} from "@aws/durable-execution-sdk-js";

/**
 * The base class of every error that {@link microvm} and
 * {@link microvmSession} report for a MicroVM failure.
 *
 * @remarks
 * Catch it to handle every MicroVM failure the same way. Catch a subclass to
 * handle one kind:
 *
 * - {@link MicrovmLaunchError}: `RunMicrovm` failed after all retries.
 * - {@link MicrovmDeliveryError}: the job could not be delivered over HTTP.
 *   Its subclass {@link MicrovmNotRunningError} means the session's MicroVM
 *   no longer runs.
 * - {@link MicrovmJobFailedError}: the job handler in the MicroVM failed.
 * - {@link MicrovmTimeoutError}: no result or no heartbeat arrived in time.
 *
 * The message names the operation and keeps the underlying message. For a
 * failed job, `errorData` is the `ErrorData` that the MicroVM reported.
 *
 * The SDK checkpoints a failed operation's error type, message, and data,
 * and rebuilds the error from them, on the first run and on replay alike. So
 * the SDK error that caused the failure, such as a `StepError`, is not kept.
 * `cause` is the rebuilt error, whose `name` is the MicroVM error type.
 *
 * The class survives replay at the operation's own boundary. A caller's own
 * `runInChildContext` does not restore it: the SDK wraps the failure in
 * `ChildContextError`, and rebuilds the inner error as a `StepError` whose
 * `cause.name` is the MicroVM error type. The SDK rebuilds every error type
 * it does not know that way.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmError extends DurableOperationError {
  readonly errorType: string = "MicrovmError";
}

/**
 * `RunMicrovm` failed after all retries, so no MicroVM runs the job.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmLaunchError extends MicrovmError {
  readonly errorType: string = "MicrovmLaunchError";
}

/**
 * The job could not be delivered over HTTP: the endpoint stayed unavailable
 * after all retries, the auth token was refused, or the route answered with a
 * client error such as 404.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmDeliveryError extends MicrovmError {
  readonly errorType: string = "MicrovmDeliveryError";
}

/**
 * The session's MicroVM can no longer run a job, because it is terminating,
 * terminated, or removed. It is a {@link MicrovmDeliveryError}, so code that
 * catches delivery failures also catches it.
 *
 * @remarks
 * A session MicroVM lives at most its session `timeout` plus 5 minutes, and
 * never longer than 8 hours, running or suspended. The platform then
 * terminates and removes it. A TerminateMicrovm call from outside the session
 * ends it too. A later attempt finds the same state, so the job is not
 * retried. To continue, start a new session.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmNotRunningError extends MicrovmDeliveryError {
  readonly errorType: string = "MicrovmNotRunningError";
}

/**
 * The job handler in the MicroVM failed. The MicroVM reported the failure
 * with `SendDurableExecutionCallbackFailure`.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmJobFailedError extends MicrovmError {
  readonly errorType: string = "MicrovmJobFailedError";
}

/**
 * No result arrived within the job's `timeout`, or no heartbeat arrived
 * within its `heartbeatTimeout`. A MicroVM that crashed or never booted ends
 * this way. The message keeps the service's reason, such as "Callback timed
 * out on heartbeat".
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export class MicrovmTimeoutError extends MicrovmError {
  readonly errorType: string = "MicrovmTimeoutError";
}

type MicrovmErrorClass = new (
  message: string,
  cause?: Error,
  errorData?: string,
) => MicrovmError;

const CLASSES: Readonly<Record<string, MicrovmErrorClass>> = {
  MicrovmError,
  MicrovmLaunchError,
  MicrovmDeliveryError,
  MicrovmNotRunningError,
  MicrovmJobFailedError,
  MicrovmTimeoutError,
};

/**
 * The name of the error that the request step throws when the MicroVM is
 * terminating, terminated, or removed. See `lifecycle.ts`.
 */
export const MICROVM_STATE_ERROR_NAME = "MicrovmStateError";

/** The stage of a MicroVM operation that failed. */
export type MicrovmStage = "launch" | "delivery" | "job";

/**
 * Converts an error of one stage into its MicroVM error. It runs inside the
 * child context, before the SDK checkpoints the failure. So the checkpoint
 * records the MicroVM error type, and {@link rebuildMicrovmError} can
 * restore the class from it.
 */
export function toMicrovmError(
  name: string,
  stage: MicrovmStage,
  error: unknown,
): unknown {
  if (error instanceof MicrovmError || !(error instanceof Error)) {
    return error;
  }
  const detail = error.message;
  const errorData =
    error instanceof DurableOperationError ? error.errorData : undefined;
  switch (stage) {
    case "launch":
      return new MicrovmLaunchError(
        `MicroVM "${name}": the launch failed: ${detail}`,
        error,
        errorData,
      );
    case "delivery":
      // The request step failed with the state error, and the SDK keeps the
      // step error's original name in cause.name.
      if (
        error.name === MICROVM_STATE_ERROR_NAME ||
        (error.cause instanceof Error &&
          error.cause.name === MICROVM_STATE_ERROR_NAME)
      ) {
        return new MicrovmNotRunningError(
          `MicroVM "${name}": the job could not be delivered: ${detail}`,
          error,
          errorData,
        );
      }
      return new MicrovmDeliveryError(
        `MicroVM "${name}": the job could not be delivered: ${detail}`,
        error,
        errorData,
      );
    case "job": {
      if (error instanceof CallbackTimeoutError) {
        return new MicrovmTimeoutError(
          `MicroVM "${name}": the job timed out: ${detail}`,
          error,
          errorData,
        );
      }
      // For a failed callback, the SDK sets cause.name to the ErrorType that
      // the MicroVM reported, such as the job handler's error class. The
      // checkpoint keeps only the message, so the message carries the type.
      const jobType =
        error.cause instanceof Error && error.cause.name !== "Error"
          ? ` (${error.cause.name})`
          : "";
      return new MicrovmJobFailedError(
        `MicroVM "${name}": the job failed${jobType}: ${detail}`,
        error,
        errorData,
      );
    }
  }
}

/**
 * Runs one stage and converts its failure with {@link toMicrovmError}.
 */
export async function inStage<T>(
  name: string,
  stage: MicrovmStage,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toMicrovmError(name, stage, error);
  }
}

/**
 * Restores a MicroVM error from the error that the SDK rebuilt from a
 * checkpoint.
 *
 * The SDK rebuilds an error type it does not know as a `StepError`, and it
 * sets `cause.name` to the checkpointed type. So the checkpointed type is
 * `cause.name`, unless the SDK knew the type itself.
 */
export function rebuildMicrovmError(
  error: DurableOperationError,
): MicrovmError | undefined {
  if (error instanceof MicrovmError) {
    return error;
  }
  const type =
    error.errorType === "StepError" ? error.cause?.name : error.errorType;
  const Class = type === undefined ? undefined : CLASSES[type];
  return Class
    ? new Class(error.message, error.cause, error.errorData)
    : undefined;
}

/**
 * The error mapper of an operation that contains no caller code: `microvm`,
 * and one `vm.invoke`. Every failure inside it is a MicroVM failure. So an
 * error of another type becomes a plain {@link MicrovmError}.
 */
export function microvmErrorMapper(
  name: string,
): (error: DurableOperationError) => DurableOperationError {
  return (error) =>
    rebuildMicrovmError(error) ??
    new MicrovmError(
      `MicroVM "${name}": ${error.message}`,
      error.cause,
      error.errorData,
    );
}

const PASS_THROUGH_ERROR_TYPES: ReadonlySet<string> = new Set([
  "CallbackError",
  "CallbackExternalError",
  "CallbackTimeoutError",
  "StepError",
]);

/**
 * The error mapper of a session. The session handler is caller code. So only
 * MicroVM errors are restored, and every other error keeps its SDK type.
 *
 * The SDK rebuilds an error type that it does not know, such as a plain
 * `Error` thrown by the handler, as `StepError`, and keeps the original type
 * as `cause.name`. So `errorType` alone cannot tell a failed step from a
 * failed handler. An SDK error passes through only when its `cause.name`
 * matches its type. Any other error is wrapped in `ChildContextError`, as
 * `runInChildContext` does without an error mapper.
 */
export function sessionErrorMapper(
  error: DurableOperationError,
): DurableOperationError {
  return (
    rebuildMicrovmError(error) ??
    (PASS_THROUGH_ERROR_TYPES.has(error.errorType) &&
    error.cause?.name === error.errorType
      ? error
      : new ChildContextError(error.message, error))
  );
}
