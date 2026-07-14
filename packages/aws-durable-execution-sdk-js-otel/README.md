# AWS Durable Execution SDK - OpenTelemetry Plugin

> **⚠️ Experimental Beta:** This plugin is currently in experimental beta. Functionality may change without notice between releases. It is not recommended for production workloads at this time.

OpenTelemetry instrumentation plugin for AWS Durable Execution SDK. Emits distributed traces that correlate across multiple Lambda invocations of a single durable execution, producing deterministic span and trace IDs so that spans from different invocations are stitched into a single coherent trace.

This package provides two plugin implementations:

| Plugin                 | Use Case                                                                              | Infrastructure Required                               |
| ---------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `InvocationOtelPlugin` | Lightweight — delegates auto-instrumentation and export to the full ADOT Lambda layer | ADOT Lambda layer with `AWS_LAMBDA_EXEC_WRAPPER`      |
| `ExecutionOtelPlugin`  | Self-contained — manages its own TracerProvider, instrumentations, and OTLP export    | Collector-only Lambda layer (no auto-instrumentation) |

## Table of Contents

- [Installation](#installation)
- [ExecutionOtelPlugin](#standaloneoetlplugin)
  - [Minimal Handler Setup](#minimal-handler-setup)
  - [Export Strategies](#export-strategies)
  - [Collector Layer Setup](#collector-layer-setup)
  - [Why a Collector Layer Is Required](#why-a-collector-layer-is-required)
  - [Sample collector.yaml](#sample-collectoryaml)
  - [IAM Permissions](#iam-permissions)
  - [Environment Variables](#environment-variables)
  - [SAM/CloudFormation Templates](#samcloudformation-templates)
  - [ExecutionOtelPluginConfig Interface](#standaloneoetlpluginconfig-interface)
  - [Trace Structure](#trace-structure)
  - [Additional npm Dependencies](#additional-npm-dependencies)
  - [Migration from InvocationOtelPlugin](#migration-from-otelplugin)
- [InvocationOtelPlugin (ADOT Layer)](#otelplugin-adot-layer)
- [API Reference](#api-reference)
- [License](#license)

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel
```

---

## ExecutionOtelPlugin

`ExecutionOtelPlugin` is a self-contained OpenTelemetry instrumentation plugin that provides full distributed tracing without requiring the ADOT Lambda layer's auto-instrumentation. It creates and manages its own TracerProvider, registers HTTP and AWS SDK instrumentations, configures X-Ray and W3C propagators, and exports spans via OTLP — all with zero-config defaults.

You only need a **collector-only Lambda layer** (or equivalent OTLP endpoint) for span transport.

### Minimal Handler Setup

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const plugin = new ExecutionOtelPlugin();

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

No additional configuration is required. The plugin auto-configures:

- A `TracerProvider` with OTLP export to `http://localhost:4318/v1/traces`
- HTTP and AWS SDK instrumentations
- AWSXRay + W3C TraceContext propagators
- Deterministic trace and span ID generation

### Export Strategies

Choose the export strategy that matches your infrastructure:

#### Recommended: Via a Collector-Only Lambda Layer

Export spans to `localhost:4318` where the collector extension forwards them to X-Ray/CloudWatch.

```
Lambda → OTLP (localhost:4318) → Collector Extension → X-Ray/CloudWatch
```

**Why this is recommended:**

- No SigV4 signing complexity in your application code
- The collector handles batching, retry, and buffering during Lambda freeze/thaw cycles
- Well-tested, production-proven path
- Supports multi-destination fan-out via collector configuration

No code changes needed — `new ExecutionOtelPlugin()` targets `localhost:4318` by default.

#### Direct to CloudWatch OTLP Endpoint

Export spans directly to the CloudWatch OTLP endpoint without a collector layer.

```
Lambda → OTLP (https://xray.{region}.amazonaws.com/v1/traces) → X-Ray/CloudWatch
```

Use this when minimizing Lambda layers is a priority. Requires SigV4 authentication on the OTLP requests.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://xray.us-east-1.amazonaws.com/v1/traces
```

> **Note:** Direct export requires SigV4 signed requests. You may need a custom exporter or middleware to handle authentication.

#### Via Third-Party OTLP Endpoint

Export to Datadog, Honeycomb, Grafana Cloud, or any OTLP-compatible vendor.

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

Can be combined with a collector layer for additional reliability (retry, buffering).

### Collector Layer Setup

#### Option A (Recommended): OpenTelemetry Community Collector-Only Layer

A lightweight, purpose-built collector layer from the OpenTelemetry Lambda project.

**Step 1.** Find the latest collector layer ARN for your region and architecture from:
https://github.com/open-telemetry/opentelemetry-lambda/releases

The ARN follows the format:

```
arn:aws:lambda:{region}:184161586896:layer:opentelemetry-collector-{arch}-{version}:{layer-version}
```

**Step 2.** Attach the layer to your Lambda function.

**Step 3.** Add a `collector.yaml` to your function bundle (see [Sample collector.yaml](#sample-collectoryaml) below).

**Step 4.** Set the collector config URI environment variable:

```bash
OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
```

**Step 5.** Do **NOT** set `AWS_LAMBDA_EXEC_WRAPPER`. The ExecutionOtelPlugin handles all instrumentation — the collector layer only transports spans.

**Step 6.** Deploy and verify traces appear in X-Ray/CloudWatch.

#### Option B: Legacy ADOT Lambda Layer

The full ADOT Lambda layer includes both a collector and SDK auto-instrumentation. When used with ExecutionOtelPlugin, only the collector component is utilized.

**Step 1.** Find the ADOT Node.js layer ARN:

```
arn:aws:lambda:{region}:901920570463:layer:aws-otel-nodejs-{arch}-ver-1-30-2:1
```

**Step 2.** Attach the layer to your Lambda function.

**Step 3.** Do **NOT** set `AWS_LAMBDA_EXEC_WRAPPER`. This disables the ADOT SDK auto-instrumentation while the collector extension still runs and listens on `localhost:4318`.

**Step 4.** Deploy and verify traces appear in X-Ray/CloudWatch.

> **Tip:** Option A is preferred for new deployments because it's smaller (collector-only, no bundled SDK) and purpose-built for this use case.

### Why a Collector Layer Is Required

The collector handles several concerns that are impractical to solve in application code:

- **Batching** — aggregates spans into efficient export batches
- **Retry with backoff** — handles transient export failures without blocking your function
- **Buffering during Lambda freeze/thaw** — the collector extension remains active during freeze cycles, draining buffered spans
- **Protocol translation** — converts OTLP format to X-Ray segment format
- **No SigV4 in your code** — the collector handles AWS authentication for X-Ray export

Without a collector, your application would need to handle all of these concerns directly, adding complexity and latency to every invocation.

### Sample collector.yaml

Include this file in your function bundle (e.g., at the project root so it's packaged as `/var/task/collector.yaml`):

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

Set the environment variable to point to this file:

```bash
OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
```

### IAM Permissions

#### Via Collector Layer (Recommended)

When using a collector layer, the **function's execution role** needs X-Ray write permissions (the collector uses the function's role):

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

Or attach the managed policy: `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess`

#### Direct to CloudWatch OTLP Endpoint

When exporting directly to `https://xray.{region}.amazonaws.com/v1/traces`:

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

The function's execution role must also be configured with SigV4 signing credentials for the OTLP requests.

#### Via Third-Party Endpoint

No AWS IAM permissions are required for third-party export. Authentication is handled via headers (API keys) set in `OTEL_EXPORTER_OTLP_HEADERS` or the `exporterConfig.headers` option.

### Environment Variables

| Variable                          | Description                                                                                                                       | Default                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | OTLP exporter endpoint URL                                                                                                        | `http://localhost:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_HEADERS`      | Comma-separated key=value headers for the exporter (e.g., `x-api-key=abc123`)                                                     | —                                 |
| `OTEL_DURABLE_SAMPLING_RATIO`     | Trace-ID-based probabilistic sampling ratio (0.0 to 1.0). All invocations of the same execution are sampled/dropped consistently. | `1.0` (all traces sampled)        |
| `AWS_LAMBDA_FUNCTION_NAME`        | Set by the Lambda runtime. Used to detect Lambda environment and populate resource attributes.                                    | —                                 |
| `AWS_REGION`                      | Set by the Lambda runtime. Used for resource attributes and collector configuration.                                              | —                                 |
| `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` | Set by the Lambda runtime. Populates the `faas.max_memory` span attribute (in MB).                                                | —                                 |

### SAM/CloudFormation Templates

#### Recommended: Collector-Only Layer

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Resources:
  MyDurableFunction:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs22.x
      Handler: index.handler
      CodeUri: ./src
      MemorySize: 512
      DurableConfig:
        ExecutionTimeout: 3600
        RetentionPeriodInDays: 7
      Layers:
        # OpenTelemetry community collector-only layer (check latest version)
        - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-collector-arm64-0_14_0:1
      Environment:
        Variables:
          OPENTELEMETRY_COLLECTOR_CONFIG_URI: /var/task/collector.yaml
      Policies:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
        - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
      AutoPublishAlias: live
```

#### Direct to CloudWatch (No Collector Layer)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Resources:
  MyDurableFunction:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs22.x
      Handler: index.handler
      CodeUri: ./src
      MemorySize: 512
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

#### Third-Party OTLP Endpoint

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Resources:
  MyDurableFunction:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs22.x
      Handler: index.handler
      CodeUri: ./src
      MemorySize: 512
      DurableConfig:
        ExecutionTimeout: 3600
        RetentionPeriodInDays: 7
      Layers:
        # Optional: collector layer for reliability (retry/buffering)
        - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-collector-arm64-0_14_0:1
      Environment:
        Variables:
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io/v1/traces"
          OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=YOUR_API_KEY"
      Policies:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      AutoPublishAlias: live
```

### ExecutionOtelPluginConfig Interface

All configuration options are optional. When no config is provided, the plugin auto-configures a fully working setup.

```typescript
interface ExecutionOtelPluginConfig {
  /**
   * Custom TracerProvider. When provided, the plugin skips all auto-setup
   * (no exporter, no propagators, no instrumentations are registered).
   * The caller is responsible for configuring the provider.
   */
  tracerProvider?: TracerProvider;

  /**
   * Context extractor function used to extract upstream trace context
   * from the invocation environment. Defaults to `xRayContextExtractor`.
   */
  contextExtractor?: ContextExtractor;

  /**
   * Instrumentation scope name used when creating tracers.
   * Defaults to "aws-durable-execution-sdk-js".
   */
  instrumentationName?: string;

  /**
   * Whether to register @opentelemetry/instrumentation-http.
   * Defaults to true. Set to false to skip HTTP instrumentation.
   * AWS SDK instrumentation is always registered unless a custom
   * tracerProvider is provided.
   */
  enableHttpInstrumentation?: boolean;

  /**
   * OTLP exporter configuration. Only used when no custom tracerProvider
   * is provided.
   */
  exporterConfig?: {
    /** Exporter endpoint URL. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT
     *  env var or http://localhost:4318/v1/traces. */
    endpoint?: string;
    /** Custom headers sent with each export request. */
    headers?: Record<string, string>;
  };

  /**
   * Custom propagators. When provided, replaces the default composite
   * propagator [AWSXRayPropagator, W3CTraceContextPropagator].
   */
  propagators?: TextMapPropagator[];
}
```

**Usage examples:**

```typescript
// Zero-config (recommended starting point)
const plugin = new ExecutionOtelPlugin();

// Disable HTTP instrumentation
const plugin = new ExecutionOtelPlugin({
  enableHttpInstrumentation: false,
});

// Custom endpoint and headers
const plugin = new ExecutionOtelPlugin({
  exporterConfig: {
    endpoint: "https://otel-collector.internal:4318/v1/traces",
    headers: { Authorization: "Bearer token123" },
  },
});

// Bring your own TracerProvider (advanced)
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const provider = new NodeTracerProvider({
  /* your config */
});
const plugin = new ExecutionOtelPlugin({ tracerProvider: provider });
```

### Trace Structure

The ExecutionOtelPlugin produces a hierarchical trace structure with the Workflow_Span as the synthetic root:

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
    ├── Context_Execution_Span: "process-order execution 1"
    │   ├── (nested operations from child context)
    │   └── HTTP Span: POST https://api.example.com/orders
    ├── Context_Execution_Span: "process-order execution 2"
    └── [link → Invocation_Span]
```

**Key differences from InvocationOtelPlugin:**

| Aspect                   | InvocationOtelPlugin           | ExecutionOtelPlugin                      |
| ------------------------ | ------------------------------ | ---------------------------------------- |
| Trace root               | Invocation span (from ADOT)    | Workflow_Span (synthetic, deterministic) |
| Operation parent         | Invocation span                | Workflow_Span                            |
| Invocation span role     | Parent of operations           | Sibling with span links                  |
| Export timing            | All spans exported immediately | Operations deferred until complete       |
| Non-terminal invocations | Workflow span always emitted   | Workflow_Span discarded (clean traces)   |
| HTTP spans               | ADOT auto-instrumentation      | Self-registered instrumentation          |
| Lambda attributes        | Set by ADOT layer              | Set by plugin (`faas.*`, `cloud.*`)      |

**Span attributes:**

- Workflow_Span: `durable.execution.arn`, `durable.execution.status`
- Invocation_Span: `faas.invocation_id`, `faas.coldstart`, `cloud.resource_id`, `cloud.provider`, `cloud.platform`, `faas.max_memory`, `durable.execution.arn`
- Operation_Span: `durable.execution.arn`, `durable.operation.id`, `durable.operation.type`, `durable.operation.name`, `durable.operation.subtype`
- Attempt_Span: all operation attributes plus `durable.operation.attempt`, `durable.attempt.outcome`

### Additional npm Dependencies

The ExecutionOtelPlugin requires the following additional peer dependencies beyond the base package:

```bash
npm install @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/propagator-aws-xray \
            @opentelemetry/instrumentation-http \
            @opentelemetry/resources \
            @opentelemetry/sdk-trace-node
```

| Package                                   | Role                                           | Required?                                            |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP span export over HTTP                     | Optional (only if not using custom TracerProvider)   |
| `@opentelemetry/propagator-aws-xray`      | X-Ray context propagation on outgoing requests | Required                                             |
| `@opentelemetry/instrumentation-http`     | Auto-instrument outgoing HTTP calls            | Required (unless `enableHttpInstrumentation: false`) |
| `@opentelemetry/resources`                | Lambda resource detection                      | Required                                             |
| `@opentelemetry/sdk-trace-node`           | TracerProvider, SpanProcessor, Sampler         | Required                                             |
| `@opentelemetry/api`                      | Core OTel API types                            | Required (already a peer dep)                        |
| `@opentelemetry/core`                     | Propagators, samplers                          | Required (already a peer dep)                        |
| `@opentelemetry/instrumentation-aws-sdk`  | Auto-instrument AWS SDK calls                  | Required (already a peer dep)                        |

### Migration from InvocationOtelPlugin

If you're currently using `InvocationOtelPlugin` with the full ADOT Lambda layer, here's how to switch to `ExecutionOtelPlugin`:

#### 1. Update your handler code

```diff
- import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
+ import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

- const plugin = new InvocationOtelPlugin();
+ const plugin = new ExecutionOtelPlugin();

  export const handler = withDurableExecution(
    async (event, context) => { /* ... */ },
    { plugins: [plugin] },
  );
```

#### 2. Update Lambda configuration

```diff
  Environment:
    Variables:
-     AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
+     OPENTELEMETRY_COLLECTOR_CONFIG_URI: /var/task/collector.yaml
```

Remove `AWS_LAMBDA_EXEC_WRAPPER` — the ExecutionOtelPlugin handles all instrumentation internally. The ADOT layer's auto-instrumentation is no longer needed.

#### 3. Replace or keep the Lambda layer

**Option A:** Replace the full ADOT layer with the lightweight collector-only layer:

```diff
  Layers:
-   - !Sub arn:aws:lambda:${AWS::Region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-2:1
+   - !Sub arn:aws:lambda:${AWS::Region}:184161586896:layer:opentelemetry-collector-arm64-0_14_0:1
```

**Option B:** Keep the existing ADOT layer (just remove `AWS_LAMBDA_EXEC_WRAPPER`). The collector extension still runs and listens on `localhost:4318`.

#### 4. Add collector.yaml to your bundle

Add the [sample collector.yaml](#sample-collectoryaml) to your function package if using the collector layer.

#### 5. Install additional dependencies

```bash
npm install @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/propagator-aws-xray \
            @opentelemetry/instrumentation-http
```

#### What changes in your traces

After migration:

- A synthetic **Workflow_Span** becomes the trace root (only exported on terminal invocations)
- Operations are parented under the Workflow_Span instead of the Invocation_Span
- Non-terminal invocations produce cleaner traces (no partial Workflow_Span exported)
- Lambda semantic attributes (`faas.*`, `cloud.*`) are set by the plugin instead of ADOT
- HTTP outgoing call spans appear as children of the active operation/attempt span

---

## InvocationOtelPlugin (ADOT Layer)

The lightweight `InvocationOtelPlugin` is designed to work alongside the full ADOT Lambda layer (including its auto-instrumentation). It requires:

1. The ADOT Lambda layer attached to your function
2. `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument` set
3. X-Ray Active Tracing enabled

### Quick Start

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

export const handler = withDurableExecution(
  async (event, context) => {
    const result = await context.step("fetch-data", async () =>
      fetchData(event.id),
    );
    await context.wait({ seconds: 5 });
    await context.step("process", async () => process(result));
    return result;
  },
  { plugins: [new InvocationOtelPlugin()] },
);
```

### ADOT Lambda Layer Setup

The ADOT layer ARN format:

```
arn:aws:lambda:{region}:901920570463:layer:aws-otel-nodejs-{arch}-ver-{version}:{layer-version}
```

Refer to the [ADOT Lambda Layer documentation](https://aws-otel.github.io/docs/getting-started/lambda) for the latest ARNs.

**SAM template:**

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Layers:
      - !Sub arn:aws:lambda:${AWS::Region}:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-2:1
    Environment:
      Variables:
        AWS_LAMBDA_EXEC_WRAPPER: /opt/otel-instrument
    TracingConfig:
      Mode: Active
    Policies:
      - arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess
```

### InvocationOtelPlugin Configuration

```typescript
new InvocationOtelPlugin({
  contextExtractor?: ContextExtractor,  // Default: xRayContextExtractor
  tracerProvider?: TracerProvider,       // Default: global TracerProvider (from ADOT)
  instrumentationName?: string,          // Default: "aws-durable-execution-sdk-js"
});
```

### Environment Variables (ADOT Layer)

| Variable                      | Description                                                 | Default           |
| ----------------------------- | ----------------------------------------------------------- | ----------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Endpoint for OTLP exporter                                  | Set by ADOT layer |
| `AWS_LAMBDA_EXEC_WRAPPER`     | Set to `/opt/otel-instrument` for ADOT auto-instrumentation | —                 |
| `OTEL_TRACES_SAMPLER`         | Sampler (e.g., `traceidratio`)                              | `always_on`       |
| `OTEL_TRACES_SAMPLER_ARG`     | Sampler argument (e.g., `0.3` for 30%)                      | —                 |

---

## API Reference

### `ExecutionOtelPlugin`

Self-contained plugin with full TracerProvider management. Implements `DurableInstrumentationPlugin`.

```typescript
new ExecutionOtelPlugin(config?: ExecutionOtelPluginConfig)
```

### `InvocationOtelPlugin`

Lightweight plugin for use with the ADOT Lambda layer. Implements `DurableInstrumentationPlugin`.

```typescript
new InvocationOtelPlugin(config?: InvocationOtelPluginConfig)
```

### `DeterministicIdGenerator`

Custom OpenTelemetry `IdGenerator` that produces reproducible trace and span IDs from execution metadata.

### `deriveWorkflowSpanId(executionArn: string): string`

Derives a deterministic 16-character hex span ID from an execution ARN. Used internally by ExecutionOtelPlugin for the Workflow_Span.

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

## Verification

After deploying with either plugin:

1. **Invoke your durable function** — trigger an execution with multiple steps or a wait/resume cycle.
2. **Check CloudWatch console** — Navigate to CloudWatch → Traces. You should see spans grouped under one trace ID.
3. **Check log correlation** — If using `enrichLogContext()`, verify logs include `traceId` and `spanId`.
4. **Confirm sampling** — Set `OTEL_DURABLE_SAMPLING_RATIO` below 1.0 and verify only the expected proportion of traces appear.

### Troubleshooting

| Symptom                                 | Likely Cause                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| No traces appear (ExecutionOtelPlugin)  | Collector layer not attached, or `OPENTELEMETRY_COLLECTOR_CONFIG_URI` not set |
| No traces appear (InvocationOtelPlugin) | ADOT layer not configured, or `AWS_LAMBDA_EXEC_WRAPPER` not set               |
| Traces fragmented across IDs            | X-Ray active tracing not enabled on the function                              |
| Missing operation spans                 | Sampling ratio set below 1.0                                                  |
| Collector layer errors                  | Check `collector.yaml` is in the function bundle at the path specified        |

## License

Apache-2.0
