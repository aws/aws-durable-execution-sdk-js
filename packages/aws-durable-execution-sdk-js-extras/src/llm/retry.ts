import type { RetryDecision } from "@aws/durable-execution-sdk-js";
import { LlmDeciderError, LlmInvalidResponseError } from "./errors";

/** Error names that a later attempt can succeed after. */
const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ThrottlingException",
  "ServiceUnavailableException",
  "InternalServerException",
  "ModelTimeoutException",
  "ModelNotReadyException",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
]);

/** Node.js codes of a failed connection or a socket timeout. */
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
const MAX_INVALID_RESPONSE_ATTEMPTS = 2;
const MAX_DELAY_SECONDS = 60;

/**
 * The default step retry strategy of the `llm` operations. It is the second
 * retry tier: the first tier runs inside the step attempt.
 *
 * @remarks
 * It retries throttling, server errors, timeouts, and connection failures, up
 * to 5 attempts in total, with an exponential delay of 2, 4, 8, and 16
 * seconds. It retries an invalid reply once, because a new attempt samples a
 * new reply. It does not retry access-denied, validation, unknown-model, or
 * guardrail errors, because a later attempt with the same input fails the same
 * way.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const defaultLlmRetryStrategy = (
  error: Error,
  attemptCount: number,
): RetryDecision => {
  if (error instanceof LlmInvalidResponseError) {
    return {
      shouldRetry: attemptCount < MAX_INVALID_RESPONSE_ATTEMPTS,
      delay: { seconds: 1 },
    };
  }
  const { code, $retryable } = error as {
    code?: unknown;
    $retryable?: unknown;
  };
  const status = error instanceof LlmDeciderError ? error.status : undefined;
  const retryable =
    RETRYABLE_ERROR_NAMES.has(error.name) ||
    (typeof code === "string" && RETRYABLE_ERROR_CODES.has(code)) ||
    $retryable !== undefined ||
    (error instanceof LlmDeciderError &&
      (status === undefined ||
        status === 408 ||
        status === 429 ||
        status >= 500));
  return {
    shouldRetry: retryable && attemptCount < MAX_ATTEMPTS,
    delay: { seconds: Math.min(2 ** attemptCount, MAX_DELAY_SECONDS) },
  };
};
