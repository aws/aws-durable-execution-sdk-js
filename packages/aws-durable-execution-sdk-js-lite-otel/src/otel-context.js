// Sets the active span of the OpenTelemetry API. The plugin never imports the API. It
// uses one of two paths.
//
// Path 1: the user passes the API as otelApi. Then the plugin calls only three public
// functions: context.active(), trace.setSpanContext() and context.with(). Every API
// version that keeps these functions works, also a future major version.
//
// Path 2: no otelApi. Then the plugin finds the context manager without the API:
// 1. Several copies of @opentelemetry/api can be loaded in one process. So the API keeps
//    one shared registry on globalThis, under Symbol.for("opentelemetry.js.api.<major>").
//    context.setGlobalContextManager stores the context manager in the registry's
//    `context` field. Every copy of the API reads it from there.
// 2. The active span is the value of the context key
//    Symbol.for("OpenTelemetry Context Key SPAN"). trace.setSpanContext stores a
//    non-recording span under that key.
// 3. So the plugin can call the registered context manager itself, with a context that
//    holds a non-recording span. Then trace.getActiveSpan() in user code returns it.
// This path depends on the internal layout of the API's major version 1. Another major
// version stores its registry under another key, with a layout the plugin does not know.
// So for another major version, the plugin only runs fn and logs one warning. The durable
// spans are unaffected, because the plugin sets their parents from its own ids.

// Only major version 1 of the API stores its registry under this key. The API also
// compares the registry's `version` with its own. The plugin has no API version, so it
// reads no other field than `context`. It calls only active(), with() and
// Context.setValue(), and every 1.x context manager implements them.
const REGISTRY_KEY = Symbol.for("opentelemetry.js.api.1");
const ANY_REGISTRY = /^opentelemetry\.js\.api\.(\d+)$/;
export const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");

// The major versions that were already reported. The warning is about the process: the
// loaded API is the same for every invocation. So this set is process-wide diagnostic
// state at module level. It holds no per-invocation state.
const warned = new Set();

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

// Logs one line for each registry of an unknown major version that was not reported yet.
function warnUnknownMajors() {
  for (const key of Object.getOwnPropertySymbols(globalThis)) {
    const major = ANY_REGISTRY.exec(key.description ?? "")?.[1];
    if (major === undefined || major === "1" || warned.has(major)) continue;
    warned.add(major);
    const version = globalThis[key]?.version ?? `${major}.x`;
    // biome-ignore lint/suspicious/noConsole: deliberate -- missing nesting must be visible, and Lambda sends console output to CloudWatch.
    console.warn(
      `durable-execution-sdk-js-lite-otel: @opentelemetry/api ${version} is not supported for context propagation. Spans from your code do not nest under durable spans. Pass otelApi to createOtelPlugin, or use @opentelemetry/api 1.x.`,
    );
  }
}

// Returns runWithSpanContext(spanContext, fn). It runs fn with the span context as the
// active span, and returns what fn returns. createOtelPlugin calls it once. So the cache
// below lives in the closure of one createOtelPlugin call.
//
// Without otelApi, the registry is looked up on the first call. The result is cached only
// when the registry exists:
// 1. The API creates the registry object once. It never deletes it. It only adds and
//    deletes its fields. So a found registry stays valid, and its `context` field is read
//    on every call.
// 2. The user can register a context manager after the plugin was created, for example
//    with NodeSDK.start(). So a missing registry is looked up again on every call.
// 3. That lookup is one property read. The symbol scan for other major versions runs
//    only when it misses. The scan takes about 1 microsecond with few symbols on
//    globalThis, and a step attempt makes at least one checkpoint request. So the
//    result of the scan is not cached.
export function contextRunner(otelApi) {
  if (otelApi !== undefined) {
    const { context, trace } = otelApi;
    return (spanContext, fn) =>
      context.with(trace.setSpanContext(context.active(), spanContext), fn);
  }
  let registry;
  return (spanContext, fn) => {
    registry ??= globalThis[REGISTRY_KEY];
    if (registry === undefined) {
      warnUnknownMajors();
      return fn();
    }
    // Without a registered context manager, the API uses its NoopContextManager, which
    // only calls fn. So does this.
    const manager = registry.context;
    if (manager === undefined) return fn();
    return manager.with(
      manager.active().setValue(SPAN_KEY, nonRecordingSpan(spanContext)),
      fn,
    );
  };
}
