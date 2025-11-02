import { ErrorObject } from "@aws-sdk/client-lambda";
import { DurableOperationError } from "../../errors/durable-error/durable-error";

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
      StackTrace: error.stack?.split(/\r?\n/),
    };
  }

  return {
    ErrorData: data,
    ErrorMessage: "Unknown error",
  };
}
