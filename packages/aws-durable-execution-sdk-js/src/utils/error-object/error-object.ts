import { ErrorObject } from "../../types/wire";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { STORE_STACK_TRACES } from "../constants/constants";
import { isError } from "./is-error";

/**
 * Deliberately permissive check, local to wire serialization.
 *
 * Unlike {@link isError}, this also accepts plain objects that merely carry a
 * `message` and a `name`, because a value arriving here is already on its way
 * to becoming an `ErrorObject` on the wire and callers may hand us an
 * error-shaped payload rather than a real `Error`. Keeping it local makes sure
 * that leniency does not leak into paths such as logging, where treating
 * ordinary data as an error would inject spurious error fields.
 */
function isErrorLike(obj: unknown): obj is Error {
  return (
    isError(obj) ||
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
