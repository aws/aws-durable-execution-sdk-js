// The request IDs of the AWS calls that the MicroVM operations make, and the
// error for a MicroVM that can no longer take a job.
import { LambdaMicrovmsServiceException } from "@aws-sdk/client-lambda-microvms";
import { MICROVM_STATE_ERROR_NAME } from "./errors";

/** The Lambda MicroVMs API operations that the MicroVM operations call. */
export type MicrovmApiOperation =
  | "RunMicrovm"
  | "GetMicrovm"
  | "ResumeMicrovm"
  | "CreateMicrovmAuthToken"
  | "TerminateMicrovm";

/**
 * Returns `true` when `error` is an error of the Lambda MicroVMs service.
 *
 * The AWS SDK resolves the credentials inside `client.send`. A credential
 * provider can call another service, such as STS for an assumed role. When
 * that call fails, `client.send` rejects with the error of the other
 * service. That error also carries a request ID in `$metadata.requestId`,
 * but the ID belongs to the other service. A custom client can also throw
 * its own error with a `$metadata` field. So only an error that is an
 * instance of `LambdaMicrovmsServiceException` gets the name of a Lambda
 * MicroVMs operation next to its request ID. Every modeled error of the
 * service extends that class. The AWS SDK also uses that class for an error
 * that the service model does not list.
 */
function isMicrovmsServiceError(
  error: unknown,
): error is LambdaMicrovmsServiceException {
  return error instanceof LambdaMicrovmsServiceException;
}

/**
 * Returns the sentence that names an AWS call and its request ID, in the
 * form `<Operation> request ID: <id>.`.
 *
 * `source` is an AWS SDK output, or an error of the Lambda MicroVMs service.
 * Both carry the request ID in `$metadata.requestId`. A custom client can
 * throw an error or return an output without it. So the function returns ""
 * when `source` has no request ID that is a non-empty string.
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
 * The message of each error that {@link addRequestId} changed: the message
 * before the change, and the message that the function wrote.
 *
 * A weak map does not keep an error object alive. So an entry exists only
 * while its error exists.
 */
const changedMessages = new WeakMap<
  Error,
  { original: string; written: string }
>();

/**
 * Sets the message of an error of the Lambda MicroVMs service to its
 * original message followed by the request ID of the failed call, and
 * returns the same error object.
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
 *    `name`, `code`, `$retryable`, `$fault`, and `$metadata`.
 * 6. A custom strategy can also match the message, for example with
 *    `createRetryStrategy({ retryableErrors: [...] })`. The longer message
 *    could change its decision. So each step calls the strategy through
 *    {@link withOriginalMessage}. For an AWS SDK error, the strategy then
 *    decides on the original message, and every retry decision stays the
 *    same. An error that the MicroVM operation creates itself, such as
 *    `MicrovmStateError` or "RunMicrovm returned no microvmId", has the
 *    request ID in its message when the strategy receives it.
 * 7. The AWS SDK creates a new error object for each failed call. No AWS SDK
 *    code reads the error after it throws. So the change affects only the
 *    code that receives the error from the step.
 *
 * A fake or a custom client can throw one error object for several calls.
 * Each call can have another operation or another request ID. So the
 * function keeps the original message of each error that it changed. Each
 * call builds the message from that original message. So the message names
 * only the last call, and a call without a request ID restores the original
 * message. Code outside this function can also set the message. When the
 * message differs from the one that the function wrote, the function takes
 * the current message as the new original.
 *
 * The function returns the error unchanged in these cases:
 *
 * - `error` is not an instance of `LambdaMicrovmsServiceException`. Such an
 *   error comes from somewhere other than the Lambda MicroVMs service, for
 *   example from STS in a credential provider, or from a custom client. Its
 *   request ID, if any, does not belong to a Lambda MicroVMs call.
 * - Its `message` is not a string.
 * - The new message equals the current message. For example, the error has
 *   no request ID, and the function never changed its message.
 * - The message cannot be set, for example on a frozen error.
 *
 * The `stack` shows the new message, unless code read `stack` before this
 * function ran.
 */
