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
 */
const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ThrottlingException",
  "InternalServerException",
  "ServiceUnavailableException",
  "ConflictException",
  "TimeoutError",
  // The request step's first retry tier ended. A later attempt runs after a
  // longer backoff, outside the invocation.
  "MicrovmEndpointUnavailableError",
  "MicrovmRequestUnauthorizedError",
]);

const MAX_ATTEMPTS = 5;
const MAX_DELAY_SECONDS = 60;

/**
 * The default retry strategy for the launch, request, and terminate steps of
 * {@link microvm}. It is the second retry tier.
 *
 * @remarks
 * It retries throttling, server-side, and state-conflict errors, and any error
 * that the AWS SDK marks as retryable. It allows 5 attempts in total, with an
 * exponential delay of 2, 4, 8, and 16 seconds, capped at 60 seconds. It does
 * not retry validation, access-denied, not-found, or quota errors, because a
 * later attempt with the same input fails the same way.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const defaultMicrovmRetryStrategy = (
  error: Error,
  attemptCount: number,
): RetryDecision => {
  const retryable =
    RETRYABLE_ERROR_NAMES.has(error.name) ||
    (error as { $retryable?: unknown }).$retryable !== undefined;
  return {
    shouldRetry: retryable && attemptCount < MAX_ATTEMPTS,
    delay: { seconds: Math.min(2 ** attemptCount, MAX_DELAY_SECONDS) },
  };
};
