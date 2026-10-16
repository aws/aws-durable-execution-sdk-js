import type { RetryDecision } from "@aws/durable-execution-sdk-js";

/**
 * Error names that a later attempt can succeed after.
 *
 * `ConflictException` is included because TerminateMicrovm returns it while
 * the MicroVM is in a state transition. A reused client token with different
 * parameters is not in this set: RunMicrovm rejects it with
 * `ValidationException`, and a retry with the same parameters fails the same
 * way. The launch step always sends the same parameters for one token, so
 * that case does not occur.
 *
 * `TooManyRequestsException` and `ServiceException` have no retryable trait
 * in the service model. So the AWS SDK sets no `$retryable` on them, and they
 * are listed by name.
 *
 * `InsufficientCapacityException` is not in this set. The service answers it
 * with HTTP 500, but a retry seconds later fails the same way.
 */
const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "InternalServerException",
  "ServiceException",
  "ServiceUnavailableException",
  "ConflictException",
  // The transient error names of the AWS SDK's own retry strategy.
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  // The request step's first retry tier ended. A later attempt runs after a
  // longer backoff, outside the invocation.
  "MicrovmEndpointUnavailableError",
  "MicrovmRequestUnauthorizedError",
]);

/**
 * Node.js error codes of a failed connection or a socket timeout.
 *
 * The AWS SDK client retries these inside each attempt. When its retries end,
 * it throws the socket error itself. That error is named `Error`, carries the
 * code in `code`, and has no `$retryable`. So the step strategy checks the
 * code. The list is the one that the AWS SDK's own retry strategy uses:
 * `NODEJS_TIMEOUT_ERROR_CODES` and `NODEJS_NETWORK_ERROR_CODES` in the retry
 * module of `@smithy/core`. `EAI_AGAIN` is a temporary DNS failure.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

const MAX_ATTEMPTS = 5;
const MAX_DELAY_SECONDS = 60;

/**
 * The default retry strategy for the launch, request, and terminate steps of
 * {@link microvm}. It is the second retry tier.
 *
 * @remarks
 * It retries throttling, server-side, and state-conflict errors, connection
 * failures and timeouts, and any error that the AWS SDK marks as retryable.
 * It allows 5 attempts in total, with an exponential delay of 2, 4, 8, and 16
 * seconds, capped at 60 seconds. It does not retry validation, access-denied,
 * not-found, quota, or capacity errors, because a later attempt with the same
 * input fails the same way.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const defaultMicrovmRetryStrategy = (
  error: Error,
  attemptCount: number,
): RetryDecision => {
  const { code, $retryable } = error as {
    code?: unknown;
    $retryable?: unknown;
  };
  const retryable =
    RETRYABLE_ERROR_NAMES.has(error.name) ||
    (typeof code === "string" && RETRYABLE_ERROR_CODES.has(code)) ||
    $retryable !== undefined;
  return {
    shouldRetry: retryable && attemptCount < MAX_ATTEMPTS,
    delay: { seconds: Math.min(2 ** attemptCount, MAX_DELAY_SECONDS) },
  };
};
