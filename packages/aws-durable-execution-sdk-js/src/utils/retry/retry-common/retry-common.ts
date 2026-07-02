import { JitterStrategy } from "../../../types";

/**
 * Applies a jitter strategy to a delay value.
 *
 * @param delay - Base delay in seconds (before jitter)
 * @param strategy - Jitter strategy to apply
 * @returns Delay in seconds with jitter applied
 *
 * @remarks
 * - {@link JitterStrategy.NONE}: returns the delay unchanged
 * - {@link JitterStrategy.FULL}: random value between 0 and `delay`
 * - {@link JitterStrategy.HALF}: random value between `delay / 2` and `delay`
 * - Any unrecognized value: returns the delay unchanged
 *
 * @internal
 */
export const applyJitter = (
  delay: number,
  strategy: JitterStrategy,
): number => {
  switch (strategy) {
    case JitterStrategy.NONE:
      return delay;
    case JitterStrategy.FULL:
      // Random between 0 and delay
      return Math.random() * delay;
    case JitterStrategy.HALF:
      // Random between delay/2 and delay
      return delay / 2 + Math.random() * (delay / 2);
    default:
      return delay;
  }
};

/**
 * Resolves the effective retryable-error filters, applying the shared default
 * behavior: when neither filter is specified, all errors are retried.
 *
 * @param retryableErrors - User-supplied message patterns, if any
 * @param retryableErrorTypes - User-supplied error class types, if any
 * @returns The resolved, non-undefined filters to evaluate against errors
 *
 * @remarks
 * - If neither filter is specified: `retryableErrors` defaults to a match-all pattern (retry all)
 * - If only `retryableErrorTypes` is specified: `retryableErrors` defaults to `[]`
 * - If only `retryableErrors` is specified: `retryableErrorTypes` defaults to `[]`
 *
 * @internal
 */
export const resolveRetryableErrors = (
  retryableErrors?: (string | RegExp)[],
  retryableErrorTypes?: (new () => Error)[],
): {
  retryableErrors: (string | RegExp)[];
  retryableErrorTypes: (new () => Error)[];
} => {
  const shouldUseDefaultErrors =
    retryableErrors === undefined && retryableErrorTypes === undefined;

  return {
    retryableErrors: retryableErrors ?? (shouldUseDefaultErrors ? [/.*/] : []),
    retryableErrorTypes: retryableErrorTypes ?? [],
  };
};

/**
 * Determines whether an error is retryable based on message patterns and/or
 * error types. The two filters are combined using OR logic.
 *
 * @param error - The error thrown by the operation
 * @param retryableErrors - Message patterns (strings matched with `includes`, RegExp with `test`)
 * @param retryableErrorTypes - Error class types matched with `instanceof`
 * @returns `true` if the error matches either filter
 *
 * @internal
 */
export const isErrorRetryable = (
  error: Error,
  retryableErrors: (string | RegExp)[],
  retryableErrorTypes: (new () => Error)[],
): boolean => {
  const isRetryableErrorMessage = retryableErrors.some((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(error.message);
    }
    return error.message.includes(pattern);
  });

  const isRetryableErrorType = retryableErrorTypes.some(
    (ErrorType) => error instanceof ErrorType,
  );

  return isRetryableErrorMessage || isRetryableErrorType;
};

/**
 * Applies jitter and normalizes a base delay into a whole number of seconds
 * that is always at least 1.
 *
 * @param baseDelaySeconds - Base delay in seconds (before jitter), already capped
 * @param jitter - Jitter strategy to apply
 * @returns Integer delay in seconds, minimum 1
 *
 * @internal
 */
export const finalizeDelaySeconds = (
  baseDelaySeconds: number,
  jitter: JitterStrategy,
): number => {
  const delayWithJitter = applyJitter(baseDelaySeconds, jitter);
  // Ensure delay is an integer >= 1
  return Math.max(1, Math.round(delayWithJitter));
};
