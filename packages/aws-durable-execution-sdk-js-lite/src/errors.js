// The only error class. Every failed operation throws it, on the first run and on replay.
export class DurableOperationError extends Error {
  constructor({ errorType, message, data, cause } = {}) {
    super(message);
    this.name = "DurableOperationError";
    this.errorType = errorType;
    this.data = data;
    this.cause = cause;
  }
}

// Stack traces are not sent. They can be large and they leak paths.
// The service accepts only strings in ErrorType and ErrorData. Other libraries put
// objects in `data`, for example the parsed body of an HTTP response. A rejected update
// fails the execution. So only DurableOperationError, whose fields come from an
// ErrorObject, supplies errorType and data. This matches the full SDK.
export function toErrorObject(err) {
  if (err instanceof DurableOperationError) {
    const obj = {
      ErrorType: err.errorType ?? err.name,
      ErrorMessage: err.message,
    };
    if (err.data !== undefined) obj.ErrorData = err.data;
    return obj;
  }
  return {
    ErrorType: err?.name ?? "Error",
    ErrorMessage: err?.message ?? String(err),
  };
}

export function fromErrorObject(obj, fallbackType) {
  return new DurableOperationError({
    errorType: obj?.ErrorType ?? fallbackType,
    message: obj?.ErrorMessage ?? "Unknown error",
    data: obj?.ErrorData,
  });
}

// Replay found a different operation than the code asked for. Continuing would return
// a wrong result, so the execution ends as FAILED.
export function nonDeterministicError(message) {
  return new DurableOperationError({
    errorType: "NonDeterministicExecutionError",
    message,
  });
}
