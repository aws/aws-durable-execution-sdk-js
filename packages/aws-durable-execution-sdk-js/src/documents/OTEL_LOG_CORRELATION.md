# Log-Trace Correlation: Connecting SDK Logs to OTel Spans

## What the Current POC Does

Every log line emitted by `context.logger` includes the active OTel span's `traceId` and `spanId` as structured JSON fields:

```json
{
  "requestId": "dee824d7-...",
  "executionArn": "arn:aws:lambda:...",
  "operationId": "c4ca4238a0b92382",
  "attempt": 1,
  "traceId": "69c18d7c541e59917a2cf7b2730cca77",
  "spanId": "a1b2c3d4e5f67890",
  "level": "INFO",
  "timestamp": "2026-03-23T17:27:34.397Z",
  "message": "Executing greet step"
}
```

This is implemented in `durable-context.ts` — when the logger's `getDurableLogData()` is called, it reads the active OTel span via `trace.getActiveSpan()` and injects `traceId` and `spanId`.

**Why this is useful:** In CloudWatch Logs Insights, you can search for a specific `traceId` and find every log line emitted during that trace — across all Lambda invocations of the same execution.

---

## The Problem with the Current Approach

The logger calls `trace.getActiveSpan()` directly from `@opentelemetry/api`. This means:

1. `@opentelemetry/api` must be a dependency of the SDK — which we want to avoid
2. If no OTel provider is registered, `trace.getActiveSpan()` returns a no-op span with an invalid context — `traceId` and `spanId` will be all zeros
3. The logger is tightly coupled to OTel even though it should be observability-library-agnostic

---

## The Plugin Approach

With the plugin model, the SDK has no OTel dependency. The logger can't call `trace.getActiveSpan()` directly. Instead, the plugin interface exposes an optional `enrichLogContext` method that the logger calls before emitting each log line:

```typescript
enrichLogContext?(): Record<string, string | number | boolean> | undefined;
```

The SDK's logger merges the returned object into every log entry:

```typescript
const extra = plugin?.enrichLogContext?.();
if (extra) {
  Object.assign(result, extra);
}
```

This is general-purpose — not OTel-specific:

```typescript
// OTel plugin: inject traceId and spanId
const otelPlugin: DurableInstrumentationPlugin = {
  enrichLogContext() {
    const span = trace.getActiveSpan();
    if (!span || !isSpanContextValid(span.spanContext())) return undefined;
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  },
};

// Datadog plugin: inject Datadog trace correlation fields
const datadogPlugin: DurableInstrumentationPlugin = {
  enrichLogContext() {
    return {
      "dd.trace_id": tracer.scope().active()?.context().toTraceId(),
      "dd.span_id": tracer.scope().active()?.context().toSpanId(),
    };
  },
};
```

When multiple plugins are registered, their `enrichLogContext` results are merged — later plugins override earlier ones on key conflicts.

---

## Querying Correlated Logs in CloudWatch

```sql
-- Find all log lines for a specific trace
fields @timestamp, level, message, operationId, attempt
| filter traceId = "69c18d7c541e59917a2cf7b2730cca77"
| sort @timestamp asc
```

```sql
-- Find all executions that had errors, with their trace IDs
fields @timestamp, executionArn, traceId, message
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```
