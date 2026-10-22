import { ErrorObject } from "../../types/wire";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { STORE_STACK_TRACES } from "../constants/constants";

function isErrorLike(obj: unknown): obj is Error {
  return (
    obj instanceof Error ||
    (obj != null &&
      typeof obj === "object" &&
      "message" in obj &&
      "name" in obj)
  );
}

export function createErrorObjectFromError(
  error: unknown,
  data?: string,
): ErrorObject {
  if (error instanceof DurableOperationError) {
    // Use DurableOperationError's built-in serialization
    const errorObject = error.toErrorObject();
    if (data) {
      errorObject.ErrorData = data;
    }
    return errorObject;
  }

  if (isErrorLike(error)) {
    return {
      ErrorData: data,
      ErrorMessage: error.message,
      ErrorType: error.name,
      StackTrace: STORE_STACK_TRACES ? error.stack?.split(/\r?\n/) : undefined,
    };
  }

  return {
    ErrorData: data,
    ErrorMessage: "Unknown error",
  };
}

/**
 * The SDK's wrapper error types. A wrapper only records which kind of
 * operation an error passed through; the error it wraps is its `cause`.
 * `CallbackTimeoutError` and `BatchCompletionError` are not wrappers: they are
 * the failure itself.
 */
const SDK_WRAPPER_ERROR_TYPES: ReadonlySet<string> = new Set([
  "StepError",
  "CallbackError",
  "CallbackExternalError",
  "CallbackSubmitterError",
  "InvokeError",
  "ChildContextError",
  "PromiseCombinatorError",
  "WaitForConditionError",
]);

/** The most wrapper errors {@link unwrapSdkWrapperErrors} passes. */
export const MAX_WRAPPER_UNWRAP_DEPTH = 16;

function isSdkWrapperError(
  error: unknown,
): error is Error & { cause?: unknown } {
  if (error == null || typeof error !== "object") return false;
  const errorType = (error as { errorType?: unknown }).errorType;
  return (
    typeof errorType === "string" && SDK_WRAPPER_ERROR_TYPES.has(errorType)
  );
}

/**
 * Follows the `cause` chain of SDK wrapper errors and returns the error they
 * wrap. Only errors whose `errorType` is an SDK wrapper type are unwrapped; a
 * user error is returned as it is even when it has a cause. At most
 * {@link MAX_WRAPPER_UNWRAP_DEPTH} wrappers are passed. A wrapper without an
 * error-like cause, or whose cause was already visited, is returned itself.
 */
export function unwrapSdkWrapperErrors(error: unknown): unknown {
  let current = error;
  const visited = new Set<unknown>([error]);
  for (let depth = 0; depth < MAX_WRAPPER_UNWRAP_DEPTH; depth++) {
    if (!isSdkWrapperError(current)) return current;
    const cause = current.cause;
    if (!isErrorLike(cause) || visited.has(cause)) return current;
    visited.add(cause);
    current = cause;
  }
  return current;
}

/**
 * Builds the checkpointed error of a failed context (child context, map item,
 * parallel branch, promise combinator, waitForCallback).
 *
 * The SDK wrappers that escaped the context are unwrapped first, so the
 * checkpoint holds the type, message, and stack trace of the error that caused
 * the failure (for example `"PaymentError"`) rather than `"StepError"`. When
 * the wrapped error carries no `ErrorData`, the nearest `errorData` on the
 * wrappers is kept.
 */
export function createContextFailureErrorObject(error: unknown): ErrorObject {
  const original = unwrapSdkWrapperErrors(error);
  if (original === error) {
    return createErrorObjectFromError(error);
  }
  const errorObject = createErrorObjectFromError(original);
  if (errorObject.ErrorData === undefined) {
    errorObject.ErrorData = createErrorObjectFromError(error).ErrorData;
  }
  return errorObject;
}
