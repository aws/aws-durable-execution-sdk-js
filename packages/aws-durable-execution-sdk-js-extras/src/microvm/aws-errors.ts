// The request IDs of the AWS calls that the MicroVM operations make, and the
// error for a MicroVM that can no longer take a job.
import { MICROVM_STATE_ERROR_NAME } from "./errors";

/** The Lambda MicroVMs API operations that the MicroVM operations call. */
export type MicrovmApiOperation =
  | "RunMicrovm"
  | "GetMicrovm"
  | "ResumeMicrovm"
  | "CreateMicrovmAuthToken"
  | "TerminateMicrovm";

/**
 * Returns the sentence that names an AWS call and its request ID, in the
 * form `<Operation> request ID: <id>.`.
 *
 * `source` is an AWS SDK error or an AWS SDK output. Both carry the request
 * ID in `$metadata.requestId`. A custom client can throw an error or return
 * an output without it. So the function returns "" when `source` has no
 * request ID that is a non-empty string.
 */
export function requestIdSentence(
  operation: MicrovmApiOperation,
  source: unknown,
): string {
  const requestId = (
    source as { $metadata?: { requestId?: unknown } } | null | undefined
  )?.$metadata?.requestId;
  return typeof requestId === "string" && requestId !== ""
    ? `${operation} request ID: ${requestId}.`
    : "";
}

/**
 * Returns `message` followed by the request ID sentence of
 * {@link requestIdSentence}. Returns `message` unchanged when `source` has
 * no request ID.
 *
 * An AWS SDK message often ends without a period, as in
 * "MicroVM not found: mvm-1". So a message that does not end a sentence gets
 * a period before the request ID sentence.
 */
export function withRequestId(
  message: string,
  operation: MicrovmApiOperation,
  source: unknown,
): string {
  const sentence = requestIdSentence(operation, source);
  if (sentence === "") {
    return message;
  }
  if (message === "") {
    return sentence;
  }
  return `${message}${/[.!?]$/.test(message) ? "" : "."} ${sentence}`;
}

/**
 * Appends the request ID of a failed AWS call to the message of its error,
 * and returns the same error object.
 *
 * @remarks
 * The function changes the message of the error object. It does not wrap
 * the error. The reasons, in order:
 *
 * 1. The core SDK checkpoints a step failure as its name and message. It
 *    does not checkpoint `cause` or `$metadata`.
 * 2. So only the message can carry the request ID to the handler and to the
 *    execution history.
 * 3. The step retry strategy receives the error that the step attempt
 *    throws. The default strategy reads `name`, `code`, and `$retryable`. A
 *    custom strategy can also test the AWS SDK class with `instanceof`.
 * 4. A wrapper error would need a copy of each of these fields. It would
 *    also fail the `instanceof` test.
 * 5. This function changes only `message`. So the error keeps its class,
 *    `name`, `code`, `$retryable`, `$fault`, and `$metadata`, and every retry
 *    decision stays the same.
 * 6. The AWS SDK creates a new error object for each failed call. No AWS SDK
 *    code reads the error after it throws. So the change affects only the
 *    code that receives the error from the step.
 *
 * The function returns the error unchanged in these cases:
 *
 * - `error` is not an `Error`, or its `message` is not a string.
 * - `error` has no request ID that is a non-empty string.
 * - The message already ends with the request ID sentence. A custom client
 *   can throw one error object for several calls. So the sentence is
 *   appended once.
 * - The message cannot be set, for example on a frozen error.
 *
 * The `stack` keeps the message that the error had when it was created.
 */
export function addRequestId<T>(operation: MicrovmApiOperation, error: T): T {
  if (!(error instanceof Error) || typeof error.message !== "string") {
    return error;
  }
  const sentence = requestIdSentence(operation, error);
  if (sentence === "" || error.message.endsWith(sentence)) {
    return error;
  }
  try {
    error.message = withRequestId(error.message, operation, error);
  } catch {
    // A frozen error, or one with a read-only message, keeps its message.
    // The step then fails as it did before this function existed.
  }
  return error;
}

/**
 * Thrown inside the request step when the MicroVM is terminating,
 * terminated, or removed. A later attempt finds the same state. So the name
 * is not in the retryable set, and the step fails at once. The delivery stage
 * then reports `MicrovmNotRunningError`.
 *
 * The message ends with the request ID of the AWS call that reported the
 * state, when that call has one. For a MicroVM that no longer exists,
 * `cause` is the AWS SDK error. Only the retry strategy and the plugin hooks
 * of a live step attempt see `cause`. The SDK checkpoints the message, not
 * the cause. A replayed step rebuilds the error from the checkpoint, without
 * it. So the message carries the request ID.
 */
export class MicrovmStateError extends Error {
  override readonly name = MICROVM_STATE_ERROR_NAME;

  constructor(
    message: string,
    /** The MicroVM state, or `undefined` when the MicroVM no longer exists. */
    readonly state?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Returns the {@link MicrovmStateError} for a call that answered
 * `ResourceNotFoundException`.
 *
 * GetMicrovm, ResumeMicrovm, and CreateMicrovmAuthToken each return
 * `ResourceNotFoundException` for a removed MicroVM. The request step calls
 * all three. So each call reports a removed MicroVM with the same error. The
 * AWS SDK error carries the request ID in `$metadata.requestId`. A support
 * case needs that ID. The SDK checkpoints only the message of a step
 * failure. So the message names the call and its request ID, and the AWS SDK
 * error becomes the cause.
 */
export function microvmNotFound(
  microvmId: string,
  operation: "GetMicrovm" | "ResumeMicrovm" | "CreateMicrovmAuthToken",
  error: unknown,
): MicrovmStateError {
  return new MicrovmStateError(
    withRequestId(
      `MicroVM ${microvmId} no longer exists. A session MicroVM lives at most its session timeout plus 5 minutes, and never longer than 8 hours.`,
      operation,
      error,
    ),
    undefined,
    { cause: error },
  );
}
