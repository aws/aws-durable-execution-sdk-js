# AWS Durable Execution SDK - OpenTelemetry Plugin

> **Experimental beta:** This plugin is not recommended for production
> workloads. Its API may change between releases.

OpenTelemetry instrumentation for the AWS Durable Execution SDK. The package
provides two plugins that emit durable workflow, invocation, operation, and
attempt spans. The plugins install an execution-scoped deterministic ID
generator on global SDK tracers or providers created through
`tracerProviderFactory`.

| Plugin                 | Trace structure                                                          |
| ---------------------- | ------------------------------------------------------------------------ |
| `ExecutionOtelPlugin`  | Operations are children of the durable Workflow span                     |
| `InvocationOtelPlugin` | Operations are children of the current Invocation span and link Workflow |

The plugins do not create or register an OpenTelemetry provider, exporter,
sampler, resource, propagator, or library instrumentation. They use the global
provider by default, or an application-owned provider created through
`tracerProviderFactory`.

## Installation

```bash
npm install @aws/durable-execution-sdk-js-otel
```

The package requires Node.js 22 or later.

## Global Provider

With no provider configuration, the plugins use
`trace.getTracerProvider()`. This is the normal setup for the ADOT Lambda
layer or an application that registers a provider before constructing the
plugin.

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";

const plugin = new ExecutionOtelPlugin();

export const handler = withDurableExecution(
  async (event, context) => {
    return context.step("process", async () => process(event));
  },
  { plugins: [plugin] },
);
```

When using ADOT, activate its auto-instrumentation wrapper:

```text
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument
```

For a globally registered OpenTelemetry SDK provider, the plugin replaces the
tracer's runtime `_idGenerator` field with a deterministic wrapper. The
provider's existing generator remains the fallback for unrelated spans.
OpenTelemetry JavaScript does not expose this field through its public API, so
the plugin validates its runtime shape before replacing it.

If the plugin is constructed before zero-code instrumentation registers the
provider, its initial tracer is a proxy without `_idGenerator`. The plugin
resolves the global provider again and retries at `onInvocationStart`. If the
registered tracer still does not expose a compatible field, it logs one error
and continues using the provider without deterministic durable IDs.

If no SDK provider has been globally registered, OpenTelemetry returns a no-op
provider and the plugin emits no exported spans.

## Application-Owned Provider

OpenTelemetry JavaScript accepts an ID generator through its supported API when
constructing an SDK provider. The plugin passes an ID generator factory to
`tracerProviderFactory`, avoiding runtime field replacement for
application-owned providers.

```typescript
import { InvocationOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

const plugin = new InvocationOtelPlugin({
  tracerProviderFactory: (createIdGenerator) => {
    const provider = new NodeTracerProvider({
      idGenerator: createIdGenerator(),
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: "http://localhost:4318/v1/traces",
          }),
        ),
      ],
    });

    provider.register();
    return provider;
  },
});
```

`createIdGenerator()` delegates non-durable IDs to OpenTelemetry's standard
random generator. To preserve an application-specific generator, pass it as
the fallback:

```typescript
idGenerator: createIdGenerator(applicationIdGenerator);
```

The deterministic wrapper is active only while the plugin creates durable
spans. All unrelated spans continue to use `applicationIdGenerator`.

The application owns all configuration and lifecycle for the returned
provider, including:

- exporters and span processors;
- sampling and resources;
- context propagation;
- HTTP, AWS SDK, and other library instrumentation;
- global registration and shutdown.

Use `createIdGenerator` when constructing the provider; creating a separate
deterministic generator is not necessary. The plugin may call `forceFlush()`
after an invocation, but it does not shut down an application-owned provider.

## Dynamic Loading from a Lambda Layer

The SDK can load either plugin without importing it in function code. Package
this module and its peer dependencies in a Lambda layer under
`nodejs/node_modules`, then configure one entry point:

```text
DURABLE_EXECUTION_PLUGINS=@aws/durable-execution-sdk-js-otel/otel-execution
```

or:

```text
DURABLE_EXECUTION_PLUGINS=@aws/durable-execution-sdk-js-otel/otel-invocation
```

Dynamic providers construct plugins with default configuration, so they require
a globally registered OpenTelemetry provider. Use code-based registration when
you need `tracerProviderFactory` or other custom configuration.

## Choosing a Plugin

### `ExecutionOtelPlugin`

Use this plugin for a workflow-centered view. The deterministic Workflow span
is the parent of durable operation spans. Operation spans link to the Invocation
span that observed them.

```text
Workflow
├── Operation: fetch-data
│   ├── Attempt 1
│   └── link -> Invocation
├── Operation: wait
└── Operation: process
```

### `InvocationOtelPlugin`

Use this plugin for invocation-centered traces. Each operation is parented to
the current Invocation span and links back to the deterministic Workflow span.

```text
Invocation
├── Operation: fetch-data
│   ├── Attempt 1
│   └── link -> Workflow
├── Operation: wait
└── Operation: process
```

## Shared Configuration

Both plugins accept `OtelPluginConfig`:

```typescript
interface OtelPluginConfig {
  /** Creates an application-owned provider with a deterministic ID wrapper. */
  tracerProviderFactory?: (
    createIdGenerator: (fallbackIdGenerator?: IdGenerator) => IdGenerator,
  ) => TracerProvider;

