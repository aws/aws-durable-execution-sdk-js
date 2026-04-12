# OpenTelemetry in the AWS Durable Execution SDK — Index

This document is the entry point for all OTel-related documentation in this SDK. Read in order for the full picture, or jump to the section relevant to your question.

- **[OTEL_PROJECT_PLAN.md](./OTEL_PROJECT_PLAN.md)** — Start here for the full project overview: goals, key decisions, and the 7 sub-projects that make up this initiative.

---

## 1. Understanding OpenTelemetry

Start here if you are new to OTel or need a refresher on how it works.

- **[OTEL_CONCEPTS.md](./OTEL_CONCEPTS.md)** — Core OTel concepts: spans, traces, context propagation, TracerProvider, SpanProcessor, Exporter, IdGenerator, Propagator, Sampler, and how they fit together.

---

## 2. What We Want to Achieve

Why OTel matters for durable executions, what the ideal trace looks like, and the design principles behind our approach.

- **[OTEL_GOALS.md](./OTEL_GOALS.md)** — The observability goals: what questions we want to answer, what the ideal trace looks like, why it's hard, and the design principles (zero SDK dependencies, plugin model, replay-aware hooks, deterministic operation IDs).

- **[OTEL_SPAN_ATTRIBUTES.md](./OTEL_SPAN_ATTRIBUTES.md)** — Reference: the specific span attributes emitted by the current POC implementation.
- **[OTEL_LOG_CORRELATION.md](./OTEL_LOG_CORRELATION.md)** — How the SDK injects `traceId`/`spanId` into log lines for log-trace correlation, and how to achieve the same with the plugin approach.

---

## 3. How Other Platforms Handle It

Before designing our solution, we surveyed how other durable execution platforms approach OTel tracing. Each platform made different trade-offs.

- **[TEMPORAL_OTEL.md](./TEMPORAL_OTEL.md)** — Temporal uses SDK interceptors, header-based context propagation, and a replay guard (`IsReplaying()`). Closest to our situation.
- **[CLOUDFLARE_OTEL.md](./CLOUDFLARE_OTEL.md)** — Cloudflare separates platform-level auto-tracing (Workers runtime) from workflow-level observability (proprietary event log). No OTel spans for steps.
- **[RESTATE_OTEL.md](./RESTATE_OTEL.md)** — Restate solves the ancestor span problem by owning tracing in the server process, which never terminates. The cleanest solution, but requires a persistent server.
- **[AZURE_DURABLE_FUNCTIONS_OTEL.md](./AZURE_DURABLE_FUNCTIONS_OTEL.md)** — Azure uses a Durable Task Framework extension to manage orchestration-level spans. Closest serverless analog to our situation.
- **[VERCEL_WDK_OTEL.md](./VERCEL_WDK_OTEL.md)** — Vercel WDK has no OTel spans for steps at all; observability is through a proprietary CLI/dashboard event log.
- **[XRAY_OTEL.md](./XRAY_OTEL.md)** — AWS X-Ray uses a custom `IdGenerator` (`AWSXRayIdGenerator`) in production to embed timestamps in trace IDs. Validates the `IdGenerator` extension point for our deterministic `spanId` approach.

---

## 4. Current POC Implementation

The current branch contains a proof-of-concept OTel implementation embedded directly in the SDK. It is a starting point for understanding the problem space, not a production-ready solution.

- **[OTEL_SPAN_ATTRIBUTES.md](./OTEL_SPAN_ATTRIBUTES.md)** — Documents the span attributes produced by the current POC.
- **[OTEL_XRAY_SETUP.md](./OTEL_XRAY_SETUP.md)** — Step-by-step guide to deploying a durable Lambda with OTel → X-Ray, including all edge cases and lessons learned from the working POC.
- Source: `src/utils/otel/otel-instrumentation.ts` — The current implementation using `withStepSpan`, `withWaitSpan`, `withParallelSpan`, etc., and `endAllActiveParentSpans`.

**Known issues with the current POC:**

- OTel is a hard dependency in the SDK bundle (violates zero-dependency goal)
- `endAllActiveParentSpans()` is scattered across handlers rather than centralized
- The workaround for the termination problem produces incorrect data (see Section 5)

---

## 5. The Problem: Ancestor Spans and Lambda Termination

When a durable execution hits a termination point (wait, retry, invoke), the Lambda process suspends. Open spans are lost. This section explains the problem in depth.

