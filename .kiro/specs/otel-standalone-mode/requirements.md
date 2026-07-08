# Requirements Document

## Introduction

Add a new `StandaloneOtelPlugin` class to the `@aws/durable-execution-sdk-js-otel` package that operates as a complete OpenTelemetry instrumentation solution, replacing the auto-instrumentation provided by the ADOT Lambda layer while still relying on the ADOT collector-only layer (or equivalent OTLP collector) for span export. The StandaloneOtelPlugin handles all span creation, context propagation, and instrumentation internally, while the ADOT collector-only layer handles the transport of spans to X-Ray/CloudWatch. This is a separate export from the existing `OtelPlugin`, allowing customers to choose which flavour of OTel integration they want: the lightweight `OtelPlugin` (designed to work alongside the full ADOT layer including its auto-instrumentation) or the self-contained `StandaloneOtelPlugin` (which self-registers instrumentations and propagators, and requires only a collector layer for export).

## Glossary

- **OtelPlugin**: The existing lightweight OpenTelemetry instrumentation plugin class that implements `DurableInstrumentationPlugin` and is designed to work alongside the full ADOT Lambda layer (including its auto-instrumentation).
- **StandaloneOtelPlugin**: A new, self-contained OpenTelemetry instrumentation plugin class that implements `DurableInstrumentationPlugin` and provides full tracing capabilities. It replaces the ADOT layer's auto-instrumentation but still requires the ADOT collector-only layer (or an equivalent OTLP collector) for span export.
- **Workflow_Span**: A synthetic parent span representing the entire durable execution lifecycle, emitted only on terminal invocations with a deterministic span ID derived from the execution ARN.
- **Invocation_Span**: A span representing a single Lambda invocation within a durable execution. Created as a child of the Workflow_Span, it is always exported and serves as a correlation point (via span links) for operations that occur during that invocation — but is NOT used as the parent of Operation_Spans or Attempt_Spans.
- **Context_Execution_Span**: A span representing a single execution of a CONTEXT operation's code within one invocation. Analogous to the Attempt_Span for STEP operations, but named "execution" rather than "attempt" since it represents re-entering the context code rather than a retry. Nested under the CONTEXT Operation_Span.
- **ADOT_Layer**: The AWS Distro for OpenTelemetry Lambda layer. In the context of the StandaloneOtelPlugin, only the collector component is used (auto-instrumentation is not activated because `AWS_LAMBDA_EXEC_WRAPPER` is not set). The collector extension runs independently and listens on `localhost:4318`, forwarding spans to X-Ray/CloudWatch.
- **TracerProvider**: The OpenTelemetry SDK component responsible for creating Tracers and managing span processors and exporters.
- **SpanProcessor**: An OpenTelemetry SDK component that processes spans at start and end time (e.g., batching, exporting, or mutating span data).
- **DeterministicIdGenerator**: The existing class that produces deterministic trace and span IDs from execution metadata.
- **PluginInvocationStatus**: An enum with values SUCCEEDED, FAILED, PENDING, and RETRYING that indicates the final status of a durable execution invocation.
- **AWSXRayPropagator**: An OpenTelemetry context propagator that injects and extracts X-Ray trace context headers for distributed tracing across AWS services.
- **OTLP_Exporter**: An OpenTelemetry Protocol exporter that sends telemetry data to a collector endpoint.
- **Lambda_Context**: The AWS Lambda runtime context object containing metadata such as the request ID, function ARN, and memory configuration.

## Requirements

### Requirement 1: Synthetic Workflow Span

**User Story:** As a developer using durable executions, I want a single parent span representing my entire workflow lifecycle, so that I can see all invocations grouped under one trace in my observability backend.

#### Acceptance Criteria

1. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL create an in-memory Workflow_Span with a deterministic 16-character lowercase hexadecimal span ID derived by hashing the execution ARN using the DeterministicIdGenerator, and SHALL NOT end or export the Workflow_Span during that hook.
2. WHEN `onInvocationStart` is called on subsequent invocations of the same execution (where `isFirstInvocation` is false), THE StandaloneOtelPlugin SHALL recreate the Workflow_Span with the same deterministic span ID as previous invocations, such that all invocations produce an identical span ID for the same execution ARN.
3. WHEN `onInvocationEnd` is called with a PluginInvocationStatus of SUCCEEDED or FAILED, THE StandaloneOtelPlugin SHALL end the Workflow_Span by setting its end time to the current timestamp and SHALL export the span via the configured TracerProvider's span exporter.
4. WHEN `onInvocationEnd` is called with a PluginInvocationStatus of PENDING or RETRYING, THE StandaloneOtelPlugin SHALL discard the Workflow_Span without ending or exporting it, so that no partial workflow span appears in the observability backend for non-terminal invocations.
5. THE StandaloneOtelPlugin SHALL set the Invocation_Span as a child of the Workflow_Span by assigning the Workflow_Span's span context as the Invocation_Span's parent span context, so that the Invocation_Span's `parentSpanId` equals the Workflow_Span's span ID.
6. THE StandaloneOtelPlugin SHALL set the `durable.execution.arn` attribute on the Workflow_Span to the execution ARN string provided in the InvocationInfo.
7. WHEN `onInvocationEnd` is called with a PluginInvocationStatus of SUCCEEDED or FAILED, THE StandaloneOtelPlugin SHALL set the `durable.execution.status` attribute on the Workflow_Span to the string value of the PluginInvocationStatus (either "SUCCEEDED" or "FAILED") before ending the span.
8. THE StandaloneOtelPlugin SHALL set the Workflow_Span's start time to the timestamp of the first invocation start as provided via InvocationInfo, so that the exported span duration covers the full execution lifecycle.

### Requirement 2: Invocation Span

**User Story:** As a developer, I want an invocation span that represents each Lambda invocation, so that I can correlate which operations and attempts occurred during a specific invocation without making the invocation span the parent of those operations.

#### Acceptance Criteria

1. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL create an Invocation_Span as a child of the Workflow_Span, with the `faas.invocation_id` attribute set to the Lambda request ID and a start time of the current timestamp.
2. WHEN `onInvocationEnd` is called, THE StandaloneOtelPlugin SHALL end the Invocation_Span with the current timestamp, causing it to be exported.
3. THE Invocation_Span SHALL NOT be used as the parent span for Operation_Spans or Attempt_Spans. Operation_Spans SHALL be parented directly under the Workflow_Span (or their parent operation's span for nested contexts).
4. WHEN an Operation_Span or Attempt_Span is exported during a particular invocation, THE StandaloneOtelPlugin SHALL add a span link from that Operation_Span or Attempt_Span to the Invocation_Span, associating the operation with the invocation in which it was exported without establishing a parent-child relationship.
5. THE Invocation_Span SHALL always be exported (on every `onInvocationEnd` call, regardless of whether the execution status is terminal or pending).

### Requirement 3: HTTP Instrumentation

**User Story:** As a developer, I want all outgoing HTTP calls from my durable function to produce child spans, so that I can trace external API calls without configuring the ADOT layer.

#### Acceptance Criteria

1. WHEN the StandaloneOtelPlugin is constructed without a custom TracerProvider, THE StandaloneOtelPlugin SHALL register `@opentelemetry/instrumentation-http` alongside the existing `@opentelemetry/instrumentation-aws-sdk`.
2. THE StandaloneOtelPlugin SHALL configure the HTTP instrumentation to suppress spans for requests whose hostname matches `127.0.0.1` or the value of the `AWS_LAMBDA_RUNTIME_API` environment variable.
3. WHEN an outgoing HTTP request is made within an operation attempt, THE HTTP instrumentation SHALL create a child span under the active Attempt_Span context as set by `wrapOperationAttemptFn`.
4. WHEN an outgoing HTTP request is made within a CONTEXT type operation (outside of a nested operation's attempt), THE HTTP instrumentation SHALL create a child span under the active Context_Execution_Span context.
5. WHEN an outgoing HTTP request is made outside an operation (e.g., during setup code before or after the durable execution logic), THE HTTP instrumentation SHALL create a child span under the active Workflow_Span context.
6. WHEN the user provides a custom TracerProvider in the configuration, THE StandaloneOtelPlugin SHALL skip automatic HTTP instrumentation registration.

### Requirement 4: Lambda Semantic Convention Attributes

**User Story:** As a developer, I want Lambda-specific attributes on my spans (matching what ADOT provides), so that my observability backend can display Lambda metadata without requiring the ADOT layer.

#### Acceptance Criteria

1. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL set the `faas.invocation_id` attribute on the Invocation_Span to the Lambda request ID from the invocation info.
2. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL set the `faas.coldstart` attribute on the Invocation_Span to `true` if this is the first invocation in the Lambda execution environment (i.e., no prior invocation has been processed since the container was initialized), and `false` otherwise.
3. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL set the `cloud.resource_id` attribute on the Invocation_Span to the invoked function ARN including the function name, account, region, and qualifier (version or alias), as provided by the Lambda execution environment.
4. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL set the `cloud.provider` attribute to `aws` on the Invocation_Span.
5. WHEN `onInvocationStart` is called, THE StandaloneOtelPlugin SHALL set the `cloud.platform` attribute to `aws_lambda` on the Invocation_Span.
6. WHEN `onInvocationStart` is called, IF the Lambda execution environment exposes a configured memory size, THEN THE StandaloneOtelPlugin SHALL set the `faas.max_memory` attribute on the Invocation_Span to the configured memory size as an integer value in megabytes.
7. IF the Lambda execution environment does not expose a configured memory size, THEN THE StandaloneOtelPlugin SHALL omit the `faas.max_memory` attribute from the Invocation_Span.

### Requirement 5: OTLP Export via Collector

**User Story:** As a developer, I want the StandaloneOtelPlugin to export spans via OTLP to the local ADOT collector, so that I can achieve full distributed tracing with X-Ray/CloudWatch.

#### Acceptance Criteria

1. WHEN the StandaloneOtelPlugin is constructed without a custom TracerProvider, THE StandaloneOtelPlugin SHALL configure an OTLPSpanExporter that sends spans to `http://localhost:4318/v1/traces` by default (the ADOT collector-only layer's OTLP HTTP endpoint).
2. WHEN the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable is set to a non-empty string, THE StandaloneOtelPlugin SHALL use that value as the exporter endpoint instead of the default `http://localhost:4318/v1/traces`.
3. WHEN the StandaloneOtelPlugin is constructed without a custom TracerProvider, THE StandaloneOtelPlugin SHALL register a composite propagator that includes the AWSXRayPropagator, ensuring outgoing HTTP requests carry the `X-Amzn-Trace-Id` header for downstream context injection.
4. WHEN the StandaloneOtelPlugin is constructed without a custom TracerProvider, THE StandaloneOtelPlugin SHALL include the W3C TraceContext propagator in the composite propagator alongside the AWSXRayPropagator, ensuring outgoing HTTP requests also carry the `traceparent` header for interoperability with non-AWS systems.
5. IF the OTLPSpanExporter fails to connect or export spans (e.g., network timeout, connection refused, or non-2xx response from the collector), THEN THE StandaloneOtelPlugin SHALL log a warning message indicating the export failure and SHALL continue processing durable execution operations without throwing an exception or interrupting the execution flow.
6. WHEN the StandaloneOtelPlugin is constructed with a custom TracerProvider, THE StandaloneOtelPlugin SHALL NOT register any propagators or span exporters, deferring all propagation and export configuration to the caller-provided TracerProvider.
7. THE StandaloneOtelPlugin SHALL configure its TracerProvider with a sampler as follows: WHEN the `OTEL_DURABLE_SAMPLING_RATIO` environment variable is set to a valid number between 0 and 1 (inclusive), THE StandaloneOtelPlugin SHALL use a `TraceIdRatioBasedSampler` with that ratio (applied directly, without `ParentBasedSampler` wrapping), ensuring all invocations of the same execution are sampled or dropped consistently based on the deterministic trace ID. WHEN `OTEL_DURABLE_SAMPLING_RATIO` is not set or is invalid, THE StandaloneOtelPlugin SHALL default to `AlwaysOnSampler`, ensuring all spans are exported by default.

### Requirement 6: Zero-Config Customer Experience

**User Story:** As a developer, I want to use `new StandaloneOtelPlugin()` with minimal setup to get full standalone tracing, so that I can add observability to my durable functions with minimal code changes (while attaching the ADOT collector-only layer for span transport).

#### Acceptance Criteria

1. WHEN the StandaloneOtelPlugin is constructed with no arguments, THE StandaloneOtelPlugin SHALL self-register all necessary components: TracerProvider, SpanProcessors, instrumentations (AWS SDK and HTTP), propagators (X-Ray and W3C), and an OTLP exporter targeting the local collector (`http://localhost:4318/v1/traces`).
2. WHEN the StandaloneOtelPlugin is constructed with a partial `StandaloneOtelPluginConfig`, THE StandaloneOtelPlugin SHALL merge user-provided values with sensible defaults for any omitted fields (scalar fields use user values when provided, array fields replace defaults entirely when provided).
3. THE StandaloneOtelPlugin SHALL expose the following additional configuration options on `StandaloneOtelPluginConfig`: `enableHttpInstrumentation` (boolean, defaults to true), `exporterConfig` (object with `endpoint` and `headers`), and `propagators` (array of propagator instances).
4. WHEN the `enableHttpInstrumentation` option is explicitly set to `false`, THE StandaloneOtelPlugin SHALL skip registering the HTTP instrumentation.
5. THE StandaloneOtelPlugin SHALL detect the Lambda execution environment by checking for the `AWS_LAMBDA_FUNCTION_NAME` environment variable, and when present SHALL use the Lambda resource detector to populate resource attributes (service.name, cloud.region, faas.name, faas.version).

### Requirement 7: Deterministic Workflow Span ID Generation

**User Story:** As a developer, I want the Workflow_Span to have a stable, reproducible span ID across all invocations, so that my observability backend can correlate spans from different invocations into a single workflow trace.

#### Acceptance Criteria

1. THE DeterministicIdGenerator SHALL provide a method named `deriveWorkflowSpanId` that accepts an execution ARN string and returns a valid 16-character lowercase hexadecimal string that is distinct from all-zeros (`0000000000000000`).
2. FOR ALL valid execution ARN strings, calling `deriveWorkflowSpanId` with the same ARN SHALL produce the same span ID (determinism property).
3. FOR ALL pairs of distinct execution ARN strings, `deriveWorkflowSpanId` SHALL produce different span IDs with probability greater than 1 - 2^-64 (collision resistance property).
4. THE StandaloneOtelPlugin SHALL use the `deriveWorkflowSpanId` method when creating the Workflow_Span rather than relying on a random span ID generator.
5. IF `deriveWorkflowSpanId` is called with an empty string, THEN it SHALL throw an Error indicating that the execution ARN must be non-empty.

### Requirement 8: Separate Export from Existing OtelPlugin

**User Story:** As a library consumer, I want to choose between the lightweight `OtelPlugin` (for use with the full ADOT layer) and the self-contained `StandaloneOtelPlugin` (which handles instrumentation and requires only the ADOT collector-only layer), so that I can pick the integration approach that matches my infrastructure.

#### Acceptance Criteria

1. THE `@aws/durable-execution-sdk-js-otel` package SHALL export `StandaloneOtelPlugin` as a named export alongside the existing `OtelPlugin`.
2. THE existing `OtelPlugin` class SHALL retain the same constructor signature (`OtelPluginConfig` parameter), the same set of public methods implementing `DurableInstrumentationPlugin`, and the same named export path so that existing consumer code compiles without modification.
3. THE `StandaloneOtelPlugin` SHALL implement the `DurableInstrumentationPlugin` interface, providing the same lifecycle hook methods as `OtelPlugin`.
4. THE `StandaloneOtelPlugin` SHALL reuse the existing `DeterministicIdGenerator` and context extractor utilities from the package.
5. THE `StandaloneOtelPlugin` SHALL create and manage its own `TracerProvider` internally (including span exporters), so that consumers who do not have ADOT or an external collector configured can emit traces without additional setup beyond instantiating the plugin.
6. WHEN the `StandaloneOtelPlugin` accepts a configuration object, THE configuration SHALL allow specifying an exporter endpoint and a service name, with default values applied when these options are omitted.
7. WHEN the durable execution invocation ends with a terminal status, THE `StandaloneOtelPlugin` SHALL flush the internally managed `TracerProvider` to ensure all buffered spans are exported before the Lambda environment is frozen.
8. UNLESS explicitly specified otherwise in this requirements document (Requirements 1, 2, 4, 5, 9), THE `StandaloneOtelPlugin` lifecycle hook implementations (`onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`, `onOperationAttemptEnd`, `wrapInvocation`, `wrapChildContextFn`, `wrapOperationAttemptFn`, `onOperationChange`, `enrichLogContext`) SHALL behave identically to the existing `OtelPlugin` — using the same deterministic span ID derivation, the same context propagation via `context.with(trace.setSpan(...))`, the same span attributes (`durable.execution.arn`, `durable.operation.id`, `durable.operation.type`, `durable.operation.name`, `durable.operation.subtype`), the same replay/non-replay branching logic, the same span links for continuation spans, and the same error recording behavior.

### Requirement 9: Simplified Operation Span Lifecycle

**User Story:** As a developer, I want operation spans to only appear in my trace when they are fully completed, so that I get a clean trace view without partial or intermediate span fragments from suspended invocations.

#### Acceptance Criteria

1. WHEN `onOperationStart` is called for a non-replay operation, THE StandaloneOtelPlugin SHALL create an Operation_Span with the deterministic span ID derived from the operation ID and execution ARN, the provided start timestamp, and set it as the parent context so that child spans and attempt spans created within that operation are parented to this Operation_Span.
2. WHEN `onOperationEnd` is called for a completed operation that was started in the current invocation, THE StandaloneOtelPlugin SHALL end the Operation_Span with the provided end timestamp, causing it to be exported to the configured span exporter.
3. WHEN `onOperationEnd` is called for a non-replay operation where `onOperationStart` was NOT called in the same invocation (i.e., the operation was started in a prior invocation), THE StandaloneOtelPlugin SHALL create the Operation_Span with the deterministic span ID, set its start time from the `startTimestamp` provided in the OperationEndInfo, end the span with the provided end timestamp, and export it immediately.
4. WHEN `onInvocationEnd` is called and open Operation_Spans remain (because the operation has not yet completed), THE StandaloneOtelPlugin SHALL discard those spans without exporting them.
5. WHEN `onOperationStart` is called on a subsequent invocation for the same operation (started in a prior invocation), THE StandaloneOtelPlugin SHALL recreate the Operation_Span using the same deterministic span ID (derived from the same operation ID and execution ARN) and the original start timestamp from OperationInfo, so that attempts in this invocation are parented correctly to the same Operation_Span ID.
6. THE StandaloneOtelPlugin SHALL set the parent span ID of all attempt spans for a given operation to the deterministic Operation_Span ID derived from that operation's ID and execution ARN, regardless of which invocation the attempt occurs in.
7. WHEN `onOperationEnd` is called for a replayed operation (where `isReplay` is true and the operation type is WAIT, INVOKE, CHAINED_INVOKE, or CALLBACK), THE StandaloneOtelPlugin SHALL skip span creation entirely (no span is started, ended, or exported).
8. IF `onOperationEnd` is called with an error present for a non-replay operation, THEN THE StandaloneOtelPlugin SHALL record the error on the Operation_Span by setting its status to ERROR with the error message and recording the exception before ending the span.

### Requirement 10: Context Execution Spans

**User Story:** As a developer, I want each execution of a CONTEXT operation's code to produce its own span nested under the CONTEXT operation span, so that I can see how many times the context was entered across invocations and what happened in each execution.

#### Acceptance Criteria

1. WHEN `wrapChildContextFn` is called for a CONTEXT type operation, THE StandaloneOtelPlugin SHALL create a Context_Execution_Span as a child of the CONTEXT Operation_Span, with a span name of `{operationName} execution {N}` where N is the execution number (1-based, derived from the attempt count or invocation sequence for that context).
2. THE Context_Execution_Span SHALL be set as the active context for the duration of the wrapped function execution, so that any child operations (nested steps, waits, invokes) created within the context function are parented under this execution span.
3. WHEN the wrapped function completes (successfully or with an error), THE StandaloneOtelPlugin SHALL end the Context_Execution_Span with the current timestamp.
4. THE Context_Execution_Span SHALL include the same attributes as other operation spans: `durable.execution.arn`, `durable.operation.id`, `durable.operation.type` (set to "CONTEXT"), and `durable.operation.name` (if present). No new attributes SHALL be introduced for the Context_Execution_Span.
5. IF the wrapped function throws an error, THEN THE StandaloneOtelPlugin SHALL record the error on the Context_Execution_Span by setting its status to ERROR with the error message and recording the exception before ending the span.
6. THE Context_Execution_Span is analogous to an Attempt_Span for STEP operations but represents a single run of the context's code rather than a retry attempt. It SHALL NOT introduce any new attribute namespaces.
7. WHEN a CONTEXT operation spans multiple invocations, each invocation that executes the context's code SHALL produce its own Context_Execution_Span, all parented under the same deterministic CONTEXT Operation_Span ID.

### Requirement 11: README Documentation for StandaloneOtelPlugin Setup

**User Story:** As a developer evaluating or onboarding to the StandaloneOtelPlugin, I want a comprehensive README that explains the setup options and infrastructure requirements, so that I can quickly understand what's needed and choose the right export strategy for my environment.

#### Acceptance Criteria

1. THE `@aws/durable-execution-sdk-js-otel` package SHALL include a README section (or dedicated markdown file) documenting the StandaloneOtelPlugin setup, covering installation, basic usage, and configuration options.
2. THE README SHALL document the minimal handler setup showing `new StandaloneOtelPlugin()` passed to `withDurableExecution` with no additional configuration.
3. THE README SHALL document the supported export strategies with clear guidance on when to use each, and SHALL mark the collector layer approach as the **recommended** path:
   - **Recommended: Via a collector-only Lambda layer** (export to `localhost:4318`) — attach either the OpenTelemetry community collector-only layer (preferred, purpose-built for this use case) or the legacy ADOT Lambda layer (with auto-instrumentation disabled by not setting `AWS_LAMBDA_EXEC_WRAPPER`). The StandaloneOtelPlugin exports OTLP to the local collector, which forwards spans to X-Ray. This is recommended because: (a) no SigV4 signing complexity in the plugin, (b) the collector handles batching, retry, and buffering after Lambda freezes, (c) well-tested and production-proven path, (d) supports multi-destination fan-out via collector config.
   - **Direct to CloudWatch OTLP endpoint** (`https://xray.{region}.amazonaws.com/v1/traces`) — requires SigV4 authentication, no collector needed, sends traces directly to X-Ray. Use when minimizing Lambda layers is a priority.
   - **Via third-party OTLP endpoint** — set `OTEL_EXPORTER_OTLP_ENDPOINT` to the vendor's endpoint (Datadog, Honeycomb, Grafana, etc.) with appropriate auth headers. Can be combined with a collector layer for reliability.
4. THE README SHALL document the required IAM permissions for each export strategy:
   - Direct to CloudWatch: `xray:PutTraceSegments`, `xray:PutTelemetryRecords`, or the relevant CloudWatch OTLP permissions.
   - Via ADOT collector layer: permissions are handled by the collector's execution role.
5. THE README SHALL document the environment variables recognized by the StandaloneOtelPlugin: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_DURABLE_SAMPLING_RATIO` (value between 0 and 1 for trace-ID-based probabilistic sampling; defaults to 1.0 meaning all traces sampled), `AWS_LAMBDA_FUNCTION_NAME`, `AWS_REGION`, and `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`.
6. THE README SHALL include a SAM/CloudFormation template snippet showing the Lambda function configuration for each export strategy (with and without the ADOT collector layer), with the collector-only layer example marked as the recommended starting point.
7. THE README SHALL document the `StandaloneOtelPluginConfig` interface with descriptions of each option: `tracerProvider`, `contextExtractor`, `instrumentationName`, `enableHttpInstrumentation`, `exporterConfig`, and `propagators`.
8. THE README SHALL include a "Trace Structure" section with an ASCII or Mermaid diagram showing the span hierarchy: Workflow_Span → Invocation_Span → Operation_Span → Attempt_Span, and how it differs from the existing OtelPlugin's trace structure.
9. THE README SHALL include a "Migration from OtelPlugin" section explaining how to switch from the ADOT-dependent `OtelPlugin` to `StandaloneOtelPlugin`, including which Lambda layers to remove and which env vars to change.
10. THE README SHALL document the additional npm dependencies required by the StandaloneOtelPlugin beyond those already in the package: `@opentelemetry/exporter-trace-otlp-http` (optional peer), `@opentelemetry/propagator-aws-xray`, and `@opentelemetry/instrumentation-http`.
11. THE README SHALL include a "Collector Layer Setup" section that documents two supported collector layer options with step-by-step instructions for each:

- **Option A (Recommended): OpenTelemetry community collector-only layer** — (a) find the latest collector layer ARN from https://github.com/open-telemetry/opentelemetry-lambda/releases for the customer's region and architecture, (b) attach the layer to the Lambda function, (c) include a `collector.yaml` in the function bundle configured with the `awsxray` exporter and OTLP receiver on `localhost:4318`, (d) set `OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml`, (e) do NOT set `AWS_LAMBDA_EXEC_WRAPPER` (no auto-instrumentation), (f) verify traces appear in X-Ray/CloudWatch.
- **Option B: Legacy ADOT Lambda layer (collector + SDK bundle)** — (a) find the legacy ADOT Node.js layer ARN (`arn:aws:lambda:<region>:901920570463:layer:aws-otel-nodejs-<arch>-ver-1-30-2:1`), (b) attach the layer to the Lambda function, (c) do NOT set `AWS_LAMBDA_EXEC_WRAPPER` (disables the SDK auto-instrumentation while the collector extension still runs on `localhost:4318`), (d) verify traces appear in X-Ray/CloudWatch.

12. THE README SHALL explain why a collector layer is required: the collector handles batching, retry with backoff, buffering during Lambda freeze/thaw cycles, and protocol translation (OTLP → X-Ray format) without adding complexity to the application code or requiring SigV4 signing in the exporter.
13. THE README SHALL include a sample `collector.yaml` configuration file for the OpenTelemetry community collector layer that receives OTLP on `localhost:4318` and exports to X-Ray using the `awsxray` exporter.