  /** Extracts upstream trace context. Defaults to xRayContextExtractor. */
  contextExtractor?: ContextExtractor;

  /** Instrumentation scope name. */
  instrumentationName?: string;

  /** Custom Workflow span name. Defaults to "Workflow". */
  workflowSpanName?: string;

  /** Add active OTel IDs to durable log records. Defaults to true. */
  enrichLogger?: boolean;
}
```

Provider selection is implicit:

- omit `tracerProviderFactory` to use the global provider;
- provide `tracerProviderFactory` to use an application-owned provider.

## Context Extraction

The default `xRayContextExtractor` reads `_X_AMZN_TRACE_ID`. A custom extractor
can return a trace ID, parent span ID, and trace flags:

```typescript
type ContextExtractor = (info: InvocationInfo) =>
  | {
      traceId: string;
      parentSpanId?: string;
      traceFlags?: number;
    }
  | undefined;
```

The package also exports `w3cClientContextExtractor`, which reads W3C
`traceparent` data from `context.clientContext.custom.traceparent`.

## Log Correlation

When `enrichLogger` is enabled, durable log records receive the active
OpenTelemetry `traceId`, `spanId`, and `otelTraceSampled` values. Disable this
when another logging integration already injects equivalent fields:

```typescript
const plugin = new ExecutionOtelPlugin({
  enrichLogger: false,
});
```

## Peer Dependencies

The plugin directly requires:

```bash
npm install @aws/durable-execution-sdk-js \
            @opentelemetry/api \
            @opentelemetry/core \
            @opentelemetry/sdk-trace-node
```

Install exporters, propagators, resources, and instrumentation packages that
match the provider configuration owned by your application or ADOT layer.

## API Reference

### `ExecutionOtelPlugin`

```typescript
new ExecutionOtelPlugin(config?: OtelPluginConfig)
```

### `InvocationOtelPlugin`

```typescript
new InvocationOtelPlugin(config?: OtelPluginConfig)
```

### `TracerProviderFactory`

```typescript
type IdGeneratorFactory = (fallbackIdGenerator?: IdGenerator) => IdGenerator;

type TracerProviderFactory = (
  createIdGenerator: IdGeneratorFactory,
) => TracerProvider;
```

### `DeterministicIdGenerator`

An OpenTelemetry `IdGenerator` with execution-scoped deterministic overrides.
All unrelated ID generation is delegated to its fallback generator. For global
SDK providers, the plugin discovers the tracer's existing generator at runtime
and installs this wrapper around it. For application-owned providers, the
plugin passes a factory to `tracerProviderFactory` so applications can install
the wrapper during provider construction.

### `deriveWorkflowSpanId(executionArn: string): string`

Derives a deterministic 16-character hexadecimal Workflow span ID.

### `deriveSpanIdFromOperationId(operationId: string, executionArn: string): string`

Derives a deterministic 16-character hexadecimal operation span ID.

### `xRayContextExtractor`

Reads trace context from `_X_AMZN_TRACE_ID`.

### `w3cClientContextExtractor`

Reads W3C trace context from Lambda client context.

## Verification

After deployment:

1. Invoke a durable function with multiple steps or a wait/resume cycle.
2. Verify Workflow, Invocation, operation, and attempt spans in the configured
   backend.
3. Confirm unrelated root spans retain provider-generated trace IDs.
4. Verify durable log records contain trace correlation fields when
   `enrichLogger` is enabled.

If no spans appear, verify that the application or ADOT layer registered an SDK
provider before plugin construction and that the provider has an exporter and
span processor.

## License

Apache-2.0
