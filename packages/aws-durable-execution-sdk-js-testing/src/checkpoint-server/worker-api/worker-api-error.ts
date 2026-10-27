/**
 * An API error as a plain object, so it can cross the worker thread boundary.
 *
 * `postMessage` clones an `Error` with its message and stack only. The `name`
 * of a subclass and properties such as `$metadata` are lost. The SDK
 * classifies a checkpoint failure by its `name` and its HTTP status in
 * `$metadata`. So the worker sends errors in this form, and the main thread
 * rebuilds them.
 */
export interface SerializedWorkerApiError {
  readonly kind: "SerializedWorkerApiError";
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly $fault?: unknown;
  readonly $metadata?: unknown;
}

/**
 * Converts an `Error` thrown by an API handler into a plain object. Any other
 * value is returned unchanged.
 */
export function serializeWorkerApiError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const aws = error as Error & { $fault?: unknown; $metadata?: unknown };
  return {
    kind: "SerializedWorkerApiError",
    name: error.name,
    message: error.message,
    stack: error.stack,
    $fault: aws.$fault,
    $metadata: aws.$metadata,
  } satisfies SerializedWorkerApiError;
}

/**
 * Rebuilds an `Error` from {@link serializeWorkerApiError}'s output. Any other
 * value is returned unchanged.
 */
export function deserializeWorkerApiError(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "SerializedWorkerApiError"
  ) {
    return value;
  }
  const serialized = value as SerializedWorkerApiError;
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) {
    error.stack = serialized.stack;
  }
  if (serialized.$fault !== undefined) {
    Object.assign(error, { $fault: serialized.$fault });
  }
  if (serialized.$metadata !== undefined) {
    Object.assign(error, { $metadata: serialized.$metadata });
  }
  return error;
}
