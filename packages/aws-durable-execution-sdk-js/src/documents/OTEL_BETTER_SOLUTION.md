# OTel Ancestor Span Problem: Why Force-Ending Spans Is Wrong and What to Do Instead

## The Problem

When a durable execution hits a termination point (wait, retry timer, invoke), the Lambda process suspends. Any OTel span that is still open at that moment is held in memory. When the process is eventually terminated, that memory is wiped — the span is gone, never exported.

Child spans that completed before the termination were already exported. They carry a `parentSpanId` pointing to the lost parent. In the tracing backend, those children appear orphaned — present but with no parent to attach to.

---

## The Original "Solution": Force-Ending Spans Before Termination

`OTEL_SPAN_FREEZING_ISSUE.md` describes this problem and proposes `endAllActiveParentSpans()` as the fix: walk up the `AsyncLocalStorage` context stack and call `span.end()` on every open ancestor span before the Lambda terminates.

**This trades one problem for two worse ones.**

### Problem 1: Wrong end time

The parent span is ended at the termination point, not when the operation actually completes. A `runInChildContext` that takes 30 seconds total gets a span with a duration of 2 seconds (the time until the wait). The timing data is wrong.

### Problem 2: Split trace on resume

When the Lambda resumes in a new invocation, the code replays from the top. `runInChildContext` runs again, creating a **new** parent span with a **new random `spanId`**. Now there are two spans with the same name:

- Span v1 (`spanId: "abc123"`) — ended at termination, wrong end time
- Span v2 (`spanId: "xyz789"`) — created on resume

The trace is split. `step: validate` is under v1. `step: process` (which ran after the wait) is under v2. The trace does not reflect reality.

---

## Three Better Approaches

### Option 1 — Deterministic SpanId, Export Once on Completion

Derive `spanId` deterministically from `operationId` using a hash function. The same `operationId` is stable across all invocations for the same logical operation.

**Flow:**

1. On invocation 1: create parent span with `spanId = hash(operationId)`, `startTime = now`
2. On termination: **do not end the span** — let it be garbage collected, never exported
3. On invocation 2: recreate the span with the **same `spanId`** and **backfilled `startTime`** from checkpoint
4. When the operation completes: end the span — exported **once**, accurate start and end times

**How to set a deterministic spanId:**

```typescript
class DurableIdGenerator {
  generateTraceId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  generateSpanId(): string {
    const operationId = getCurrentOperationId();
    if (operationId) {
      return hashToSpanId(operationId);
    }
    return crypto.randomBytes(8).toString("hex");
  }
}

const provider = new NodeTracerProvider({
  idGenerator: new DurableIdGenerator(),
});
```

**Trade-offs:**

- ✅ Single span per operation, accurate timing, no splits
- ⚠️ Requires custom `IdGenerator`
- ⚠️ If the execution never completes, the parent span is never exported — children remain orphaned

---

### Option 2 — Span Links Between Invocations

Each invocation creates its own root span with a random `spanId`. When a new invocation starts, it adds a **span link** from the new root span to the previous invocation's root span.

```typescript
const newSpan = tracer.startSpan("order", {
  links: [{ context: previousSpanContext }],
});
```

**Trade-offs:**

- ✅ Standard OTel API, no custom `IdGenerator` needed
- ✅ Works correctly with head-based sampling
- ❌ Trace is split — no single span represents the full operation lifetime

---

### Option 3 — Hybrid: Deterministic SpanId + Span Links

Combine both approaches. Use a deterministic `spanId` for the logical operation span (exported once on completion), and also emit span links between invocation root spans as a fallback.

**Trade-offs:**

- ✅ Single operation span with accurate timing when execution completes
- ✅ Fallback link chain covers the "never completes" edge case
- ⚠️ Most complexity of the three options

---

## Comparison

| Approach                              | End time accurate | Single span  | No orphans on completion | No orphans if never completes | Standard API only     |
| ------------------------------------- | ----------------- | ------------ | ------------------------ | ----------------------------- | --------------------- |
| `endAllActiveParentSpans()` (current) | ❌ Wrong          | ❌ Two spans | ✅                       | ✅                            | ✅                    |
| Option 1 — Deterministic spanId       | ✅                | ✅           | ✅                       | ❌ Orphaned                   | ⚠️ Custom IdGenerator |
| Option 2 — Span links                 | ✅ Per segment    | ❌ Split     | ✅                       | ✅                            | ✅                    |
| Option 3 — Hybrid                     | ✅                | ✅           | ✅                       | ✅                            | ⚠️ Custom IdGenerator |

---

## What Changes in the SDK

Regardless of which option is chosen, `endAllActiveParentSpans()` and all its call sites in the handlers should be removed. It produces incorrect data and is not a valid solution to the ancestor span problem.

The SDK already provides everything needed for any of the three options:

- Stable `operationId` per operation
- `StartTimestamp` in checkpoint metadata
- `onInvocationEnd` plugin hook for flushing the exporter before termination

The choice between options belongs in the OTel adapter plugin, not in the SDK core.

---

## What Happens If Two Spans With the Same spanId Are Exported

| Backend                                           | Behavior                                                        |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Jaeger                                            | Both stored as separate records — duplicate spans visible in UI |
| Zipkin                                            | Merges spans with same `(traceId, spanId)` — last write wins    |
| AWS X-Ray                                         | Likely last write wins                                          |
| OTLP backends (Honeycomb, Grafana Tempo, Datadog) | Generally last write wins, no deduplication guarantee           |

Not a concern in practice — the SDK prevents completed steps from re-executing on replay.
