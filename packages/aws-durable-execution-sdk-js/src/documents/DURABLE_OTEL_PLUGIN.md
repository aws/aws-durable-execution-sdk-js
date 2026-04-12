# Durable Execution OTel Plugin (TypeScript)

## Overview

`@aws/durable-execution-sdk-js-otel` is the official OpenTelemetry adapter plugin for the AWS Durable Execution SDK. It implements the `DurableInstrumentationPlugin` interface and produces OTel spans for every durable operation.

The plugin is a separate package from the SDK core. The SDK has zero OTel dependencies.

---

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel
npm install --save-peer @opentelemetry/api @opentelemetry/sdk-trace-node
```

---

## Quick Start

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  DurableOtelPlugin,
  xRayContextExtractor,
} from "@aws/durable-execution-sdk-js-otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { credentials } from "@grpc/grpc-js";

const provider = new NodeTracerProvider({
  idGenerator: new AWSXRayIdGenerator(),
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: "http://localhost:4317",
        credentials: credentials.createInsecure(),
      }),
    ),
  ],
});
provider.register({ propagator: new AWSXRayPropagator() });

export const handler = withDurableExecution(myHandler, {
  plugins: [
    new DurableOtelPlugin({
      provider,
      contextExtractor: xRayContextExtractor,
    }),
  ],
});
```

---

## Configuration

```typescript
interface DurableOtelPluginConfig {
  provider?: TracerProvider;
  contextExtractor?: ContextExtractor;
  samplingRate?: number; // 0.0–1.0, default 1.0
  instrumentationName?: string; // default: 'aws-durable-execution-sdk-js'
}

type ContextExtractor = (info: InvocationInfo) => Context;
```

### Built-in Context Extractors

```typescript
import {
  xRayContextExtractor, // reads _X_AMZN_TRACE_ID (default)
  w3cClientContextExtractor, // reads clientContext.custom.traceparent
} from "@aws/durable-execution-sdk-js-otel";
```

**`xRayContextExtractor`** — reads `_X_AMZN_TRACE_ID` from the environment. The durable execution backend propagates the same `Root` trace ID to every invocation, so all invocations share one `traceId`.

**`w3cClientContextExtractor`** — reads `traceparent` from `context.clientContext.custom.traceparent`. Requires the backend `clientContext` propagation bug to be fixed.

---

## Span Structure

```
[invocation]                          one per Lambda invocation
  ├── [step: fetch-data]              one per operation, regardless of retries
  │     └── [attempt 1]              one per attempt — shows retry history
  ├── [wait: approval-wait]          accurate start/end times from checkpoint
  └── [parallel: notify]
        ├── [step: email]
        └── [step: sms]
```

**One span per logical operation, not per invocation.** The span's `startTime` is backfilled from `Operation.StartTimestamp` stored in the checkpoint, and it is exported exactly once when the operation completes.

**Deterministic `spanId`.** The plugin derives `spanId` from a hash of `operationId`. The same span ID is used on every Lambda invocation for the same operation. The span is only exported once — on completion — so there are no duplicates.

---

## Span Attributes

| Attribute                 | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `durable.execution.arn`   | Full execution ARN                                                                                             |
| `durable.operation.id`    | Stable operation ID                                                                                            |
| `durable.operation.type`  | `step` / `wait` / `invoke` / `parallel` / `map` / `child-context` / `wait-for-callback` / `wait-for-condition` |
| `durable.operation.name`  | User-provided name (e.g. `"fetch-data"`)                                                                       |
| `durable.attempt.number`  | Attempt number (attempt spans only)                                                                            |
| `durable.attempt.outcome` | `succeeded` / `failed` / `retrying` (attempt spans only)                                                       |

---

## Log Correlation

The plugin implements `enrichLogContext` to inject `traceId` and `spanId` into every SDK log line:

```typescript
enrichLogContext() {
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return undefined;
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
```

---

## Sampling

```typescript
new DurableOtelPlugin({ provider, samplingRate: 0.1 }); // trace 10% of executions
```

Sampling is execution-level consistent — the same execution always produces the same sampling decision on every invocation via `shouldSampleExecution(executionArn, rate)`.

---

## Flushing Before Lambda Freeze

The plugin calls `provider.forceFlush()` in `onInvocationEnd` to drain the exporter's queue before Lambda freezes. This is why `SimpleSpanProcessor` is recommended over `BatchSpanProcessor` for Lambda.

---

## Peer Dependencies

| Package                                | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `@opentelemetry/api`                   | OTel API — span creation, context propagation |
| `@opentelemetry/sdk-trace-node`        | OTel SDK — TracerProvider, SpanProcessor      |
| `@opentelemetry/id-generator-aws-xray` | X-Ray-compatible trace ID format              |
| `@opentelemetry/propagator-aws-xray`   | X-Ray header format extraction/injection      |

---

## Related Documents

- `INSTRUMENTATION_PLUGIN.md` — plugin interface specification
- `OTEL_BETTER_SOLUTION.md` — why deterministic spanId
- `OTEL_SPAN_ATTRIBUTES.md` — full span attribute reference
- `OTEL_XRAY_SETUP.md` — POC setup guide and lessons learned
- `BACKEND_TRACE_PROPAGATION.md` — W3C traceparent propagation options
