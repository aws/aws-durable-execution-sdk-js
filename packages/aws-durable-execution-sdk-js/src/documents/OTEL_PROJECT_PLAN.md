# OTel Observability for AWS Durable Execution SDK — Project Plan

## Goal

AWS Lambda durable executions have strong built-in observability for understanding what happened within a single execution. However, they lack **end-to-end observability** — operators cannot see the upstream services that triggered the execution, the downstream services called from within steps, or how the execution fits into the broader request flow across the system.

OpenTelemetry fills this gap. By emitting OTel spans for durable operations, executions become part of the same distributed trace as the services around them. An operator can follow a single `traceId` from an incoming HTTP request, through the durable execution and all its steps, to every downstream service call — in a single trace view in their existing observability backend.

Additionally, customers who use third-party observability platforms — Datadog, Honeycomb, Grafana, New Relic, Dynatrace — cannot integrate durable execution data into their existing dashboards and traces today. OTel is the industry-standard bridge: once durable executions emit OTel spans, they work with any OTLP-compatible backend without AWS-specific integration work.

### What We Want

For a workflow like this:

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const data = await context.step("fetch-data", () => fetchData(event.id));
  await context.wait({ seconds: 30 });
  const result = await context.step("process", () => process(data));
  return result;
});
```

The ideal trace in any OTel backend would look like:

```
[execution: durable-execution]          startTime=T+0, endTime=T+30s+ε
  ├── [step: fetch-data]                startTime=T+0, endTime=T+1s
  ├── [wait: 30s]                       startTime=T+1s, endTime=T+31s
  └── [step: process]                   startTime=T+31s, endTime=T+32s
```

Single span per logical operation, accurate timing, correct hierarchy, no orphaned or duplicate spans.

---

## Customer Experience

### Today (no OTel support)

Customers who add OTel instrumentation to a durable Lambda today — without any SDK support — run into three fundamental problems:

**1. Trace shape does not match the durable execution model**
A durable execution replays the handler function from the top on every Lambda invocation. Auto-instrumented downstream calls that happen outside of steps re-execute on every replay, producing spans that don't reflect the actual number of times that work happened. The resulting trace has a shape that matches the Lambda invocation pattern — not the logical workflow — making it misleading and hard to interpret.

**2. No operation-level spans**
There are no spans for individual durable operations — steps, waits, invokes, parallel branches. Customers see Lambda invocation spans (from X-Ray or the OTel Lambda layer), but nothing inside them that represents the logical work the execution is doing. A step that retried 4 times, a wait that lasted 2 days, a parallel block with 10 branches — all invisible.

**3. Operations scattered across invocations with no parent**
A durable execution spans many Lambda invocations. Each invocation is a separate trace. There is no execution-level root span connecting them, and no way to see that invocation 1, invocation 2, and invocation 3 are all part of the same logical workflow. Operations that start in one invocation and complete in another appear as orphaned fragments — or not at all, because the open span is lost when Lambda freezes.

---

### After This Change

With the OTel plugin, the trace shape matches the durable execution model — not the Lambda invocation pattern. Customers get one span per logical operation with accurate timing, correct nesting, and a single root span covering the full execution lifetime across all invocations. The three problems above are directly addressed:

- **Trace shape matches the workflow** — replay is invisible to the tracing system; hooks only fire for live operations
- **One span per operation** — every step, wait, invoke, parallel branch, and map iteration produces its own span with accurate start/end times
- **All operations connected under one root** — a single execution span ties all invocations together; operations that span invocation boundaries still produce a single coherent span

#### Enabling OTel

Install the official adapter alongside the SDK:

```bash
npm install @aws/durable-execution-sdk-js-otel
```

Register it as a plugin — one change to the existing handler:

```typescript
import { withDurableExecution } from '@aws/durable-execution-sdk-js';
import { DurableOtelPlugin, xRayContextExtractor } from '@aws/durable-execution-sdk-js-otel';

// OTel provider setup (once at module level)
const provider = new NodeTracerProvider({ ... });
provider.register({ propagator: new AWSXRayPropagator() });

export const handler = withDurableExecution(myHandler, {
  plugins: [new DurableOtelPlugin({ provider, contextExtractor: xRayContextExtractor })],
});
```

No changes to the handler function itself. No replay guards to write. No OTel boilerplate inside steps.

#### What the Trace Looks Like

For a workflow with a step, a wait, and a parallel block:

```
[execution: order-processor]              T+0s → T+35s   (full wall-clock lifetime)
  ├── [step: validate-order]              T+0s → T+0.3s
  ├── [wait: approval-wait]              T+0.3s → T+30s  (accurate — backfilled from checkpoint)
  └── [parallel: notify]                 T+30s → T+35s
        ├── [step: send-email]           T+30s → T+32s
        └── [step: send-sms]             T+30s → T+31s
