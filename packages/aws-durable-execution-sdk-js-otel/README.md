# AWS Durable Execution SDK - OpenTelemetry Plugin

> **⚠️ Experimental Beta:** This plugin is currently in experimental beta. Functionality may change without notice between releases. It is not recommended for production workloads at this time.

OpenTelemetry instrumentation plugin for AWS Durable Execution SDK. Emits distributed traces that correlate across multiple Lambda invocations of a single durable execution, producing deterministic span and trace IDs so that spans from different invocations are stitched into a single coherent trace.

This package provides two plugin implementations:

| Plugin                 | Trace Structure                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `ExecutionOtelPlugin`  | Workflow_Span as synthetic root; operations are siblings of the invocation span       |
| `InvocationOtelPlugin` | Workflow_Span as synthetic root (community collector) or per-invocation traces (ADOT) |

Both plugins share the same configuration interface (`OtelPluginConfig`) and support three TracerProvider modes:

1. **Auto-created** (default) — the plugin creates its own TracerProvider with OTLP export to `localhost:4318`
2. **Custom** — you pass your own `tracerProvider` instance
3. **Global default** — set `useDefaultTracerProvider: true` to use the globally registered provider (e.g., from the ADOT layer)

Both plugins can be deployed with either the **ADOT Lambda layer** or the **OpenTelemetry community collector-only layer**.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Choosing a Plugin](#choosing-a-plugin)
- [Lambda Layer Options](#lambda-layer-options)
- [Deployment Matrix](#deployment-matrix)
- [Shared Configuration](#shared-configuration)
- [Export Strategies](#export-strategies)
- [Collector Configuration](#collector-configuration)
- [IAM Permissions](#iam-permissions)
- [Environment Variables](#environment-variables)
- [SAM/CloudFormation Templates](#samcloudformation-templates)
- [Trace Structure Comparison](#trace-structure-comparison)
- [Additional npm Dependencies](#additional-npm-dependencies)
- [API Reference](#api-reference)
- [Verification](#verification)
- [License](#license)

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel
```

---

## Quick Start

Both plugins are used the same way — only the import and class name differ:

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
// OR: import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const plugin = new ExecutionOtelPlugin();
// OR: const plugin = new InvocationOtelPlugin();

export const handler = withDurableExecution(
  async (event, context) => {
    const result = await context.step("fetch-data", async () => {
      return fetchData(event.id);
    });

    await context.wait("cooldown", { seconds: 5 });

    const processed = await context.step("process", async () => {
      return process(result);
    });

    return processed;
  },
  { plugins: [plugin] },
);
```

With no configuration, both plugins auto-create a TracerProvider with:

- OTLP export to `http://localhost:4318/v1/traces`
- HTTP and AWS SDK instrumentations
- AWSXRay + W3C TraceContext propagators
- Deterministic trace and span ID generation

---

## Choosing a Plugin

| Aspect                   | `ExecutionOtelPlugin`                    | `InvocationOtelPlugin`                                                  |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Trace root               | Workflow_Span (synthetic, deterministic) | Workflow_Span (community collector) or ADOT invocation span             |
| Operation parent         | Workflow_Span                            | Invocation span (community collector) or ADOT invocation span           |
| Invocation span role     | Sibling with span links                  | Parent of operations (community collector) or delegated to ADOT         |
| Export timing            | Operations deferred until complete       | All spans exported immediately                                          |
| Non-terminal invocations | Workflow_Span discarded (clean traces)   | Workflow_Span discarded (community collector); all spans emitted (ADOT) |
| Trace continuity         | Single trace across all invocations      | Single trace (community collector) or per-invocation with links (ADOT)  |

**Use `ExecutionOtelPlugin` when** you want a single unified trace view across all invocations of a durable execution, with the workflow as the logical root.

**Use `InvocationOtelPlugin` when** you want a lighter-weight plugin that still produces a unified Workflow trace with the community collector, or delegates entirely to the ADOT layer's auto-instrumentation when `useDefaultTracerProvider: true`.

---

## Lambda Layer Options

Both plugins can use either Lambda layer. The layer provides span transport (a collector that listens on `localhost:4318` and forwards to X-Ray/CloudWatch).

| Layer                              | What It Provides                                       | ARN Format                                                                                  |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **ADOT Lambda Layer**              | OTel SDK auto-instrumentation + collector extension    | `arn:aws:lambda:{region}:615299751070:layer:AWSOpenTelemetryDistroJs:{version}`             |
| **Community Collector-Only Layer** | Collector extension only (no SDK auto-instrumentation) | `arn:aws:lambda:{region}:184161586896:layer:opentelemetry-nodejs-{version}:{layer-version}` |

**ADOT Layer:** Registers a global TracerProvider with auto-instrumentation. Use `useDefaultTracerProvider: true` so the plugin delegates to that provider. Set `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument` to activate it.

**Community Collector Layer:** Only runs a collector process at `localhost:4318`. The plugin creates its own TracerProvider (default mode) and exports spans to the collector. Requires a `collector.yaml` in your function bundle and `OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml`.

> **Tip:** The community collector layer is smaller and purpose-built for span transport. The ADOT layer is convenient if you want zero-config auto-instrumentation from the layer itself.

---

## Deployment Matrix

| #   | Plugin                 | Layer                     | `useDefaultTracerProvider` | `AWS_LAMBDA_EXEC_WRAPPER` | `collector.yaml` needed? |
| --- | ---------------------- | ------------------------- | -------------------------- | ------------------------- | ------------------------ |
| 1   | `ExecutionOtelPlugin`  | ADOT Layer                | `true`                     | `/opt/otel-instrument`    | No                       |
| 2   | `ExecutionOtelPlugin`  | Community Collector Layer | `false` (default)          | Do NOT set                | Yes                      |
| 3   | `InvocationOtelPlugin` | ADOT Layer                | `true`                     | `/opt/otel-instrument`    | No                       |
| 4   | `InvocationOtelPlugin` | Community Collector Layer | `false` (default)          | Do NOT set                | Yes                      |

### 1. ExecutionOtelPlugin + ADOT Layer

The ADOT layer provides both the collector and a global TracerProvider. The plugin uses the global provider and produces a Workflow_Span as the trace root.

**Handler code:**

```typescript
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
const plugin = new ExecutionOtelPlugin({ useDefaultTracerProvider: true });
```

**SAM template:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:7
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    Tracing: Active
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
    AutoPublishAlias: live
```

### 2. ExecutionOtelPlugin + Community Collector Layer

The plugin creates its own TracerProvider and exports spans to the collector on `localhost:4318`. Produces a Workflow_Span as the trace root.

**Handler code:**

```typescript
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
const plugin = new ExecutionOtelPlugin();
```

**SAM template:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-nodejs-0_22_0:1
    Environment:
      Variables:
        OPENTELEMETRY_COLLECTOR_CONFIG_URI: /var/task/collector.yaml
    Tracing: Active
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
    AutoPublishAlias: live
```

### 3. InvocationOtelPlugin + ADOT Layer

The ADOT layer provides both the collector and a global TracerProvider. The plugin uses the global provider and delegates all span creation to the ADOT layer — no Workflow or Invocation spans are created by the plugin itself. Operations are attached to the ADOT layer's invocation span.

**Handler code:**

```typescript
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });
```

**SAM template:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:615299751070:layer:AWSOpenTelemetryDistroJs:7
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    Tracing: Active
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
    AutoPublishAlias: live
```

### 4. InvocationOtelPlugin + Community Collector Layer

The plugin creates its own TracerProvider and exports spans to the collector on `localhost:4318`. Produces a Workflow_Span as the synthetic trace root (with a deterministic ID derived from the execution ARN) and an Invocation span as its child. The Workflow_Span is only exported on terminal status (SUCCEEDED/FAILED), ensuring clean traces without incomplete workflow spans from intermediate invocations.

**Handler code:**

```typescript
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
const plugin = new InvocationOtelPlugin();
```

**SAM template:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-nodejs-0_22_0:1
    Environment:
      Variables:
        OPENTELEMETRY_COLLECTOR_CONFIG_URI: /var/task/collector.yaml
    Tracing: Active
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
    AutoPublishAlias: live
```

### Which Combination Should I Use?

| Scenario                                               | Recommendation                                        |
| ------------------------------------------------------ | ----------------------------------------------------- |
| New deployment, want unified trace per execution       | ExecutionOtelPlugin + Community Collector (option 2)  |
| New deployment, want per-invocation traces             | InvocationOtelPlugin + Community Collector (option 4) |
| Already have ADOT layer, want unified execution traces | ExecutionOtelPlugin + ADOT Layer (option 1)           |
| Already have ADOT layer, want per-invocation traces    | InvocationOtelPlugin + ADOT Layer (option 3)          |
| Want smallest layer size                               | Community Collector (collector-only, no bundled SDK)  |
| Want zero-config auto-instrumentation from ADOT        | ADOT Layer with `useDefaultTracerProvider: true`      |

---

## Shared Configuration

Both plugins accept the same `OtelPluginConfig` interface:

```typescript
interface OtelPluginConfig {
  /** Custom TracerProvider. Skips all auto-setup when provided. */
  tracerProvider?: TracerProvider;

  /** Use the globally registered TracerProvider (e.g., from ADOT). Defaults to false. */
  useDefaultTracerProvider?: boolean;

  /** Context extractor for upstream trace context. Defaults to xRayContextExtractor. */
  contextExtractor?: ContextExtractor;

  /** Instrumentation scope name. Defaults to "aws-durable-execution-sdk-js". */
  instrumentationName?: string;

  /** Whether to register HTTP instrumentation. Defaults to true. */
  enableHttpInstrumentation?: boolean;

  /** OTLP exporter config. Only used when auto-creating TracerProvider. */
  exporterConfig?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };

  /** Custom propagators. Replaces default [AWSXRay, W3CTraceContext]. */
  propagators?: TextMapPropagator[];

  /** Custom Workflow span name. Defaults to "Workflow". */
  workflowSpanName?: string;
}
```

**TracerProvider precedence:** explicit `tracerProvider` > `useDefaultTracerProvider: true` > auto-created.

**Usage examples:**

```typescript
// Zero-config (auto-creates TracerProvider with OTLP export)
const plugin = new ExecutionOtelPlugin();

// Use the ADOT layer's globally registered TracerProvider
const plugin = new InvocationOtelPlugin({ useDefaultTracerProvider: true });

// Custom endpoint and headers (third-party vendor)
const plugin = new ExecutionOtelPlugin({
  exporterConfig: {
    endpoint: "https://api.honeycomb.io/v1/traces",
    headers: { "x-honeycomb-team": process.env.HONEYCOMB_API_KEY! },
  },
});

// Bring your own TracerProvider
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
const provider = new NodeTracerProvider({
  /* your config */
});
const plugin = new InvocationOtelPlugin({ tracerProvider: provider });
```

---

## Export Strategies

When the plugin auto-creates its TracerProvider (default mode), you can configure where spans go:

### Via a Collector Layer (Recommended)

```
Lambda → OTLP (localhost:4318) → Collector Extension → X-Ray/CloudWatch
```

No code changes needed — auto-created providers target `localhost:4318` by default.

### Direct to CloudWatch OTLP Endpoint

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://xray.us-east-1.amazonaws.com/v1/traces
```

> **Note:** Direct export requires SigV4 signed requests.

### Via Third-Party OTLP Endpoint

```typescript
const plugin = new ExecutionOtelPlugin({
  exporterConfig: {
    endpoint: "https://api.honeycomb.io/v1/traces",
    headers: { "x-honeycomb-team": process.env.HONEYCOMB_API_KEY! },
  },
});
```

Or via environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io/v1/traces
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
```

---

## Collector Configuration

When using the community collector-only layer, include a `collector.yaml` in your function bundle:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: "localhost:4318"

exporters:
  awsxray:
    region: "${AWS_REGION}"

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [awsxray]
```

Set the environment variable:

```bash
OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
```

### Why Use a Collector?

Using the community collector-only layer allows you to export traces directly to third-party observability platforms (such as Datadog, Honeycomb, or Grafana) without needing to first send them to AWS and then re-export from CloudWatch or X-Ray.

---

## IAM Permissions

### Via Collector Layer (ADOT or Community)

The function's execution role needs X-Ray write permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      "Resource": "*"
    }
  ]
}
```

Or attach: `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess`

### Via Third-Party Endpoint

No AWS IAM permissions required. Authentication is handled via headers in `OTEL_EXPORTER_OTLP_HEADERS` or `exporterConfig.headers`.

---

## Environment Variables

| Variable                             | Description                                                                                                                       | Default                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | OTLP exporter endpoint URL                                                                                                        | `http://localhost:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_HEADERS`         | Comma-separated key=value headers for the exporter                                                                                | —                                 |
| `OTEL_DURABLE_SAMPLING_RATIO`        | Trace-ID-based probabilistic sampling ratio (0.0 to 1.0). All invocations of the same execution are sampled/dropped consistently. | `1.0` (all traces sampled)        |
| `AWS_LAMBDA_EXEC_WRAPPER`            | Set to `/opt/otel-instrument` to activate the ADOT layer's auto-instrumentation                                                   | —                                 |
| `OPENTELEMETRY_COLLECTOR_CONFIG_URI` | Path to `collector.yaml` for the community collector layer                                                                        | —                                 |
| `AWS_LAMBDA_FUNCTION_NAME`           | Set by the Lambda runtime. Used to detect Lambda environment and populate resource attributes.                                    | —                                 |
| `AWS_REGION`                         | Set by the Lambda runtime. Used for resource attributes and collector configuration.                                              | —                                 |
| `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`    | Set by the Lambda runtime. Populates the `faas.max_memory` span attribute (in MB).                                                | —                                 |

---

## SAM/CloudFormation Templates

See the [Deployment Matrix](#deployment-matrix) section for plugin-specific templates with both layer options. Below are additional templates for alternative export targets.

### Direct to CloudWatch (No Layer)

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Environment:
      Variables:
        OTEL_EXPORTER_OTLP_ENDPOINT: !Sub "https://xray.${AWS::Region}.amazonaws.com/v1/traces"
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
    AutoPublishAlias: live
```

### Third-Party OTLP Endpoint

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs22.x
    Handler: index.handler
    CodeUri: ./src
    DurableConfig:
      ExecutionTimeout: 3600
      RetentionPeriodInDays: 7
    Layers:
      # Optional: collector layer for reliability (retry/buffering)
      - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-nodejs-0_22_0:1
    Environment:
      Variables:
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io/v1/traces"
        OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=YOUR_API_KEY"
    Policies:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
    AutoPublishAlias: live
```

---

## Trace Structure Comparison

### ExecutionOtelPlugin

Produces a hierarchical trace with Workflow_Span as the synthetic root:

```
Workflow_Span (deterministic ID from execution ARN, exported on terminal status only)
├── Invocation_Span (one per Lambda invocation, always exported)
├── Operation_Span: "fetch-data" (STEP)
│   ├── Attempt_Span: "fetch-data attempt 1"
│   │   └── HTTP Span: GET https://api.example.com/data
│   └── [link → Invocation_Span]
├── Operation_Span: "cooldown" (WAIT)
│   └── [link → Invocation_Span]
└── Operation_Span: "process-order" (CONTEXT)
    ├── (nested operations from child context)
    ├── HTTP Span: POST https://api.example.com/orders
    └── [link → Invocation_Span]
```

> When `useDefaultTracerProvider: true`, the plugin does not create its own Invocation_Span. Instead, it links to the ambient invocation span from the ADOT layer's context.

### InvocationOtelPlugin

Produces a per-invocation trace with the invocation span as root:

```
Workflow_Span (deterministic ID from execution ARN, exported on terminal status only — community collector mode)
├── Invocation_Span (one per Lambda invocation)
│   ├── Operation_Span: "fetch-data" (STEP)
│   │   ├── Attempt_Span: "fetch-data attempt 1"
│   │   │   └── HTTP Span: GET https://api.example.com/data
│   │   └── [link → deterministic span ID]
│   ├── Operation_Span: "cooldown" (WAIT)
│   └── Operation_Span: "process-order" (CONTEXT)
│       ├── (nested operations from child context)
│       └── HTTP Span: POST https://api.example.com/orders
└── [attributes: durable.execution.arn, durable.execution.status]
```

> When `useDefaultTracerProvider: true` (ADOT mode), neither the Workflow_Span nor the Invocation_Span is created by the plugin. Operations are attached to the ADOT layer's ambient invocation span instead.

Cross-invocation operations are correlated via span links to deterministic span IDs.

### Span Attributes

- **Workflow_Span**: `durable.execution.arn`, `durable.execution.status`
- **Invocation_Span**: `faas.invocation_id`, `faas.coldstart`, `cloud.resource_id`, `cloud.provider`, `cloud.platform`, `faas.max_memory`, `durable.execution.arn`, `durable.invocation.first`, `durable.invocation.status`
- **Operation_Span**: `durable.execution.arn`, `durable.operation.id`, `durable.operation.type`, `durable.operation.name`, `durable.operation.subtype`, `durable.operation.status`, `durable.attempt.number`
- **Attempt_Span**: all operation attributes plus `durable.attempt.number`, `durable.attempt.outcome`

### Span Status

The **Workflow_Span** OTel status is derived from the terminal `PluginInvocationStatus`:

| `PluginInvocationStatus` | Workflow_Span status |
| ------------------------ | -------------------- |
| `SUCCEEDED`              | `OK`                 |
| `FAILED`                 | `ERROR` (with the execution error message) |
| `PENDING`                | `UNSET` (span not ended/exported) |
| `RETRYING`               | `UNSET` (span not ended/exported) |

For non-terminal outcomes (`PENDING`/`RETRYING`) the Workflow_Span is intentionally left un-ended, so it is never exported and its status stays `UNSET`.

> **Note:** the OTel plugin does **not** know whether a failed workflow was `TIMED_OUT` or `STOPPED`. `PluginInvocationStatus` — the only status the plugin receives at `onInvocationEnd` — distinguishes just `SUCCEEDED`/`FAILED`/`PENDING`/`RETRYING`. `TIMED_OUT` and `STOPPED` are operation-level states (`PluginOperationStatus`) and are not surfaced at the invocation/workflow level, so any such outcome is reported as `FAILED` → span status `ERROR`.

The **Invocation_Span** follows the same mapping (`FAILED` → `ERROR`, otherwise `UNSET`) and additionally records the raw value in the `durable.invocation.status` attribute.

---

## Additional npm Dependencies

When the plugin auto-creates its TracerProvider (default mode), these peer dependencies are required:

```bash
npm install @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/propagator-aws-xray \
            @opentelemetry/instrumentation-http \
            @opentelemetry/resources \
            @opentelemetry/sdk-trace-node
```

| Package                                   | Role                                           | Required?                                            |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP span export over HTTP                     | Only when auto-creating TracerProvider               |
| `@opentelemetry/propagator-aws-xray`      | X-Ray context propagation on outgoing requests | Required                                             |
| `@opentelemetry/instrumentation-http`     | Auto-instrument outgoing HTTP calls            | Required (unless `enableHttpInstrumentation: false`) |
| `@opentelemetry/resources`                | Lambda resource detection                      | Required                                             |
| `@opentelemetry/sdk-trace-node`           | TracerProvider, SpanProcessor, Sampler         | Required                                             |
| `@opentelemetry/api`                      | Core OTel API types                            | Required (already a peer dep)                        |
| `@opentelemetry/core`                     | Propagators, samplers                          | Required (already a peer dep)                        |
| `@opentelemetry/instrumentation-aws-sdk`  | Auto-instrument AWS SDK calls                  | Required (already a peer dep)                        |

When using `useDefaultTracerProvider: true` (ADOT layer mode), the ADOT layer provides all OTel dependencies — you only need `@opentelemetry/api` in your package.

---

## API Reference

### `ExecutionOtelPlugin`

Plugin that produces a Workflow_Span as the synthetic trace root. Implements `DurableInstrumentationPlugin`.

```typescript
new ExecutionOtelPlugin(config?: OtelPluginConfig)
```

### `InvocationOtelPlugin`

Plugin that produces an invocation span as the trace root. Implements `DurableInstrumentationPlugin`.

```typescript
new InvocationOtelPlugin(config?: OtelPluginConfig)
```

### `DeterministicIdGenerator`

Custom OpenTelemetry `IdGenerator` that produces reproducible trace and span IDs from execution metadata.

### `deriveWorkflowSpanId(executionArn: string): string`

Derives a deterministic 16-character hex span ID from an execution ARN.

### `xRayContextExtractor`

Default context extractor. Reads the `_X_AMZN_TRACE_ID` environment variable to derive trace context.

### `w3cClientContextExtractor`

Alternative context extractor. Reads `traceparent` from `context.clientContext.custom.traceparent`.

### `ContextExtractor`

Type definition for custom context extractor functions:

```typescript
type ContextExtractor = (
  info: InvocationInfo,
) => ContextExtractorResult | undefined;
```

---

## Verification

> **Important:** When using the community collector layer, you must enable **CloudWatch Transaction Search** in your AWS account for traces to be visible in X-Ray. Navigate to CloudWatch → Settings → Traces and Logs and turn on Transaction Search.

After deploying with either plugin and either layer:

1. **Invoke your durable function** — trigger an execution with multiple steps or a wait/resume cycle.
2. **Check CloudWatch console** — Navigate to CloudWatch → Traces. You should see spans grouped under one trace ID.
3. **Check log correlation** — If using `enrichLogContext()`, verify logs include `traceId` and `spanId`.
4. **Confirm sampling** — Set `OTEL_DURABLE_SAMPLING_RATIO` below 1.0 and verify only the expected proportion of traces appear.

### Troubleshooting

| Symptom                         | Likely Cause                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| No traces appear                | Collector layer not attached, or config env var not set                                                                                      |
| No traces with ADOT layer       | `AWS_LAMBDA_EXEC_WRAPPER` not set (when using `useDefaultTracerProvider: true`)                                                              |
| Traces fragmented across IDs    | X-Ray active tracing not enabled on the function                                                                                             |
| Missing operation spans         | Sampling ratio set below 1.0                                                                                                                 |
| Collector layer errors          | Check `collector.yaml` is in the function bundle at the path specified                                                                       |
| Duplicate spans with ADOT layer | `AWS_LAMBDA_EXEC_WRAPPER` is set but `useDefaultTracerProvider` is false — either remove the env var or set `useDefaultTracerProvider: true` |

## License

Apache-2.0
