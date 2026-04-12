# How Cloudflare Workflows Handles OpenTelemetry Tracing

## Two Separate Layers

**Layer 1 — Workers Automatic Tracing:** Cloudflare Workers has automatic, zero-code OTel tracing built into the `workerd` runtime. Enable with a single config flag. Automatically instruments every I/O operation (fetch calls, KV reads/writes, binding calls).

**Layer 2 — Workflows Metrics:** Cloudflare Workflows has its own separate observability system based on metrics and event logs, not OTel spans. Step-level event types (`STEP_START`, `STEP_SUCCESS`, `STEP_FAILURE`, `SLEEP_START`, etc.) are queryable via GraphQL. This is **not OTel** — it does not produce spans and does not connect to the Workers automatic tracing layer.

---

## The Gap: No OTel Spans for Workflow Steps

**Cloudflare Workflows does not produce OTel spans for `step.do()` executions.** Individual steps appear in the Workflows metrics system as event log entries, but not in the trace tree.

---

## Why This Approach Sidesteps the Ancestor Span Problem

Cloudflare avoids the ancestor span problem by simply not creating container or step spans at the workflow level. There are no open ancestor spans to worry about at termination points because the tracing layer only sees individual Worker invocations — each of which is a short-lived, bounded execution.

The trade-off: **no ancestor span problem, but also no cross-invocation trace continuity.**

---

## The AWS Lambda Equivalent

The AWS Durable Execution SDK already has the equivalent two-layer architecture:

| Cloudflare                                | AWS Lambda + Durable Execution SDK          |
| ----------------------------------------- | ------------------------------------------- |
| Workers automatic tracing (runtime-level) | X-Ray / Lambda auto-instrumentation         |
| Workflows metrics event log               | SDK instrumentation plugin hooks            |
| No step-level OTel spans by default       | Same — SDK does not produce them by default |

---

## Key Takeaways

| Cloudflare approach                  | Relevance to AWS Durable Execution SDK                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| No OTel spans for steps by default   | Validates the plugin model: step spans are opt-in                                             |
| No cross-invocation trace continuity | Same reality we face                                                                          |
| No ancestor span problem             | Achieved by having no container/step spans — same as our Option C in `OTEL_ANCESTOR_SPANS.md` |
