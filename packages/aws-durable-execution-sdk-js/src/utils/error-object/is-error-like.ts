/**
 * Duck-typed check for values that should be treated as `Error` instances.
 *
 * Prefer this over a bare `value instanceof Error` whenever the value
 * originates from customer code (a thrown step/handler error, a rejected
 * promise reason, a plugin failure, a serdes error, etc.). `instanceof Error`
 * only matches errors created by the *current* realm's `Error` constructor, so
 * it silently returns `false` for an error thrown from a different realm - a
 * `vm` context, a `worker_threads` worker, or any other execution context with
 * its own set of globals. When that happens the SDK would otherwise discard the
 * real error and hand the customer a generic `new Error("Unknown Error")` /
 * `new Error(String(error))`, losing the original `message`, `name`, and
 * `stack`.
 *
 * The check matches:
 *  - genuine same-realm `Error` instances (fast path), and
 *  - cross-realm errors and error-like objects that expose both a `message` and
 *    a `name` property. This covers cross-realm `Error`s because `message` is an
 *    own property set by the constructor and `name` is inherited from that
 *    realm's `Error.prototype`, which the `in` operator finds by walking the
 *    prototype chain.
 *
 * @param value - The value to inspect, typically a caught or rejected value.
 * @returns `true` if the value can be safely treated as an `Error`.
 *
 * @internal
 */
export function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (value != null &&
      typeof value === "object" &&
      "message" in value &&
      "name" in value)
  );
}
