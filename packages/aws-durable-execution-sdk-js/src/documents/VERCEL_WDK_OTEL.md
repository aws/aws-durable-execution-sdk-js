# How Vercel Workflow Development Kit Handles OpenTelemetry Tracing

## Overview

Vercel's **Workflow Development Kit (WDK)** is an open-source TypeScript framework for building durable, multi-step applications and AI agents. It uses a replay-based execution model similar to the AWS Durable Execution SDK.

---

## Observability: Built-in, Platform-Managed

**Layer 1 — Vercel platform tracing:** `@vercel/otel` automatically instruments Vercel Functions — capturing invocation spans, outbound HTTP calls, and platform operations.

**Layer 2 — Workflow-specific observability:** Every step, input, output, sleep, and error inside a workflow is recorded automatically in Vercel's managed persistence layer, viewable in the Vercel dashboard. It is **not OTel** — it is a proprietary event log similar to Cloudflare's `workflowsAdaptiveGroups`.

---

## OTel Support: What Exists and What Doesn't

**No OTel spans for WDK workflow steps.** The WDK's `'use step'` directive does not produce OTel spans. Step executions appear in the Vercel dashboard's workflow event log but are not exported as OTel spans to external backends.

The WDK does not expose an `isReplaying` flag in its public API (unlike Temporal's `workflow.IsReplaying()` or Azure's `context.IsReplaying`). Users who add custom OTel spans inside workflow functions have no built-in mechanism to suppress them during replay.

---

## Key Takeaways for the AWS Durable Execution SDK

| Vercel WDK                               | AWS Durable Execution SDK                                            |
| ---------------------------------------- | -------------------------------------------------------------------- |
| No OTel spans for steps by default       | Same — plugin model fills this role                                  |
| Platform auto-tracing via `@vercel/otel` | Lambda X-Ray / OTel Lambda layer                                     |
| No `isReplaying` exposed to users        | SDK handles via `onOperationStart` not firing for replayed ops       |
| No container operations                  | Our SDK has `parallel`/`map`/`runInChildContext` — unique to our SDK |

The WDK's approach is the simplest of all platforms surveyed: no OTel spans for workflow steps at all, rely on the platform's built-in event log for workflow-level observability. This completely avoids the ancestor span problem by not having step spans — the same as Cloudflare's approach.
