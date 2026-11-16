// The invocation reserve that every compute operation keeps. This module
// imports no AWS SDK client. So each compute subpath can use it without the
// client of another subpath.
import type { DurableContext } from "@aws/durable-execution-sdk-js";

/**
 * Every call inside a step attempt stops this long before the invocation
 * times out. A Lambda timeout during a step attempt records no outcome for
 * the attempt. So the step keeps time to throw and to checkpoint a retry.
 */
export const INVOCATION_RESERVE_MS = 10_000;

/**
 * A call that would start with less than this much time before the reserve
 * is not started. A shorter call is unlikely to finish, and the step retries
 * in a later invocation anyway.
 */
export const MIN_CALL_MS = 1_000;

/**
 * Returns the time by which every call must end: the start of the
 * invocation reserve. Returns `undefined` when the compute reports no
 * deadline.
 *
 * A Lambda timeout during a step attempt records no outcome for the attempt.
 * So the reserve is a hard limit. A call that is still running at the reserve
 * uses the time that the step needs to throw and to checkpoint.
 */
export function reserveStartsAt(
  remainingTimeMs: (() => number | undefined) | undefined,
): number | undefined {
  const remaining = remainingTimeMs?.();
  // remainingTime() passes on the compute's value unchanged. So this check
  // turns a value that is not a finite number into no deadline.
  return remaining === undefined || !Number.isFinite(remaining)
    ? undefined
    : Date.now() + remaining - INVOCATION_RESERVE_MS;
}

/**
 * Returns how long the next call may run: at most `capMs`, and never past
 * `hardDeadline`. Throws the result of `onExpired` when less than
 * {@link MIN_CALL_MS} remains before `hardDeadline`.
 */
export function callBudgetMs(
  hardDeadline: number | undefined,
  capMs: number,
  onExpired: () => Error,
): number {
  if (hardDeadline === undefined) {
    return capMs;
  }
  const left = hardDeadline - Date.now();
  if (left < MIN_CALL_MS) {
    throw onExpired();
  }
  return Math.min(capMs, left);
}

/**
 * Returns the message for a step that has too little time left to make its
 * first call, or `undefined` when the time suffices or is unknown.
 *
 * A call that would start with less than {@link MIN_CALL_MS} before the
 * invocation reserve does not start. So with less than 11 seconds left, the
 * step makes no call. The cause is the function timeout, so the message says
 * to raise it.
 *
 * The message rounds the time down. So it never reads "11.0 seconds left"
 * next to "needs at least 11 seconds".
 */
export function tooLittleTimeMessage(
  remainingTimeMs: (() => number | undefined) | undefined,
  step: string,
  action: string,
): string | undefined {
  const remaining = remainingTimeMs?.();
  const neededMs = INVOCATION_RESERVE_MS + MIN_CALL_MS;
  if (
    remaining === undefined ||
    !Number.isFinite(remaining) ||
    remaining >= neededMs
  ) {
    return undefined;
  }
  return `The ${step} step had ${(Math.floor(remaining / 100) / 10).toFixed(1)} seconds left in the Lambda invocation, and it needs at least ${neededMs / 1000} seconds to ${action}. Raise the function timeout.`;
}

/**
 * Runs one AWS SDK call that must end before `hardDeadline`.
 *
 * 1. Without a deadline, the call runs with the client's own settings.
 * 2. With a deadline, the call gets an abort signal that fires at the
 *    deadline. The signal also stops the AWS SDK's own retries of the call.
 * 3. An aborted call throws the result of `onExpired`. That error is
 *    retryable, so the step retries in a later invocation. The AWS SDK's
 *    `AbortError` is not retryable, so it is not rethrown.
 *
 * @internal
 */
export async function callBeforeDeadline<T>(
  call: (options: { abortSignal?: AbortSignal }) => Promise<T>,
  hardDeadline: number | undefined,
  onExpired: () => Error,
): Promise<T> {
  if (hardDeadline === undefined) {
    return call({});
  }
  const signal = AbortSignal.timeout(
    callBudgetMs(hardDeadline, Number.MAX_SAFE_INTEGER, onExpired),
  );
  try {
    return await call({ abortSignal: signal });
  } catch (error) {
    if (signal.aborted) {
      throw onExpired();
    }
    throw error;
  }
}

/**
 * Returns a function that reads the invocation's remaining time in
 * milliseconds. The operations use it to stop before the invocation times
 * out.
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
