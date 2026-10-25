import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { VERSION } from "./version.js";

// The plugin builds finished spans as plain objects with the fields of ReadableSpan from
// @opentelemetry/sdk-trace-base 2.x. A SpanExporter reads only these fields. So the
// plugin needs no Tracer and no TracerProvider.

const SCOPE = {
  name: "@aws/durable-execution-sdk-js-lite-otel",
  version: VERSION,
};

export const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "STOPPED",
  "CANCELLED",
]);

// A record timestamp is a number of epoch seconds. The lite SDK converts the invocation
// event's milliseconds when it loads the state. Returns epoch milliseconds.
export const recordMs = (t) => t * 1000;

// HrTime is [seconds, nanoseconds]. Epoch nanoseconds exceed 2^53, so the seconds are
// split off before the multiplication.
const hrTime = (ms) => {
  const sec = Math.floor(ms / 1000);
  const nanos = Math.round((ms - sec * 1000) * 1e6);
  return nanos >= 1e9 ? [sec + 1, nanos - 1e9] : [sec, nanos];
};

export const spanContext = (traceId, spanId) => ({
  traceId,
  spanId,
  traceFlags: 1,
});

// Drops the undefined values. OTLP has no encoding for undefined.
const defined = (attributes) =>
  Object.fromEntries(
    Object.entries(attributes).filter(([, v]) => v !== undefined),
  );

// error is an ErrorObject { ErrorType, ErrorMessage } or undefined.
export function buildSpan({
  traceId,
  spanId,
  parentSpanId,
  name,
  startMs,
  endMs,
  ok,
  statusMessage,
  error,
  attributes,
  links = [],
  resource,
}) {
  // The Lambda clock and the service clock can differ. A negative duration is invalid.
  const end = Math.max(startMs, endMs);
  const ctx = spanContext(traceId, spanId);
  return {
    name,
    kind: SpanKind.INTERNAL,
    spanContext: () => ctx,
    parentSpanContext:
      parentSpanId === undefined
        ? undefined
        : { ...spanContext(traceId, parentSpanId), isRemote: true },
    startTime: hrTime(startMs),
    endTime: hrTime(end),
    duration: hrTime(end - startMs),
    status: ok
      ? { code: SpanStatusCode.OK }
      : {
          code: SpanStatusCode.ERROR,
          message: error?.ErrorMessage ?? statusMessage,
        },
    attributes: defined(attributes),
    links,
    events: error
      ? [
          {
            name: "exception",
            attributes: defined({
              "exception.type": error.ErrorType,
              "exception.message": error.ErrorMessage,
            }),
            time: hrTime(end),
            droppedAttributesCount: 0,
          },
        ]
      : [],
    ended: true,
    resource,
    instrumentationScope: SCOPE,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

// The error of a failed record, from the details of its type.
export const recordError = (r) =>
  r.StepDetails?.Error ??
  r.CallbackDetails?.Error ??
  r.ChainedInvokeDetails?.Error ??
  r.ContextDetails?.Error;

// A resource with the fields that @opentelemetry/otlp-transformer 0.2xx reads:
// attributes and schemaUrl. The other fields complete the Resource interface of
// @opentelemetry/resources 2.x, for exporters that call them.
export function plainResource(attributes) {
  const attrs = defined(attributes);
  return {
    attributes: attrs,
    schemaUrl: undefined,
    asyncAttributesPending: false,
    waitForAsyncAttributes: async () => {},
    merge: (other) => plainResource({ ...attrs, ...other?.attributes }),
    getRawAttributes: () => Object.entries(attrs),
  };
}
