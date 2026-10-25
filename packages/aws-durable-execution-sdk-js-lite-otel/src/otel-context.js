// Sets the active span of the OpenTelemetry API without importing the API:
// 1. Several copies of @opentelemetry/api can be loaded in one process. So the API keeps
//    one shared registry on globalThis, under Symbol.for("opentelemetry.js.api.<major>").
//    context.setGlobalContextManager stores the context manager in the registry's
//    `context` field. Every copy of the API reads it from there.
// 2. The active span is the value of the context key
//    Symbol.for("OpenTelemetry Context Key SPAN"). trace.setSpanContext stores a
//    non-recording span under that key.
// 3. So the plugin can call the registered context manager itself, with a context that
//    holds a non-recording span. Then trace.getActiveSpan() in user code returns it.
// 4. So the plugin has no dependency on @opentelemetry/api.
// The risk: this depends on the internal layout of the API's major version 1. A future
// major version uses a different key. Then user spans silently stop nesting under the
// durable spans. The durable spans are unaffected, because the plugin sets their parents
// from its own ids.

// Only major version 1 of the API stores its registry under this key. The API also
// compares the registry's `version` with its own. The plugin has no API version, so it
// reads no other field than `context`. It calls only active(), with() and
// Context.setValue(), and every 1.x context manager implements them.
const REGISTRY_KEY = Symbol.for("opentelemetry.js.api.1");
export const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");

// The methods of NonRecordingSpan of @opentelemetry/api: it records nothing.
const nonRecordingSpan = (spanContext) => {
  const span = Object.freeze({
    spanContext: () => spanContext,
    setAttribute: () => span,
    setAttributes: () => span,
    addEvent: () => span,
    addLink: () => span,
    addLinks: () => span,
    setStatus: () => span,
    updateName: () => span,
    end: () => {},
    isRecording: () => false,
    recordException: () => {},
  });
  return span;
};

// Runs fn with the span context as the active span. Without a registered context
// manager, the API uses its NoopContextManager, which only calls fn. So does this.
export function runWithSpanContext(spanContext, fn) {
  const manager = globalThis[REGISTRY_KEY]?.context;
  if (manager === undefined) return fn();
  return manager.with(
    manager.active().setValue(SPAN_KEY, nonRecordingSpan(spanContext)),
    fn,
  );
}