export function addRequestId<T>(operation: MicrovmApiOperation, error: T): T {
  if (!isMicrovmsServiceError(error) || typeof error.message !== "string") {
    return error;
  }
  const changed = changedMessages.get(error);
  const original =
    changed !== undefined && changed.written === error.message
      ? changed.original
      : error.message;
  const message = withRequestId(original, operation, error);
  if (message === error.message) {
    return error;
  }
  try {
    error.message = message;
    changedMessages.set(error, { original, written: message });
  } catch {
    // A frozen error, or one with a read-only message, keeps its message.
    // The step then fails as it did before this function existed.
  }
  return error;
}

/**
 * Calls `fn` while `error` has the message that it had before
 * {@link addRequestId} changed it. Returns what `fn` returns, and throws
 * what `fn` throws.
 *
 * @remarks
 * The step retry strategy receives the error that {@link addRequestId}
 * changed. A strategy that matches the message would then match the request
 * ID sentence too. The core SDK checkpoints the message after the strategy
 * returns. So the function sets the original message only while `fn` runs.
 * Then it sets the message with the request ID again, also when `fn` throws.
 *
 * The function calls `fn` with the current message in these cases:
 *
 * - {@link addRequestId} did not change the message of `error`.
 * - Code outside {@link addRequestId} set another message after it. The
 *   function keeps that message.
 * - The message cannot be set, for example on an error that was frozen
 *   after the change.
 *
 * `fn` can set its own message on the error. The function then keeps that
 * message, as it would be without this function.
 *
 * V8 builds the `stack` text when code first reads `stack`, and then keeps
 * it. A strategy, a logger, or `util.inspect` inside `fn` can read `stack`.
 * Without a read before the change, that first line would lack the request
 * ID, and the plugin hooks would then see a message with the request ID and
 * a stack without it. So the function reads `stack` before it sets the
 * original message. The `stack` then shows the message with the request ID,
 * as {@link addRequestId} describes.
 */
export function withOriginalMessage<R>(error: unknown, fn: () => R): R {
  const changed =
    error instanceof Error ? changedMessages.get(error) : undefined;
  if (changed === undefined || (error as Error).message !== changed.written) {
    return fn();
  }
  const target = error as Error;
  try {
    // Builds and keeps the stack text with the request ID. See above.
    void target.stack;
  } catch {
    // A `stack` getter that throws changes nothing here.
  }
  try {
    target.message = changed.original;
  } catch {
    return fn();
  }
  try {
    return fn();
  } finally {
    // Only a message that `fn` left unchanged gets the request ID again.
    if (target.message === changed.original) {
      try {
        target.message = changed.written;
      } catch {
        // `fn` froze the error, or made its message read-only. The error
        // keeps the original message.
      }
    }
  }
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
 * error becomes the cause. The caller matches the error by name. So the
 * message names the request ID only when the error is an error of the Lambda
 * MicroVMs service, as in {@link addRequestId}.
 *
 * The caller can be a session or {@link microvm}. Both configs name the
 * MicroVM lifetime `timeout`. Both launches set `maximumDurationInSeconds`
 * to `timeout` plus 5 minutes, capped at 8 hours. So the message states that
 * limit in words that fit both callers.
 */
export function microvmNotFound(
  microvmId: string,
  operation: "GetMicrovm" | "ResumeMicrovm" | "CreateMicrovmAuthToken",
  error: unknown,
): MicrovmStateError {
  return new MicrovmStateError(
    withRequestId(
      `MicroVM ${microvmId} no longer exists. A MicroVM lives at most its \`timeout\` plus 5 minutes, and never longer than 8 hours.`,
      operation,
      isMicrovmsServiceError(error) ? error : undefined,
    ),
    undefined,
    { cause: error },
  );
}
