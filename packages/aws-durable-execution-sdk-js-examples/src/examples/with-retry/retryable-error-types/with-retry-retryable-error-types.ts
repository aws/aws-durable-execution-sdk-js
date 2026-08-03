import {
  DurableContext,
  withDurableExecution,
  createLinearRetryStrategy,
  JitterStrategy,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "With Retry - Retryable Error Types",
  description:
    "Shows selective retries: retry only errors matching a specific error " +
    "class (retryableErrorTypes) or a message pattern (retryableErrors), and " +
    "fail fast on everything else.",
};

/**
 * A transient error class representing an upstream rate limit. Errors of this
 * type should be retried.
 */
class RateLimitError extends Error {
  // Default the message so the class is `new () => Error` compatible, as
  // required by `retryableErrorTypes`.
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * A permanent, non-retryable error representing bad input. Retrying will never
 * help, so the retry strategy must NOT match it.
 */
class ValidationError extends Error {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}

// Retry only errors that are instances of RateLimitError. Because
// retryableErrorTypes is specified (and retryableErrors is not), every OTHER
// error class is treated as non-retryable and fails immediately.
const retryByErrorType = createLinearRetryStrategy({
  maxAttempts: 5,
  initialDelay: { seconds: 1 },
  increment: { seconds: 1 },
  jitter: JitterStrategy.NONE,
  retryableErrorTypes: [RateLimitError],
});

// Retry only errors whose message contains the substring "throttled",
// regardless of the concrete error class. Useful when a dependency throws
// generic Errors but encodes the retryable condition in the message.
const retryByMessage = createLinearRetryStrategy({
  maxAttempts: 5,
  initialDelay: { seconds: 1 },
  increment: { seconds: 1 },
  jitter: JitterStrategy.NONE,
  retryableErrors: ["throttled"],
});

interface Input {
  /**
   * Which retry-filter to demonstrate:
   * - "type": retry by error class (RateLimitError), then succeed.
   * - "message": retry by message substring ("throttled"), then succeed.
   * - "non-retryable": throw a ValidationError that matches neither filter,
   *   so the step fails on the first attempt with no retries.
   */
  mode?: "type" | "message" | "non-retryable";
}

export const handler = withDurableExecution(
  async (event: Input, context: DurableContext) => {
    const mode = event?.mode ?? "type";
    const retryStrategy =
      mode === "message" ? retryByMessage : retryByErrorType;

    return await context.step(
      "call-flaky-api",
      async ({ attempt }) => {
        if (mode === "non-retryable") {
          // Neither the RateLimitError type nor the "throttled" message
          // pattern matches, so the strategy returns shouldRetry: false and
          // the step fails immediately on attempt 1.
          throw new ValidationError("Field 'amount' must be a positive number");
        }

        // Transient failures on the first two attempts, then success. Only the
        // matching error is retried, so the step recovers on attempt 3.
        if (attempt < 3) {
          if (mode === "message") {
            throw new Error(
              `Request was throttled by the upstream API (attempt ${attempt})`,
            );
          }
          throw new RateLimitError(`Too many requests (attempt ${attempt})`);
        }

        return `api call succeeded on attempt ${attempt}`;
      },
      { retryStrategy },
    );
  },
);
