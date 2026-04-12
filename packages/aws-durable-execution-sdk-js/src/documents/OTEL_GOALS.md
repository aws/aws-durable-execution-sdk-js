# OTel Observability Goals for the AWS Durable Execution SDK

## Why OTel for Durable Executions?

AWS Lambda durable executions have strong built-in observability. The service provides:

- APIs to query execution status and history.
- A console that shows execution timelines, step results, retry history, and errors

This built-in observability is excellent for understanding what happened _within_ a single durable execution. However, it is not **end-to-end observability**. Operators cannot see:

- The upstream service that triggered the execution (e.g. an API Gateway request, an SQS message)
- The downstream services called from within steps (e.g. DynamoDB, external APIs, other Lambda functions)
- How the execution fits into the broader request flow across the system

OpenTelemetry fills this gap. By emitting OTel spans for durable operations, executions become part of the same distributed trace as the services around them. An operator can follow a single `traceId` from an incoming HTTP request, through the durable execution and all its steps, to every downstream service call — in a single trace view in their existing observability backend.

Additionally, the built-in AWS observability is AWS-only. Customers who use third-party observability platforms — Datadog, Honeycomb, Grafana, New Relic, Dynatrace — cannot integrate durable execution data into their existing dashboards, alerts, and traces. OTel is the industry-standard bridge: once durable executions emit OTel spans, they work with any OTLP-compatible backend without any AWS-specific integration work.

---

## What We Want

A durable execution can span many Lambda invocations, run for hours or days, involve retries, parallel branches, and external callbacks. Without good observability, diagnosing failures or understanding performance is extremely difficult.

We want users of the SDK to be able to answer questions like:

- How long did this execution take end-to-end?
- Which step failed, and on which retry attempt?
- How long did the wait operation last?
- Which parallel branches ran, and did any fail?
- What was the execution path through the workflow?
- How does this execution compare to others in terms of latency?

---

## The Ideal Trace

For a workflow like this:

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const data = await context.step("fetch-data", () => fetchData(event.id));
  await context.wait({ seconds: 30 });
  const result = await context.step("process", () => process(data));
  return result;
});
```

The ideal trace in a backend like Jaeger or Datadog would look like:

```
[execution: durable-execution]          startTime=T+0, endTime=T+30s+ε
  ├── [step: fetch-data]                startTime=T+0, endTime=T+1s      ✅ accurate
  ├── [wait: 30s]                       startTime=T+1s, endTime=T+31s    ✅ accurate
  └── [step: process]                   startTime=T+31s, endTime=T+32s   ✅ accurate
```

Key properties:

- **Single span per logical operation** — not split across invocations
- **Accurate timing** — start and end times reflect actual wall-clock duration
- **Correct hierarchy** — steps are children of the execution span
- **No orphaned spans** — every child has a parent that arrives in the backend
- **No duplicate spans** — each operation appears exactly once

---

## What We Do NOT Want

- OTel as a hard dependency in the SDK bundle — it increases bundle size for all users, including those who don't use OTel
- Tracing logic scattered across handlers — it should be centralized
- Incorrect timing data — spans ended at the wrong time are worse than no spans
- Split traces — two spans for one logical operation make debugging harder, not easier
- Duplicate spans on replay — the replay model must not produce extra spans

---

## Why It's Hard

Durable executions have properties that break standard OTel assumptions:

1. **Multi-invocation execution** — a single logical operation spans multiple Lambda invocations. OTel spans are in-memory objects that don't survive process termination.

2. **Replay** — the workflow function re-executes from the beginning on every invocation. Without a replay guard, spans are created multiple times for the same logical operation.

3. **Container operations** — `runInChildContext`, `parallel`, and `map` create parent spans that may still be open when a child operation causes a termination. Standard OTel has no mechanism to pause and resume a span.

4. **Variable execution time** — a `wait` operation may last seconds or months. The span representing it needs a `startTime` from the original invocation and an `endTime` from a future invocation.

These challenges are not unique to our SDK — Temporal, Azure Durable Functions, Cloudflare Workflows, and Restate all face the same issues. See the platform comparison documents for how each one handles them.

---

## Design Principles

**Zero SDK dependencies on OTel.** The SDK is bundled into every Lambda deployment. Adding OTel packages increases bundle size for all users. Users who want OTel bring their own adapter.

**Plugin model.** The SDK exposes lifecycle hooks. Users implement plugins that call OTel (or any other observability library) at the right moments. Multiple plugins can be registered simultaneously.

**Replay-aware hooks.** The SDK's `onOperationStart` and `onOperationAttemptStart` hooks are not called for replayed (already-completed) operations. Plugins do not need to implement their own replay guards.

**Accurate timing from checkpoints.** The SDK stores `StartTimestamp` for operations in the checkpoint. Plugins can use this to backfill `startTime` when recreating spans in a new invocation.

**Deterministic operation IDs.** Every operation has a stable `operationId` derived from its name and position in the execution tree. This is the foundation for the deterministic `spanId` approach described in `OTEL_BETTER_SOLUTION.md`.

---

## What the Plugin Interface Provides

The plugin interface gives OTel adapters everything they need to produce the ideal trace:

| Hook                      | What it enables                                                           |
| ------------------------- | ------------------------------------------------------------------------- |
| `onExecutionStart`        | Start a root span covering the full execution lifetime                    |
| `onInvocationStart`       | Start an invocation-scoped span; flush exporter before termination        |
| `onInvocationEnd`         | End invocation span; flush before Lambda terminates                       |
| `onOperationStart`        | Start a logical operation span (once per operation, not per attempt)      |
| `onOperationEnd`          | End the operation span when permanently done                              |
| `onOperationAttemptStart` | Start a per-attempt span (for retry visibility)                           |
| `onOperationAttemptEnd`   | End the attempt span; `outcome` field distinguishes success/failure/retry |
| `onExecutionEnd`          | Record final status; emit execution-level metrics                         |

The `OperationInfo` passed to each hook includes `operationId`, `operationName`, `operationType`, `parentOperationId`, and `attempt` — enough to reconstruct the full operation hierarchy in any tracing backend.

---

## Related Documents

- `OTEL_CONCEPTS.md` — OTel fundamentals
- `OTEL_ANCESTOR_SPANS.md` — the termination problem in detail
- `OTEL_BETTER_SOLUTION.md` — three approaches to solving it
- `INSTRUMENTATION_PLUGIN.md` — the plugin interface specification