```

- **One span per logical operation** — a step that spans multiple Lambda invocations still produces a single span with accurate start and end times
- **Correct hierarchy** — steps nest under the execution span; parallel branches nest under the parallel span
- **No duplicate spans on replay** — the SDK's replay guard ensures hooks only fire for live operations
- **Log correlation** — every `context.logger` line automatically includes `traceId` and `spanId`, linking logs to the corresponding span in the tracing backend

#### Connecting to an Upstream Trace

When the durable function is triggered via API Gateway, the upstream `traceparent` header is automatically picked up and all execution spans appear as children of the caller's trace — giving a single end-to-end trace from the HTTP request through every step.

#### Sampling

```typescript
new DurableOtelPlugin({ provider, samplingRate: 0.1 }); // trace 10% of executions
```

Sampling is execution-level consistent — if an execution is sampled, all its invocations are sampled. No incomplete traces.

---

## Key Decisions

**1. No OTel in the SDK core** — OTel is not a dependency of the SDK. Zero observability dependencies in the bundle.

**2. Plugin model** — The SDK exposes a `DurableInstrumentationPlugin` interface. Users register plugins via `withDurableExecution(handler, { plugins: [...] })`. Multiple plugins can be registered simultaneously. The interface is general-purpose — usable for OTel, Datadog, custom metrics, or any other observability system.

**3. Sampling based on executionArn hash** — Sampling is the plugin's responsibility. The SDK exports a `shouldSampleExecution(executionArn, rate)` helper using a deterministic hash so the same execution is always either fully sampled or fully unsampled across all invocations.

**4. Deterministic spanId for cross-invocation span continuity** — OTel adapter plugins derive `spanId` deterministically from `operationId` using a custom `IdGenerator`. This allows a single span to be exported once when the operation truly completes — with accurate start and end times — rather than being split across invocations.

**5. Configurable context extractor per invocation** — Rather than hardcoding X-Ray extraction, the official OTel adapter accepts a `contextExtractor` function called in `onInvocationStart`. The plugin ships built-in extractors (`xRayContextExtractor`, `w3cClientContextExtractor`) as named exports. This allows customers to use the right extraction mechanism for their trigger type (API Gateway, direct invoke, SQS, etc.) without modifying the plugin.

**6. No backend changes required for basic OTel** — The plugin model works without backend changes for X-Ray and API Gateway triggered executions. One backend bug (`clientContext` not propagated across invocations) should be fixed to support W3C `traceparent` for direct invoke callers.

**7. Official OTel adapter as a separate package** — AWS ships an official OTel adapter as a separate package, not part of the core SDK.

**8. `enrichLogContext` for log-trace correlation** — The plugin interface includes `enrichLogContext(info?: OperationInfo)` which returns key-value pairs injected into every SDK log line. The logger has no OTel dependency — the plugin provides whatever context is relevant.

**9. Container spans — no special treatment in the interface** — `parallel`, `map`, and `runInChildContext` fire `onOperationStart/End` like any other operation. The OTel adapter decides how to handle container spans.

---

## Plan and Sub-Projects

### Sub-project 1: Plugin Interface — TypeScript SDK Core

Add the plugin system to the TypeScript SDK. This is the foundation everything else builds on.

- Define and export `DurableInstrumentationPlugin` interface and all supporting types (`InvocationInfo`, `OperationInfo`, `AttemptInfo`, `ExecutionEndInfo`, `ExecutionSummary`)
- Wire plugin hooks into `with-durable-execution.ts` and all handlers (step, wait, invoke, parallel, map, runInChildContext, waitForCallback, waitForCondition)
- Remove `endAllActiveParentSpans()` from all handlers as part of this wiring
- Implement `enrichLogContext` in the SDK logger
- Export `shouldSampleExecution(executionArn, rate)` sampling helper

**Interface (pseudo-code):**

```typescript
// Registration
withDurableExecution(handler, { plugins: [pluginA, pluginB] })

// Supporting types
interface InvocationInfo   { requestId, executionArn }
interface OperationInfo    { operationId, operationName?, operationType, parentOperationId?, attributes? }
interface AttemptInfo      extends OperationInfo { attempt }
interface AttemptEndInfo   extends AttemptInfo   { outcome: 'succeeded'|'failed'|'retrying', error?, nextAttemptDelaySeconds? }
interface ExecutionEndInfo extends InvocationInfo { status: 'SUCCEEDED'|'FAILED', executionInput, executionResult?, executionError?, getSummary() }
interface ExecutionSummary { durationMs, totalOperations, totalAttempts, failedOperations, retriedOperations, operationsByType }