- **[OTEL_SPAN_LIFECYCLE.md](./OTEL_SPAN_LIFECYCLE.md)** — How OTel spans are exported (only on `end()`), why spans are lost on Lambda termination, and the key insight: deterministic `spanId` derived from `operationId` enables exporting a span exactly once when the operation truly completes.
- **[OTEL_SPAN_FREEZING_ISSUE.md](./OTEL_SPAN_FREEZING_ISSUE.md)** — The original analysis from the POC. Describes the problem correctly but proposes `endAllActiveParentSpans()` as the solution — which is superseded by the analysis in Section 6.
- **[OTEL_ANCESTOR_SPANS.md](./OTEL_ANCESTOR_SPANS.md)** — Deep dive into the ancestor span problem: why force-ending spans produces split traces, what a correct solution looks like, and three viable approaches (end early, span links, skip container spans).

---

## 6. Better Solutions

- **[OTEL_BETTER_SOLUTION.md](./OTEL_BETTER_SOLUTION.md)** — Why `endAllActiveParentSpans()` is wrong (incorrect timing, split traces on resume), and three better approaches:
  - **Option 1** — Deterministic `spanId` via custom `IdGenerator`: export the span once on completion with accurate timing
  - **Option 2** — Span links between invocations: standard API, works for all cases, but split trace
  - **Option 3** — Hybrid: deterministic `spanId` + span links as fallback

---

## 7. The Plugin Approach

Rather than embedding OTel in the SDK, we expose a plugin interface. Users bring their own OTel adapter (or any other observability library). The SDK has zero observability dependencies.

- **[INSTRUMENTATION_PLUGIN.md](./INSTRUMENTATION_PLUGIN.md)** — The plugin interface spec: lifecycle hooks (`onExecutionStart/End`, `onInvocationStart/End`, `onOperationStart/End`, `onOperationAttemptStart/End`), multiple plugin registration, sampling via `shouldSampleExecution`, `enrichLogContext` for log enrichment, and where each hook fires in `with-durable-execution.ts`.
- **[DURABLE_OTEL_PLUGIN.md](./DURABLE_OTEL_PLUGIN.md)** — The official OTel adapter plugin (`@aws/durable-execution-sdk-js-otel`): installation, configuration, `contextExtractor`, span structure, attributes, sampling, and flushing.

---

## 8. Multi-Language SDK Support

- **[PYTHON_SDK_OTEL_PLUGIN.md](./PYTHON_SDK_OTEL_PLUGIN.md)** — OTel instrumentation plugin design for the Python SDK (`aws-durable-execution-sdk-python`).
- **[JAVA_SDK_OTEL_PLUGIN.md](./JAVA_SDK_OTEL_PLUGIN.md)** — OTel instrumentation plugin design for the Java SDK (`aws-durable-execution-sdk-java`).
- **[POWERTOOLS_INTEGRATION.md](./POWERTOOLS_INTEGRATION.md)** — AWS Powertools for Lambda and its relationship to durable execution observability. Covers what Powertools Tracer does (X-Ray only), the gaps it doesn't address, and the option of shipping the official OTel plugin under the Powertools namespace.
- **[LAMBDA_OTEL_INITIATIVE.md](./LAMBDA_OTEL_INITIATIVE.md)** — Summary of the Lambda platform's native OTel initiative and how it affects durable executions. Covers OTLP Forwarder, W3C propagation, cold start reduction, and 3P egress — and why the two projects are independent and not blocking each other.
- **[DURABLE_METRICS_PLUGIN.md](./DURABLE_METRICS_PLUGIN.md)** — Metrics plugin design: destination-agnostic `DurableMetricsPlugin` core + emitters (CloudWatch, custom).
- **[EXECUTION_SUMMARY_PLUGIN.md](./EXECUTION_SUMMARY_PLUGIN.md)** — Plugin design for writing structured execution summary records to CloudWatch Logs, enabling Logs Insights queries to find executions by input/output fields, status, duration, and more.

---

## 9. Trace Context Propagation

- **[LAMBDA_TRACE_CONTEXT_PROPAGATION.md](./LAMBDA_TRACE_CONTEXT_PROPAGATION.md)** — All options developers use to pass parent trace context to a Lambda invocation (X-Ray header, clientContext, event payload, API Gateway headers, SQS attributes). No SDK changes needed — the plugin reads from whichever mechanism the developer used.
- **[BACKEND_TRACE_PROPAGATION.md](./BACKEND_TRACE_PROPAGATION.md)** — How the durable execution backend propagates trace context today (X-Ray `traceFields`), the gap for W3C `traceparent`, options to address it, and context from the Step Functions OTel migration.

---

## 10. Key Decisions Summary

A single document summarizing all design decisions made during this work. Read this after going through the sections above.

- **[OTEL_DECISIONS.md](./OTEL_DECISIONS.md)** — All decisions in one place: no OTel in SDK core, plugin model, sampling, deterministic spanId, removing `endAllActiveParentSpans`, `_X_AMZN_TRACE_ID` extraction, no backend changes needed, official OTel adapter plugin, log-trace correlation, and container span handling.
