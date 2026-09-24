/**
 * Realm-safe replacement for a bare `value instanceof Error` check.
 *
 * Prefer this over a bare `value instanceof Error` whenever the value
 * originates from customer code (a thrown step/handler error, a rejected
 * promise reason, a plugin failure, a serdes error, etc.). `instanceof Error`
 * only matches errors created by the *current* realm's `Error` constructor, so
 * it silently returns `false` for an error thrown from a different realm, such
 * as a `vm` context, a `worker_threads` worker, or any other execution context
 * with its own set of globals. When that happens the SDK would otherwise
 * discard the real error and hand the customer a generic
 * `new Error("Unknown Error")` / `new Error(String(error))`, losing the
 * original `message`, `name` and `stack`.
 *
 * The check matches:
 *  - genuine same-realm `Error` instances, including subclasses and objects
 *    whose prototype chain includes `Error.prototype` (fast path), and
 *  - errors from any other realm, detected by their `[object Error]` brand.
 *
 * The brand comes from the `ErrorData` internal slot that only the `Error`
 * constructor can create, and that slot is realm independent. This is why the
 * check deliberately does not duck-type on the presence of `message` and
 * `name`: ordinary data can carry those properties (for example a logged
 * `{ name, message }` payload), and treating such a value as an error would
 * inject `errorType`, `errorMessage` and `stackTrace` fields into unrelated
 * log entries.
 *
 * A value can still opt in by defining `[Symbol.toStringTag] = "Error"`, which
 * is a deliberate act rather than something ordinary data does by accident.
 *
 * @param value - The value to inspect, typically a caught or rejected value.
 * @returns `true` if the value can be safely treated as an `Error`.
 *
 * @internal
 */
export function isError(value: unknown): value is Error {
  return (
    value instanceof Error ||
    Object.prototype.toString.call(value) === "[object Error]"
  );
}