// Plugin interface — all methods optional
interface DurableInstrumentationPlugin {
  onExecutionStart?(info: InvocationInfo): void
  onExecutionEnd?(info: ExecutionEndInfo): void
  onInvocationStart?(info: InvocationInfo): void
  onInvocationEnd?(info: InvocationInfo): void
  onOperationStart?(info: OperationInfo): void
  onOperationEnd?(info: OperationInfo & { error? }): void
  onOperationAttemptStart?(info: AttemptInfo): void
  onOperationAttemptEnd?(info: AttemptEndInfo): void
  enrichLogContext?(): Record<string, string|number|boolean> | undefined
}

// Sampling helper
shouldSampleExecution(executionArn: string, rate: number): boolean
```

### Sub-project 2: Plugin POC — Validate Key OTel Mechanics

Before building the official adapter, validate the core OTel mechanics against the new plugin interface. This informs the final design of sub-project 3.

- Implement a minimal plugin against the new interface (not based on the exploration POC)
- Validate deterministic `spanId` via custom `IdGenerator`
- Validate sub-span (parent-child) approach for container operations
- Validate span links approach for container operations
- Compare results in X-Ray and decide which approach to use in the official adapter

### Sub-project 3: Official OTel Adapter — TypeScript

A new separate package (`@aws/durable-execution-sdk-js-otel` or similar) implementing the plugin interface with full OTel support.

- Custom `IdGenerator` producing deterministic `spanId` from `operationId` hash
- `DurableOtelPlugin` class implementing `DurableInstrumentationPlugin`
- Configurable `contextExtractor` function called in `onInvocationStart` to extract parent trace context per invocation; built-in extractors (`xRayContextExtractor`, `w3cClientContextExtractor`) exported as named exports
- Span creation per operation type with correct attributes (see `OTEL_SPAN_ATTRIBUTES.md`)
- `enrichLogContext` returning `traceId`/`spanId` from the active span for log correlation
- Sampling via `shouldSampleExecution`
- `forceFlush()` in `onInvocationEnd` to ensure spans are exported before Lambda freezes

### Sub-project 4: Plugin Interface — Python SDK

Mirror of sub-project 1 for `aws-durable-execution-sdk-python`.

- Define `DurableInstrumentationPlugin` as a Python protocol/abstract base class with all supporting dataclasses (`InvocationInfo`, `OperationInfo`, `AttemptInfo`, `ExecutionEndInfo`, `ExecutionSummary`)
- Wire plugin hooks into the Python handler wrapper and all operation handlers (step, wait, invoke, parallel, map, run_in_child_context, wait_for_callback, wait_for_condition)
- Implement `enrich_log_context` in the Python SDK logger
- Export `should_sample_execution(execution_arn, rate)` sampling helper
- Ensure the interface is idiomatic Python (type hints, dataclasses, optional protocol methods)

### Sub-project 5: Official OTel Adapter — Python

A new separate package (`aws-durable-execution-sdk-python-otel` or similar).

- Custom `IdGenerator` equivalent for the Python OTel SDK (`opentelemetry-sdk`)
- `DurableOtelPlugin` class implementing the Python plugin interface
- Span creation per operation type with the same attributes as the TypeScript adapter
- `enrich_log_context` returning `traceId`/`spanId` for log correlation
- Sampling via `should_sample_execution`
- Exporter flush in the invocation end hook

### Sub-project 6: Plugin Interface — Java SDK

Mirror of sub-project 1 for the Java SDK.

- Define `DurableInstrumentationPlugin` as a Java interface with all supporting POJOs/records (`InvocationInfo`, `OperationInfo`, `AttemptInfo`, `ExecutionEndInfo`, `ExecutionSummary`)
- Wire plugin hooks into the Java handler wrapper and all operation handlers
- Implement `enrichLogContext` in the Java SDK logger with MDC (SLF4J/Logback) integration
- Export `shouldSampleExecution(executionArn, rate)` sampling helper
- Ensure the interface is idiomatic Java (default interface methods for optional hooks, builder pattern for info types)

### Sub-project 7: Official OTel Adapter — Java

A new separate package (`aws-durable-execution-sdk-java-otel` or similar).

- Custom `IdGenerator` for the Java OTel SDK (`opentelemetry-sdk-trace`)
- `DurableOtelPlugin` class implementing the Java plugin interface
- Span creation per operation type with the same attributes as the TypeScript adapter
- MDC (SLF4J/Logback) integration in `enrichLogContext` for log-trace correlation
- Sampling via `shouldSampleExecution`
- Exporter flush in the invocation end hook

---

## Operator at Scale

Sub-projects 8 and 9 are part of the **Operator at Scale** project — a separate initiative focused on operational observability for teams running durable executions at scale. This project includes plugins, CDK constructs, console tooling, and other utilities. Sub-projects 8 and 9 build on the plugin interface from sub-project 1 but are tracked and delivered under that project.

### Sub-project 8: Metrics Plugin

A plugin that evaluates developer-defined conditions against durable execution lifecycle events and emits metrics to a configurable destination. Split into two layers to keep the core logic destination-agnostic.

**Layer 1 — Core: `DurableMetricsPlugin` (destination-agnostic)**

Shipped as `@aws/durable-execution-sdk-js-metrics` (or similar). No AWS SDK dependency.

- `DurableMetricsPlugin` class implementing `DurableInstrumentationPlugin`
- Accepts a list of `MetricCondition` rules and a `MetricEmitter` function
- Evaluates conditions at `onOperationAttemptEnd`, `onOperationEnd`, and `onExecutionEnd`
- Collects triggered metric events and flushes them via the emitter in `onInvocationEnd`
- Fire-and-forget — emitter failures never affect execution

```typescript
// Core types
interface MetricEvent {
  name: string;
  value: number;
  unit?: string;
  dimensions?: Record<string, string>;
}

