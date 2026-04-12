# How Temporal Handles OpenTelemetry Tracing

## Overview

Temporal is a durable workflow orchestration platform with the same fundamental challenge as the AWS Durable Execution SDK: workflow executions span multiple process invocations, involve retries, and coordinate work across distributed workers.

---

## The Interceptor Model

Temporal does not embed OTel directly into its core SDK. Instead, it ships OTel support as an **interceptor** — a separate, optional component. This is the same philosophy as the plugin model described in `INSTRUMENTATION_PLUGIN.md`.

```typescript
const worker = await Worker.create({
  interceptors: {
    workflowModules: [require.resolve("./otel-workflow-interceptor")],
    activityInbound: [
      (ctx) => new OpenTelemetryActivityInboundInterceptor(ctx),
    ],
  },
});
```

---

## Context Propagation: Headers, Not AsyncLocalStorage

The most important design decision: **trace context crosses boundaries via Temporal's message headers**, not `AsyncLocalStorage`. When a workflow schedules an activity, the interceptor injects the current `traceparent` header into the activity task. When the worker picks up that task (potentially on a different machine), the interceptor extracts the header and restores the trace context.

---

## The Replay Problem

Temporal's solution is a **`workflow.IsReplaying()` check** built into the interceptor:

```go
if !workflow.IsReplaying(ctx) {
    _, span := tracer.Start(ctx, "workflow-operation")
    defer span.End()
}
```

The SDK handles this: `onOperationStart` is **not called** for replayed operations, so plugins do not need to implement their own replay guards.

---

## What Temporal Does Not Solve

Temporal's approach is essentially **Option A from `OTEL_ANCESTOR_SPANS.md`**: end spans at the suspension point, create new spans on resume. A single logical workflow execution produces multiple `RunWorkflow` spans — one per workflow task. They share the same `traceId` and are linked, but each has its own start and end time representing only the compute time of that task.

---

## Key Takeaways for the AWS Durable Execution SDK

| Temporal approach                                  | Relevance to AWS Durable Execution SDK                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| OTel as an interceptor/plugin, not core SDK        | Same: plugin model in `INSTRUMENTATION_PLUGIN.md`                       |
| Context propagated via message headers             | SDK can propagate via checkpoint metadata                               |
| Replay guard (`IsReplaying()`)                     | SDK handles this: `onOperationStart` not called for replayed operations |
| Span links for async causality                     | Recommended approach in `OTEL_ANCESTOR_SPANS.md` Option B               |
| Span per workflow task, not per workflow execution | Same split-trace reality; no magic solution exists                      |
