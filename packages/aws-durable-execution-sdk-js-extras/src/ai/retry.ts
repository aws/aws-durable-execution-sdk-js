import type { RetryDecision } from "@aws/durable-execution-sdk-js";
import { AiTimeoutError, DeciderError, LlmStoppedError } from "./errors";
import { INVOCATION_RESERVE_MS } from "./shared";

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
  // AWS Lambda Invoke.
  "TooManyRequestsException",
  "ServiceException",
  // Amazon SageMaker InvokeEndpoint.
  "InternalFailure",
  "ServiceUnavailable",
  "InternalDependencyException",
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

/** Stop reasons of a reply that a new attempt can generate correctly. */
const RETRYABLE_STOP_REASONS: ReadonlySet<string> = new Set([
  "malformed_model_output",
  "malformed_tool_use",
]);

const MAX_ATTEMPTS = 5;
const MAX_DELAY_SECONDS = 60;

/**
 * The shortest delay after an {@link AiTimeoutError}. The error leaves about
 * {@link INVOCATION_RESERVE_MS} in the invocation. A shorter delay can start
 * the retry in the same invocation, for example while a sibling step in a
 * `parallel` keeps the invocation running. That retry would get almost no
 * time. So the delay is longer than the reserve, and the retry starts in a
 * new invocation.
 */
const TIMEOUT_MIN_DELAY_SECONDS = INVOCATION_RESERVE_MS / 1000 + 1;

/**
 * The default step retry strategy of the `decider` and `llm` operations.
 *
 * @remarks
 * It retries throttling, server errors, timeouts, and connection failures, up
 * to 5 attempts in total, with an exponential delay of 2, 4, 8, and 16
 * seconds. `AiTimeoutError` counts, with a delay of at least 11 seconds, so
 * the retry runs in a new invocation. A decision model that cannot be reached
 * or answers HTTP 408, 429, or 5xx counts too. It does not retry
 * `DeciderInvalidResponseError`, `LlmMaxTokensError`, `LlmStoppedError` (except
 * for `malformed_model_output` and `malformed_tool_use`),
 * another 3xx or 4xx from the decision model (such as 422 for an input that is
 * too long), or access-denied, validation, or unknown-model errors. These
 * repeat, so a later attempt fails the same way.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const defaultAiRetryStrategy = (
  error: Error,
  attemptCount: number,
): RetryDecision => {
  const { code, $retryable } = error as {
    code?: unknown;
    $retryable?: unknown;
  };
  const status = error instanceof DeciderError ? error.status : undefined;
  const retryable =
    error instanceof AiTimeoutError ||
    (error instanceof LlmStoppedError &&
      RETRYABLE_STOP_REASONS.has(error.stopReason)) ||
    RETRYABLE_ERROR_NAMES.has(error.name) ||
    (typeof code === "string" && RETRYABLE_ERROR_CODES.has(code)) ||
    $retryable !== undefined ||
    (error instanceof DeciderError &&
      (status === undefined ||
        status === 408 ||
        status === 429 ||
        status >= 500));
  const backoff = Math.min(2 ** attemptCount, MAX_DELAY_SECONDS);
  return {
    shouldRetry: retryable && attemptCount < MAX_ATTEMPTS,
    delay: {
      seconds:
        error instanceof AiTimeoutError
          ? Math.max(backoff, TIMEOUT_MIN_DELAY_SECONDS)
          : backoff,
    },
  };
};
