# OTel Observability — Key Decisions

This document summarizes the decisions made during the OTel observability design for the AWS Durable Execution SDK. Each decision links to the document where it is analyzed in depth.

---

## Decision 1: No OTel in the SDK Core

**Decision:** OTel is not a dependency of the SDK. The SDK has zero observability dependencies.

**Rationale:**

- The SDK is bundled into every Lambda deployment. Adding OTel increases bundle size for all users, including those who don't use OTel.
- OTel's API and semantic conventions continue to evolve — coupling the SDK creates upgrade friction.
- Not all customers use OTel. Teams use Datadog, X-Ray, custom metrics, or nothing.

**Reference:** `OTEL_GOALS.md`, `INSTRUMENTATION_PLUGIN.md`

---

## Decision 2: Plugin Model for Observability

**Decision:** The SDK exposes a `DurableInstrumentationPlugin` interface. Users register plugins via `withDurableExecution(handler, { plugins: [...] })`. Multiple plugins can be registered simultaneously.

**Key hooks:**

- `onExecutionStart/End` — once per execution lifetime
- `onInvocationStart/End` — once per Lambda invocation
- `onOperationStart/End` — once per logical operation (regardless of retries)
- `onOperationAttemptStart/End` — once per attempt, with `outcome: 'succeeded' | 'failed' | 'retrying'`
- `enrichLogContext` — inject key-value pairs into every log line

**Reference:** `INSTRUMENTATION_PLUGIN.md`

---

## Decision 3: Sampling Based on ExecutionArn Hash

**Decision:** Sampling is the plugin's responsibility, not the SDK's. The SDK exports a `shouldSampleExecution(executionArn, rate)` helper that uses a deterministic hash of `executionArn` to make a consistent sampling decision across all invocations of the same execution.

**Rationale:** Per-invocation random sampling would produce incomplete traces. The same execution must always be either fully sampled or fully unsampled.

**Implementation:** FNV-1a or Node.js `crypto` hash of `executionArn`, normalized to `[0, 1)`, compared against the configured rate.

**Reference:** `INSTRUMENTATION_PLUGIN.md` (Sampling section)

---

## Decision 4: Deterministic SpanId for Cross-Invocation Span Continuity

**Decision:** OTel adapter plugins should derive `spanId` deterministically from `operationId` using a custom `IdGenerator`. This allows the same logical operation to produce the same `spanId` across all Lambda invocations, enabling a single span to be exported once when the operation truly completes — with accurate start and end times.

**How it works:**

1. Invocation 1: create span with `spanId = hash(operationId)`, do NOT export on termination
2. Invocation 2+: recreate span with same `spanId` and backfilled `startTime` from checkpoint
3. On completion: export once with accurate timing

**Reference:** `OTEL_BETTER_SOLUTION.md`, `OTEL_SPAN_LIFECYCLE.md`, `XRAY_OTEL.md`

---

## Decision 5: Remove `endAllActiveParentSpans()` from Handlers

**Decision:** The current POC's `endAllActiveParentSpans()` calls scattered across handlers should be removed. They produce incorrect timing data and split traces.

**Rationale:** Force-ending spans at termination points gives them wrong end times and creates duplicate spans on resume. The deterministic `spanId` approach (Decision 4) is the correct solution.

**Reference:** `OTEL_BETTER_SOLUTION.md`

---

## Decision 6: Configurable Context Extractor Per Invocation

**Decision:** OTel plugins must extract parent trace context inside the handler on every invocation (not at module load time). Rather than hardcoding X-Ray extraction logic, the official OTel adapter accepts a `contextExtractor` function that the user provides. The plugin calls it in `onInvocationStart` to get the parent context and runs the handler inside it.

**Why configurable:** Different customers trigger durable executions differently — via API Gateway (W3C headers in event), direct invoke (`clientContext.custom.traceparent`), SQS (message attributes), or X-Ray (`_X_AMZN_TRACE_ID`).

**Why per invocation:** `_X_AMZN_TRACE_ID` and `clientContext` are updated by the Lambda runtime before each invocation. Module-level code only runs once on cold start.

**Reference:** `BACKEND_TRACE_PROPAGATION.md`, `LAMBDA_TRACE_CONTEXT_PROPAGATION.md`

---

## Decision 7: No Backend Changes Required for Basic OTel Support

**Decision:** The SDK plugin model works without any backend changes for the common cases:

- X-Ray backend: already works — `traceFields` propagation provides same `Root` traceId across invocations
- Non-X-Ray backends via API Gateway: `traceparent` is in `event.headers`, plugin extracts it from invocation 1
- Non-X-Ray backends via direct invoke: `traceparent` can be passed in `ClientContext.Custom`

**One backend bug to fix:** `clientContext` is not stored or propagated across invocations. Once fixed, `clientContext.custom.traceparent` becomes the cleanest mechanism for cross-invocation W3C trace continuity.

**Reference:** `LAMBDA_TRACE_CONTEXT_PROPAGATION.md`, `BACKEND_TRACE_PROPAGATION.md`

---

## Decision 8: Official OTel Adapter Plugin (Separate Package)

**Decision:** AWS will ship an official OTel adapter plugin as a separate package (`@aws/durable-execution-sdk-js-otel` or similar). It is not part of the core SDK.

**What it implements:**

- `IdGenerator` using deterministic `hash(operationId)` for `spanId`
- `AWSXRayIdGenerator` for `traceId` (X-Ray compatible)
- Configurable `contextExtractor` function; ships with built-in extractors (`xRayContextExtractor`, `w3cClientContextExtractor`)
- `SimpleSpanProcessor` + OTLP gRPC exporter to ADOT collector
- `forceFlush()` in `onInvocationEnd`
- `enrichLogContext` returning `{ traceId, spanId }` from active span

**Reference:** `OTEL_XRAY_SETUP.md`, `INSTRUMENTATION_PLUGIN.md`

---

## Decision 9: `enrichLogContext` for Log-Trace Correlation

**Decision:** The plugin interface includes `enrichLogContext(info?: OperationInfo)` which returns arbitrary key-value pairs injected into every SDK log line. This replaces the current POC's direct `trace.getActiveSpan()` call in the logger.

**Rationale:** The logger cannot call OTel directly (no OTel dependency in SDK). The plugin provides whatever context is relevant — `traceId`/`spanId` for OTel, `dd.trace_id` for Datadog, custom correlation IDs for other systems.

**Reference:** `OTEL_LOG_CORRELATION.md`, `INSTRUMENTATION_PLUGIN.md`

---

## Decision 10: Container Spans (parallel, map, runInChildContext) — No Special Treatment

**Decision:** Container operations (`parallel`, `map`, `runInChildContext`) do not get special handling in the plugin interface. They fire `onOperationStart/End` like any other operation. The OTel adapter plugin decides whether to create container spans and how to handle the ancestor span problem.

**Context:** All surveyed platforms (Temporal, Cloudflare, Restate, Azure, Vercel) avoid container spans for parallel/map operations. Our SDK is unique in having them. The three options for handling them are documented in `OTEL_ANCESTOR_SPANS.md` and `OTEL_BETTER_SOLUTION.md`.

**Reference:** `OTEL_ANCESTOR_SPANS.md`, `OTEL_BETTER_SOLUTION.md`
