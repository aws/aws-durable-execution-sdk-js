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
export function toErrorObject(err) {
  const obj = {
    ErrorType: err?.errorType ?? err?.name ?? "Error",
    ErrorMessage: err?.message ?? String(err),
  };
  if (err?.data !== undefined) obj.ErrorData = err.data;
  return obj;
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
