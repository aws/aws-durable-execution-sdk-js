# OTel Span Lifecycle and the Cross-Invocation Span Problem

## How OTel Spans Are Exported

Understanding when spans are sent to the backend is essential for reasoning about the ancestor span problem.

**Spans are exported only when they end.** Nothing is sent when a span starts. The OTel SDK holds the span in memory from `startSpan()` until `span.end()`, at which point the span processor (e.g. `BatchSpanProcessor`) picks it up and exports it.

For a parent + child:

```
parent.start()  → nothing exported
  child.start() → nothing exported
  child.end()   → child exported ✅
parent.end()    → parent exported ✅
```

The child is always exported before the parent because it ends first. The backend receives spans out of order routinely in distributed systems and reconstructs the tree using `parentSpanId` references — arrival order does not matter.

---

## Why Lambda Termination Breaks This

When a durable execution hits a termination point (wait, retry timer, invoke), the Lambda process is suspended and eventually terminated. The process memory is wiped. Any span object that was open at termination time is **gone forever** — it was never ended, so it was never exported.

The next invocation starts a completely fresh process with no memory of the previous one. It cannot resume or complete the span from the previous invocation because that object no longer exists.

```
Invocation 1:
  parent span created (spanId: "abc123", startTime: T+0)
  child span ends → exported with parentSpanId: "abc123" ✅
  Lambda terminates → parent span object destroyed, never exported ❌

Invocation 2 (fresh process):
  NEW parent span created (spanId: "xyz789", startTime: T+30s)
  ...
```

The backend now has a child span with `parentSpanId: "abc123"` but no span with `spanId: "abc123"` ever arrives. The child is orphaned.

---

## The Deterministic SpanId Solution

The insight that resolves this: if the span recreated in invocation 2 has the **same `spanId`** as the one that was open in invocation 1, the backend sees a single coherent span — not two separate ones.

The SDK already derives operation IDs deterministically from stable inputs (step names, positions in the execution tree). If `spanId` is derived from `operationId` using the same hash function, then every invocation that touches the same operation produces the same `spanId`.

The flow becomes:

```
Invocation 1:
  parent span created: spanId = hash(operationId), startTime = T+0
  child spans end → exported with parentSpanId = hash(operationId) ✅
  Lambda terminates → parent span object destroyed, never ended, never exported
  (intentional — we do NOT force-end it)

Invocation 2:
  parent span recreated: spanId = hash(operationId), startTime = backfilled from checkpoint
  operation completes → parent span ends → exported ONCE ✅
```

The backend receives:

- Child spans from invocation 1 with `parentSpanId = hash(operationId)`
- The parent span from invocation 2 with `spanId = hash(operationId)`, accurate `startTime` (from checkpoint), accurate `endTime`

When the parent arrives, the backend assembles the complete tree. One span, correct duration, no splits, no orphans.

---

## Requirements for This to Work

**1. Deterministic `spanId` from `operationId`**

The `spanId` must be the same across all invocations for the same logical operation. Since `operationId` is stable (derived from step name and position), `spanId = hash(operationId)` satisfies this.

**2. Backfilled `startTime` from checkpoint**

The parent span in invocation 2 must use the original start time from invocation 1, not `Date.now()`. The checkpoint already stores `StartTimestamp` for operations.

**3. Do NOT end/export the span on Lambda termination**

On termination, the open parent span must be silently discarded (garbage collected), not ended. Ending it would export it with a wrong end time, and then the final export in a later invocation would produce a duplicate `spanId`.

**4. Recreate the span on each invocation until completion**

On every invocation, the plugin recreates the parent span with the same `spanId` and backfilled `startTime`. It holds it open until `onOperationEnd` fires, at which point it ends and exports it.

---

## Comparison with Other Approaches

| Approach                             | Timing accuracy   | Orphaned children | Single span         | Complexity |
| ------------------------------------ | ----------------- | ----------------- | ------------------- | ---------- |
| End early (Option A)                 | ❌ Wrong end time | ✅ No orphans     | ❌ Split            | Low        |
| Span links (Option B)                | ✅ Per segment    | ✅ No orphans     | ❌ Split but linked | Medium     |
| Skip container spans (Option C)      | ✅ Accurate       | ✅ No orphans     | N/A                 | Medium     |
| Deterministic spanId (this approach) | ✅ Fully accurate | ✅ No orphans     | ✅ Single span      | Medium     |

The deterministic `spanId` approach is the only one that produces a single span with fully accurate timing and no orphaned children — without requiring a persistent server component or backend support for span snapshots.