type MetricEmitter = (metrics: MetricEvent[]) => Promise<void>;

interface MetricCondition {
  on: 'onOperationAttemptEnd' | 'onOperationEnd' | 'onExecutionEnd';
  condition: (info: ...) => boolean;
  metric: (info: ...) => MetricEvent;
}

// Usage
new DurableMetricsPlugin({ conditions, emitter: myEmitter })
```

**Layer 2 — Emitters (destination-specific)**

Each emitter is a small function (or thin wrapper) that adapts `MetricEvent[]` to a specific backend. Shipped in destination-specific packages:

- `cloudWatchEmitter(config?)` — in `@aws/durable-execution-sdk-js-cloudwatch`; calls `PutMetricData`, batched per invocation; `@aws-sdk/client-cloudwatch` as peer dependency
- Custom emitters for Datadog, Grafana, StatsD, etc. can be written by users with no SDK changes

```typescript
import { DurableMetricsPlugin } from '@aws/durable-execution-sdk-js-metrics';
import { cloudWatchEmitter } from '@aws/durable-execution-sdk-js-cloudwatch';

new DurableMetricsPlugin({
  emitter: cloudWatchEmitter({ namespace: 'MyApp/DurableExecutions' }),
  conditions: [...],
})
```

See `DURABLE_METRICS_PLUGIN.md` for full design and examples.

### Sub-project 9: Execution Summary Plugin (CloudWatch Logs)

A plugin that writes a structured JSON summary record to CloudWatch Logs at the end of each execution, enabling operators to query and filter executions using CloudWatch Logs Insights.

- `ExecutionSummaryPlugin` class implementing `DurableInstrumentationPlugin`
- Writes one JSON record per execution to stdout (forwarded to CloudWatch Logs by the Lambda runtime — no SDK calls needed)
- Record includes: `executionArn`, `status`, `startTime`, `endTime`, `durationMs`, `totalOperations`, `totalAttempts`, `failedOperations`, `retriedOperations`, `operationsByType`
- Configurable: opt-in `includeInput`, `includeResult`, `includeError` fields
- `transformInput`/`transformResult` callbacks for PII redaction before logging
- `filter` callback to only log executions matching a condition
- `type: 'DURABLE_EXECUTION_SUMMARY'` field for easy Logs Insights filtering
- Can be shipped in the same `@aws/durable-execution-sdk-js-cloudwatch` package as sub-project 8

See `EXECUTION_SUMMARY_PLUGIN.md` for full design, example queries, and implementation.

---

## Related Documents

- `OTEL_GOALS.md` — full goals and design principles
- `OTEL_DECISIONS.md` — full decision rationale
- `INSTRUMENTATION_PLUGIN.md` — plugin interface specification
- `OTEL_BETTER_SOLUTION.md` — deterministic spanId and container span options
- `BACKEND_TRACE_PROPAGATION.md` — W3C traceparent propagation options
- `LAMBDA_OTEL_INITIATIVE.md` — Lambda platform OTel initiative and its impact on this project
- `DURABLE_METRICS_PLUGIN.md` — Metrics plugin design (destination-agnostic core + emitters)
- `EXECUTION_SUMMARY_PLUGIN.md` — Execution Summary plugin design
