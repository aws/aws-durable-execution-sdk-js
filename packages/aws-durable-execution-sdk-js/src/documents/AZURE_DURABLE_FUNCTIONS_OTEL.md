# How Microsoft Azure Durable Functions Handles OpenTelemetry Tracing

## Overview

Azure Durable Functions is Microsoft's durable execution framework built on Azure Functions. It uses an event-sourcing replay model where the orchestrator function re-executes from the beginning on every invocation — functionally identical to the AWS Durable Execution SDK's replay model.

---

## Built-in Distributed Tracing (V2)

Durable Functions has a built-in distributed tracing feature called **Distributed Tracing V2**, enabled via `host.json`:

```json
{
  "extensions": {
    "durableTask": {
      "tracing": { "distributedTracingEnabled": true, "version": "V2" }
    }
  }
}
```

This produces OTel-compatible spans visible in Application Insights. Spans are produced by the **Durable Task Framework extension**, not user code. The orchestration span covers the full logical lifetime of the orchestration. Replay events are filtered out by default.

---

## Custom OTel Spans: The Replay Guard Pattern

For custom spans, the `context.IsReplaying` check is mandatory:

```csharp
using var span = !context.IsReplaying
    ? activitySource.StartActivity("orchestration.order-processing") : null;
```

Activity functions have no replay concern — they execute exactly once per attempt.

---

## Container Operations

For fan-out/fan-in (equivalent to our `parallel`/`map`), **there is no container span**. Each `CallActivityAsync` produces its own `activity:` span as a sibling under the orchestration span. This is the same approach as Temporal and Restate — no container spans for parallel operations.

---

## The Ancestor Span Problem

The built-in Distributed Tracing V2 solves it by having the **Durable Task Framework extension** manage the orchestration-level span. The extension knows the full lifecycle of the orchestration and can produce a single orchestration span with accurate timing.

For custom spans in user code, the recommended pattern is **phase-based spans** — create a span for each logical phase, end it before the suspension point, and start a new span after resumption. This is essentially **Option A from `OTEL_ANCESTOR_SPANS.md`**.

---

## Key Takeaways for the AWS Durable Execution SDK

Azure Durable Functions is the closest analog to our situation:

| Azure Durable Functions                             | AWS Durable Execution SDK                                        |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `context.IsReplaying` replay guard                  | SDK handles via `onOperationStart` not firing for replayed ops   |
| Built-in Distributed Tracing V2 (extension-managed) | No equivalent built-in; plugin model fills this role             |
| No container spans for fan-out/fan-in               | Our SDK has `parallel`/`map` container spans — unique to our SDK |
| Phase-based spans for cross-suspension tracing      | Same recommendation in `OTEL_ANCESTOR_SPANS.md` Option A/B       |

The most important observation: **Azure Durable Functions is the only platform surveyed that has a built-in solution for the orchestration-level span** while still running on serverless compute without a persistent server. It achieves this by having the Durable Task Framework extension — which runs as part of the Azure Functions host — manage the span lifecycle.

Our SDK does not have an equivalent extension layer. The plugin model is the correct response.
