import { ErrorObject } from "../../types/wire";
import { DurableOperationError } from "../../errors/durable-error/durable-error";
import { STORE_STACK_TRACES } from "../constants/constants";
import { isErrorLike } from "./is-error-like";

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
