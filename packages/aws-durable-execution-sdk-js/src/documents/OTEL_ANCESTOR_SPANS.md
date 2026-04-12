# Handling Ancestor Spans and Lambda Freeze in Durable Executions

## The Problem in One Sentence

When a durable operation hits a termination point (a wait, retry timer, or invoke), the Lambda runtime suspends the process — and any OTel spans that are still open at that moment are lost forever.

---

## Background: Spans Are Transactions

The OTel specification is unambiguous: **all spans must be ended, and this is the responsibility of the implementer.** If a span is not ended before the process terminates, the OTel SDK's span processors will never see it. The span is gone. If that span happens to be a parent or ancestor span, all of its already-exported child spans become orphaned in the tracing backend.

---

## How This Manifests in Durable Executions

Consider this workflow:

```typescript
await context.runInChildContext("order", async (childCtx) => {
  await childCtx.step("validate", async () => validate());
  await childCtx.wait({ seconds: 30 }); // ← termination point
  await childCtx.step("process", async () => process());
});
```

When `childCtx.wait()` is reached, the Lambda terminates. At that moment, the following spans are still open:

- `order` (child-context span) — started at the top, not yet ended
- Any ancestor spans above it (e.g. an invocation-level root span)

These open spans will never be ended by their normal code path because the process is terminated. They are lost.

Child spans that completed _before_ the termination (e.g. `step: validate`) were already exported. But they were exported with a `parentSpanId` pointing to the `order` span — which is now lost. In the tracing backend, those child spans appear **orphaned**.

---

## Viable Approaches

### Option A — End ancestors at termination, accept split traces

End all open ancestor spans at the termination point with the current timestamp. On resume, create new spans for the remaining operations.

**Trade-offs:**

- Simple to implement
- Timing is wrong on both halves
- Trace is split — no single span represents the full operation

### Option B — Span links for cross-invocation causality (recommended)

End all open ancestor spans at the termination point. On resume, create new root-level spans and **link** them to the spans from the previous invocation using `span.addLink()`.

```typescript
const newSpan = tracer.startSpan("order", {
  links: [{ context: previousSpanContext }],
});
```

**Trade-offs:**

- ✅ Semantically correct — links honestly represent "this continues from that"
- ✅ Each segment has accurate timing
- ❌ Trace is split across invocations

### Option C — Skip container spans at termination boundaries

Container spans (`child-context`, `parallel`, `map`) are only emitted if they complete within a single invocation without hitting a termination point. If a container crosses a termination boundary, the container span is **not created at all** — its children attach to the invocation root span instead.

The logical hierarchy is still queryable via `durable.operation.parent_id` attributes even without a span hierarchy.

**Trade-offs:**

- ✅ Zero incorrect timing data
- ✅ No duplicate or split container spans
- ❌ Loses span-hierarchy grouping for containers that cross termination boundaries

---

## Replay Guard: Preventing Duplicate Spans

The SDK signals this through the operation hooks: `onOperationStart` and `onOperationAttemptStart` are **not called** for replayed (already-completed) operations. This is the replay guard — the SDK handles it, so the plugin does not need to.

---

## Summary

| Approach                    | Timing accuracy         | Trace continuity                      | Backend requirements | Complexity |
| --------------------------- | ----------------------- | ------------------------------------- | -------------------- | ---------- |
| A — End early, accept split | ❌ Wrong on both halves | ❌ Split                              | Standard OTel        | Low        |
| B — Span links              | ✅ Accurate per segment | ⚠️ Split but linked                   | Standard OTel        | Medium     |
| C — Skip container spans    | ✅ Accurate             | ✅ No splits (grouped via attributes) | Standard OTel        | Medium     |
