# Requirements Document

## Introduction

The ExecutionOtelPlugin is a self-contained OpenTelemetry instrumentation plugin for AWS Lambda durable executions. It implements the DurableInstrumentationPlugin interface and creates/manages its own TracerProvider, registers instrumentations and propagators, and exports spans via OTLP. The plugin produces a deterministic span hierarchy (Workflow → Invocation → Operation → Attempt) that stitches traces across multiple Lambda invocations of the same durable execution using deterministic ID generation derived from execution ARNs and operation IDs.

Both the ExecutionOtelPlugin and InvocationOtelPlugin share common infrastructure for configuration, TracerProvider resolution, and instrumentation registration. The shared helpers (config interface, provider factory, and instrumentation registration) are extracted into reusable modules so that both plugins can leverage the same configuration surface and setup logic without duplication.

## Glossary

- **Plugin**: The ExecutionOtelPlugin class that implements DurableInstrumentationPlugin
- **InvocationOtelPlugin**: The simpler plugin that relies on external auto-instrumentation (e.g., ADOT Lambda layer) and uses the global TracerProvider by default
- **TracerProvider**: An OpenTelemetry TracerProvider that creates Tracers for span generation
- **Tracer**: An OpenTelemetry Tracer obtained from a TracerProvider, used to create spans
- **Span**: An OpenTelemetry span representing a unit of work with start/end times, attributes, and links
- **Workflow_Span**: The root span of an execution trace, representing the entire durable execution lifecycle
- **Invocation_Span**: A span representing a single Lambda invocation within a durable execution
- **Operation_Span**: A span representing a durable operation (step, wait, invoke, context, etc.)
- **Attempt_Span**: A span representing a single retry attempt of an operation
- **Context_Execution_Span**: A span created for CONTEXT-type operations via wrapChildContextFn
- **DeterministicIdGenerator**: A custom OpenTelemetry IdGenerator that produces deterministic trace and span IDs from execution metadata
- **ContextExtractor**: A function that extracts upstream trace context (traceId, parentSpanId, traceFlags) from the invocation environment
- **SpanMap**: A per-invocation Map<string, Span> that tracks active operation spans by operation ID
- **OTLP**: OpenTelemetry Protocol, used for exporting spans to a collector
- **BatchSpanProcessor**: An OpenTelemetry span processor that batches spans for efficient export
- **CompositePropagator**: A propagator that combines multiple TextMapPropagators
- **Execution_ARN**: The Amazon Resource Name uniquely identifying a durable execution instance
- **Cold_Start**: The first invocation in a Lambda container's lifecycle
- **Shared Config**: The ExecutionOtelPluginConfig interface reused by both plugins for TracerProvider, exporter, propagator, and instrumentation configuration
- **Provider Factory**: The createTracerProvider function that resolves and creates TracerProvider instances for both plugins
- **Instrumentation Registry**: The registerStandaloneInstrumentations function that registers HTTP and AWS SDK instrumentations for both plugins

## Requirements

### Requirement 1: Plugin Interface Implementation

**User Story:** As a durable execution SDK consumer, I want the plugin to implement all DurableInstrumentationPlugin lifecycle hooks, so that it integrates seamlessly with the execution framework.

#### Acceptance Criteria

1. THE Plugin SHALL implement the onInvocationStart hook accepting InvocationInfo and returning Promise<void>
2. THE Plugin SHALL implement the wrapInvocation hook accepting InvocationInfo and an async function, returning Promise<DurableExecutionInvocationOutput>
3. THE Plugin SHALL implement the onInvocationEnd hook accepting InvocationEndInfo and returning Promise<void>
4. THE Plugin SHALL implement the onOperationStart hook accepting OperationInfo and returning Promise<void>
5. THE Plugin SHALL implement the wrapChildContextFn hook accepting OperationInfo and a synchronous function, returning unknown
6. THE Plugin SHALL implement the onOperationEnd hook accepting OperationEndInfo and returning Promise<void>
7. THE Plugin SHALL implement the onOperationAttemptStart hook accepting AttemptInfo and returning Promise<void>
8. THE Plugin SHALL implement the wrapOperationAttemptFn hook accepting AttemptInfo and a synchronous function, returning unknown
9. THE Plugin SHALL implement the onOperationAttemptEnd hook accepting AttemptEndInfo and returning Promise<void>
10. THE Plugin SHALL NOT implement the onOperationChange hook (the interface method is optional and the plugin omits it)
11. THE Plugin SHALL implement the enrichLogContext hook returning Record<string, string | number | boolean> or undefined

### Requirement 2: TracerProvider Resolution

**User Story:** As a developer, I want flexible TracerProvider configuration with three priority levels, so that I can use a custom provider, the global provider, or an auto-configured provider.

#### Acceptance Criteria

1. WHEN a tracerProvider is explicitly provided in config, THE Plugin SHALL use that provider directly without any auto-setup and without wrapping or modifying it
2. WHEN a tracerProvider is explicitly provided in config, THE Plugin SHALL set ownsProvider to false regardless of whether it wraps or modifies the provider
3. WHEN useDefaultTracerProvider is true and no explicit tracerProvider is provided, THE Plugin SHALL obtain the TracerProvider via trace.getTracerProvider()
4. WHEN useDefaultTracerProvider is true, THE Plugin SHALL set ownsProvider to false regardless of which provider is actually used
5. WHEN neither tracerProvider nor useDefaultTracerProvider is set, THE Plugin SHALL create a NodeTracerProvider with BatchSpanProcessor and OTLPTraceExporter
6. WHEN creating an auto-configured provider, THE Plugin SHALL set ownsProvider to true
7. WHEN both tracerProvider and useDefaultTracerProvider are set, THE Plugin SHALL use the explicit tracerProvider (tracerProvider takes precedence)

### Requirement 3: Auto-Configured TracerProvider Setup

**User Story:** As a developer deploying to Lambda, I want the plugin to auto-configure a fully functional TracerProvider with OTLP export, so that I get working telemetry with zero configuration.

#### Acceptance Criteria

1. WHEN creating the auto-configured provider, THE Plugin SHALL create an OTLPTraceExporter with endpoint resolved from config.exporterConfig.endpoint, then OTEL_EXPORTER_OTLP_ENDPOINT environment variable, then "http://localhost:4318/v1/traces" as default
2. WHEN config.exporterConfig.headers is provided, THE Plugin SHALL pass those headers to the OTLPTraceExporter
3. THE Plugin SHALL wrap the OTLPTraceExporter in a BatchSpanProcessor
4. WHEN OTEL_DURABLE_SAMPLING_RATIO environment variable is set to a valid number between 0 and 1 inclusive, THE Plugin SHALL use a TraceIdRatioBasedSampler with that ratio; IF creating the sampler fails at runtime, THEN THE Plugin SHALL fail the entire TracerProvider setup
5. WHEN OTEL_DURABLE_SAMPLING_RATIO is not set or is not a valid number between 0 and 1, THE Plugin SHALL use AlwaysOnSampler
6. WHEN AWS_LAMBDA_FUNCTION_NAME environment variable is set, THE Plugin SHALL create a resource with attributes: service.name (function name), faas.name (function name), cloud.provider ("aws"), cloud.platform ("aws_lambda"); WHEN AWS_LAMBDA_FUNCTION_NAME is not set, THE Plugin SHALL not create resource attributes
7. WHEN AWS_REGION environment variable is set, THE Plugin SHALL include cloud.region in the resource attributes
8. WHEN AWS_LAMBDA_FUNCTION_VERSION environment variable is set, THE Plugin SHALL include faas.version in the resource attributes
9. THE Plugin SHALL register the provider with a CompositePropagator containing the configured propagators
10. WHEN no custom propagators are provided in config, THE Plugin SHALL use [AWSXRayPropagator, W3CTraceContextPropagator] as default propagators
11. THE Plugin SHALL call propagation.setGlobalPropagator with the CompositePropagator
12. THE Plugin SHALL call tracerProvider.register() with the CompositePropagator

### Requirement 4: Instrumentation Registration

**User Story:** As a developer, I want HTTP and AWS SDK calls automatically instrumented, so that downstream service calls appear as child spans without manual instrumentation.

#### Acceptance Criteria

1. WHEN a custom tracerProvider is provided in config, THE Plugin SHALL skip all instrumentation registration
2. WHEN useDefaultTracerProvider is true, THE Plugin SHALL skip all instrumentation registration
3. WHEN no custom provider is used and enableHttpInstrumentation is not explicitly false, THE Plugin SHALL register HttpInstrumentation
4. THE Plugin SHALL configure HttpInstrumentation to suppress spans for requests with hostname "127.0.0.1"
5. WHEN AWS_LAMBDA_RUNTIME_API environment variable is set, THE Plugin SHALL configure HttpInstrumentation to suppress spans for requests matching the runtime API hostname (the host portion before the colon)
6. THE Plugin SHALL always register AwsInstrumentation with suppressInternalInstrumentation set to true
7. THE Plugin SHALL always register AwsInstrumentation with sqsExtractContextPropagationFromPayload set to true
8. WHEN enableHttpInstrumentation is explicitly false, THE Plugin SHALL not register HttpInstrumentation

### Requirement 5: Deterministic ID Generation

**User Story:** As a developer, I want spans across multiple invocations of the same execution to share a single trace, so that I can view the entire execution as one trace in my observability backend.

#### Acceptance Criteria

1. THE DeterministicIdGenerator SHALL implement the OpenTelemetry IdGenerator interface with generateTraceId and generateSpanId methods
2. WHEN setTraceId is called, THE DeterministicIdGenerator SHALL persistently return that value from generateTraceId until setTraceId is called again; WHEN generateTraceId is called with a traceId already set, THE DeterministicIdGenerator SHALL return the previously set traceId
3. WHEN setNextSpanId is called, THE DeterministicIdGenerator SHALL return that value from generateSpanId exactly once when generateSpanId is subsequently invoked, then revert to fallback behavior
4. WHEN no traceId is set, THE DeterministicIdGenerator SHALL generate a random 32-character hex string using SHA-256 of a random value as fallback
5. WHEN no nextSpanId is set, THE DeterministicIdGenerator SHALL generate a random 16-character hex string using SHA-256 of a random value as fallback
6. THE Plugin SHALL monkey-patch the tracer's \_idGenerator property with the DeterministicIdGenerator instance

### Requirement 6: Trace ID Derivation

**User Story:** As a developer, I want deterministic trace IDs derived from execution metadata, so that all invocations of the same execution share the same trace.

#### Acceptance Criteria

1. THE deriveTraceIdFromArn function SHALL compute SHA-256 of the execution ARN and return the first 32 hex characters
2. THE deriveTraceIdFromXRayRoot function SHALL strip the "1-" prefix and all dashes from the X-Ray Root field to produce a 32-character hex trace ID
3. WHEN the X-Ray Root value has a "Root=" prefix, THE deriveTraceIdFromXRayRoot function SHALL strip that prefix before processing, and the processing SHALL always produce a value different from the original input
4. WHEN the X-Ray Root value does not start with "1-" after prefix stripping, THE deriveTraceIdFromXRayRoot function SHALL return undefined
5. WHEN the resulting hex string is not exactly 32 lowercase hex characters, THE deriveTraceIdFromXRayRoot function SHALL return undefined

### Requirement 7: Span ID Derivation

**User Story:** As a developer, I want deterministic span IDs for workflow and operation spans, so that spans are consistently identified across invocations.

#### Acceptance Criteria

1. THE deriveWorkflowSpanId function SHALL compute SHA-256 of "workflow:" concatenated with the execution ARN and return the first 16 hex characters
2. WHEN the derived workflow span ID equals "0000000000000000", THE deriveWorkflowSpanId function SHALL return "0000000000000001" instead
3. WHEN the execution ARN is an empty string, THE deriveWorkflowSpanId function SHALL throw an Error; THE function SHALL only validate for emptiness and SHALL NOT validate ARN format
4. THE deriveSpanIdFromOperationId function SHALL compute SHA-256 of executionArn + ":" + operationId and return the first 16 hex characters
5. THE deriveSpanIdFromOperationId function SHALL include the executionArn in the hash input to avoid span ID collisions when different executions share the same trace

### Requirement 8: Context Extractors

**User Story:** As a developer, I want the plugin to extract upstream trace context from multiple sources, so that traces are correlated with the invoking system.

#### Acceptance Criteria

1. THE xRayContextExtractor SHALL read the \_X_AMZN_TRACE_ID environment variable
2. WHEN \_X_AMZN_TRACE_ID is not set, THE xRayContextExtractor SHALL return undefined
3. THE xRayContextExtractor SHALL parse the Root field into a 32-character hex traceId by stripping "1-" prefix and removing dashes
4. THE xRayContextExtractor SHALL parse the Parent field into a 16-character hex parentSpanId
5. WHEN the Root field is missing or the resulting traceId is not valid 32-character hex, THE xRayContextExtractor SHALL return undefined
6. THE w3cClientContextExtractor SHALL read traceparent from info.context.clientContext.custom.traceparent; WHEN any part of the path info.context.clientContext.custom.traceparent is missing, THE extractor SHALL return undefined without attempting alternative locations
7. THE w3cClientContextExtractor SHALL parse the W3C traceparent format (version-traceId-parentId-flags) into traceId, parentSpanId, and traceFlags
8. WHEN clientContext or traceparent is missing or malformed, THE w3cClientContextExtractor SHALL return undefined
9. WHEN no contextExtractor is configured, THE Plugin SHALL always default to xRayContextExtractor regardless of other system state

### Requirement 9: Workflow Span Lifecycle

**User Story:** As a developer, I want a single root Workflow span that represents the entire durable execution, so that all operations are grouped under one trace root.

#### Acceptance Criteria

1. WHEN onInvocationStart is called, THE Plugin SHALL create a Workflow_Span with the configured workflowSpanName (defaulting to "Workflow")
2. THE Plugin SHALL create the Workflow_Span in ROOT_CONTEXT so it never has a parent span
3. WHEN executionStartTimestamp is available in InvocationInfo, THE Plugin SHALL use it as the Workflow_Span start time
4. WHEN executionStartTimestamp is not available, THE Plugin SHALL use new Date() as the Workflow_Span start time
5. THE Plugin SHALL set the "durable.execution.arn" attribute on the Workflow_Span
6. THE Plugin SHALL derive a deterministic span ID for the Workflow_Span using deriveWorkflowSpanId(executionArn)
7. WHEN onInvocationEnd status is SUCCEEDED or FAILED, THE Plugin SHALL set "durable.execution.status" attribute and end the Workflow_Span (causing export)
8. WHEN onInvocationEnd status is PENDING or RETRYING, THE Plugin SHALL drop the Workflow_Span reference without ending it (preventing export); spans SHALL remain indefinitely until onInvocationEnd is called with a terminal status
9. WHEN onInvocationEnd is called without a prior onInvocationStart (no Workflow_Span exists), THE Plugin SHALL ignore the call without error

### Requirement 10: Invocation Span Management

**User Story:** As a developer, I want an Invocation span with Lambda semantic attributes, so that I can correlate spans with specific Lambda invocations.

#### Acceptance Criteria

1. WHEN useDefaultTracerProvider is false, THE Plugin SHALL create an Invocation_Span as a child of the Workflow_Span
2. WHEN useDefaultTracerProvider is true, THE Plugin SHALL NOT create an Invocation_Span
3. THE Plugin SHALL set the following attributes on the Invocation_Span only when the span is created: faas.invocation_id, faas.coldstart, cloud.provider ("aws"), cloud.platform ("aws_lambda"), durable.execution.arn
4. WHEN AWS_LAMBDA_FUNCTION_NAME is set, THE Plugin SHALL compute and set cloud.resource_id as an ARN in format "arn:aws:lambda:{region}:{accountId}:function:{functionName}:{version}"
5. THE Plugin SHALL extract the account ID from the execution ARN (5th colon-separated segment)
6. WHEN AWS_LAMBDA_FUNCTION_MEMORY_SIZE is set, THE Plugin SHALL parse it as an integer and set faas.max_memory attribute
7. THE Plugin SHALL end the Invocation_Span in onInvocationEnd regardless of terminal status

### Requirement 11: Cold Start Tracking

**User Story:** As a developer, I want cold start detection on invocation spans, so that I can identify performance impacts of Lambda cold starts.

#### Acceptance Criteria

1. THE Plugin SHALL initialize isColdStart to true on construction
2. WHEN the first onInvocationStart is called, THE Plugin SHALL set faas.coldstart to true on the Invocation_Span
3. AFTER the first onInvocationStart completes, THE Plugin SHALL set isColdStart to false
4. WHEN subsequent onInvocationStart calls occur, THE Plugin SHALL set faas.coldstart to false on the Invocation_Span

### Requirement 12: Trace ID Resolution in onInvocationStart

**User Story:** As a developer, I want the plugin to resolve the trace ID from context extractors or ARN derivation, so that all spans in the execution share a consistent trace ID.

#### Acceptance Criteria

1. WHEN the context extractor returns a traceId, THE Plugin SHALL set that traceId on the DeterministicIdGenerator
2. WHEN the context extractor returns undefined or no traceId, THE Plugin SHALL derive a traceId from the execution ARN using deriveTraceIdFromArn and set it on the DeterministicIdGenerator
3. THE Plugin SHALL store the execution ARN from InvocationInfo for use in subsequent lifecycle hooks

### Requirement 13: wrapInvocation Context Propagation

**User Story:** As a developer, I want the Workflow span set as active context during invocation execution, so that auto-instrumented spans become children of the Workflow span.

#### Acceptance Criteria

1. WHEN wrapInvocation is called and a Workflow_Span exists, THE Plugin SHALL explicitly set the Workflow_Span as the active span in the context and execute the function within that modified context
2. WHEN wrapInvocation is called and no Workflow_Span exists, THE Plugin SHALL execute the function without modifying the context

### Requirement 14: Operation Span Creation

**User Story:** As a developer, I want operation spans with deterministic IDs and proper parent resolution, so that operations form a correct hierarchy under the Workflow span.

#### Acceptance Criteria

1. WHEN onOperationStart is called, THE Plugin SHALL derive a deterministic span ID using deriveSpanIdFromOperationId(operationId, executionArn)
2. THE Plugin SHALL use the operation name as the span name, falling back to the operation type if no name is provided
3. WHEN the operation has a parentId and that parent exists in the SpanMap, THE Plugin SHALL create the Operation_Span as a child of the parent span
4. WHEN the operation has no parentId or the parent is not in the SpanMap, THE Plugin SHALL create the Operation_Span as a child of the Workflow_Span
5. THE Plugin SHALL set attributes: durable.execution.arn, durable.operation.id, durable.operation.type
6. WHEN operation name is provided, THE Plugin SHALL set durable.operation.name attribute
7. WHEN operation subType is provided, THE Plugin SHALL set durable.operation.subtype attribute
8. THE Plugin SHALL add invocation span links to the Operation_Span using buildInvocationLinks
9. THE Plugin SHALL store the created span in the SpanMap keyed by operation ID
10. WHEN startTimestamp is available in OperationInfo, THE Plugin SHALL use it as the span start time

### Requirement 15: Operation Span Completion and Cross-Invocation Stitching

**User Story:** As a developer, I want operations that started in prior invocations to be properly represented in the trace, so that the full execution history is captured.

#### Acceptance Criteria

1. WHEN onOperationEnd is called and the operation ID exists in the SpanMap, THE Plugin SHALL end that span with the provided endTimestamp
2. WHEN the operation has an error, THE Plugin SHALL set ERROR status with the error message and record the exception on the span, including on cross-invocation stitched spans
3. WHEN onOperationEnd is called and the operation ID does NOT exist in the SpanMap, THE Plugin SHALL create a new span with the deterministic ID, set its attributes, and immediately end it (cross-invocation stitching)
4. THE Plugin SHALL resolve the parent span for cross-invocation spans using the same logic as onOperationStart (parentId lookup then Workflow_Span fallback)
5. THE Plugin SHALL add invocation span links to cross-invocation stitched spans
6. THE Plugin SHALL remove the span from the SpanMap after ending it

### Requirement 16: Attempt Span Management

**User Story:** As a developer, I want attempt spans nested under their operation spans, so that I can observe individual retry attempts with their outcomes.

#### Acceptance Criteria

1. WHEN onOperationAttemptStart is called, THE Plugin SHALL create an Attempt_Span as a child of the corresponding Operation_Span from the SpanMap
2. THE Plugin SHALL name the Attempt_Span as "{name} attempt {attemptNumber}" (using operation type if no name)
3. THE Plugin SHALL set attributes: durable.execution.arn, durable.operation.id, durable.operation.type, durable.operation.attempt
4. WHEN operation name is provided, THE Plugin SHALL set durable.operation.name attribute on the Attempt_Span
5. WHEN operation subType is provided, THE Plugin SHALL set durable.operation.subtype attribute on the Attempt_Span
6. THE Plugin SHALL add invocation span links to the Attempt_Span
7. THE Plugin SHALL store the Attempt_Span reference for use by wrapOperationAttemptFn
8. WHEN onOperationAttemptEnd is called, THE Plugin SHALL set durable.attempt.outcome attribute and end the Attempt_Span; IF setting the outcome attribute fails, THE Plugin SHALL still end the span
9. WHEN the attempt has an error, THE Plugin SHALL set ERROR status and record the exception on the Attempt_Span
10. WHEN onOperationAttemptEnd completes, THE Plugin SHALL clear the attemptSpan reference

### Requirement 17: wrapOperationAttemptFn Context Propagation

**User Story:** As a developer, I want the attempt span set as active context during attempt execution, so that auto-instrumented calls within attempts are correctly parented.

#### Acceptance Criteria

1. WHEN wrapOperationAttemptFn is called and an attemptSpan exists, THE Plugin SHALL execute the function within a context where the attemptSpan is the active span
2. WHEN wrapOperationAttemptFn is called and no attemptSpan exists, THE Plugin SHALL execute the function without modifying the context

### Requirement 18: wrapChildContextFn for CONTEXT-Type Operations

**User Story:** As a developer, I want CONTEXT-type operations to create active execution spans, so that nested durable operations inside child contexts are correctly parented.

#### Acceptance Criteria

1. WHEN wrapChildContextFn is called with a CONTEXT-type operation, THE Plugin SHALL create a Context_Execution_Span named "{name} execution" using startActiveSpan
2. THE Plugin SHALL set the Context_Execution_Span's parent to the CONTEXT Operation_Span from the SpanMap
3. THE Plugin SHALL set attributes on the Context_Execution_Span only after successfully creating it: durable.execution.arn, durable.operation.id, durable.operation.type, and durable.operation.name (if available); IF span creation fails, THEN attribute setting SHALL be skipped
4. THE Plugin SHALL add invocation span links to the Context_Execution_Span
5. WHEN wrapChildContextFn is called with a non-CONTEXT-type operation, THE Plugin SHALL set the operation span from the SpanMap as active context for the function execution
6. WHEN wrapChildContextFn is called and no operation span exists in the SpanMap, THE Plugin SHALL execute the function without modifying the context; other span operations SHALL still be allowed to proceed

### Requirement 19: Span Links Strategy

**User Story:** As a developer, I want operation spans linked to the invocation span, so that I can correlate operations with the invocation that processed them.

#### Acceptance Criteria

1. WHEN useDefaultTracerProvider is true and savedInvocationContext contains a span, THE Plugin SHALL build a link to that ambient span
2. WHEN useDefaultTracerProvider is false and an explicit invocationSpan exists, THE Plugin SHALL build a link to that invocationSpan
3. WHEN neither condition is met, THE Plugin SHALL return an empty invocation links array; this applies only to invocation links and does not prevent other link types from being added
4. THE Plugin SHALL add invocation links to: Operation_Span, Attempt_Span, and Context_Execution_Span
5. THE Plugin SHALL NOT add links to the Workflow_Span

### Requirement 20: Default Provider Mode (useDefaultTracerProvider)

**User Story:** As a developer using ADOT Lambda layer, I want the plugin to integrate with the existing global TracerProvider, so that durable execution spans coexist with auto-instrumented spans.

#### Acceptance Criteria

1. WHEN useDefaultTracerProvider is true, THE Plugin SHALL capture the ambient context via context.active() during the onInvocationStart event (not at construction time) and store it as savedInvocationContext
2. WHEN useDefaultTracerProvider is true, THE Plugin SHALL NOT create an Invocation_Span unless no ambient span exists in the captured context, in which case it MAY create an Invocation_Span as a fallback
3. WHEN useDefaultTracerProvider is true, THE Plugin SHALL use the captured ambient invocation span for building links (if one exists in savedInvocationContext)

### Requirement 21: Per-Invocation State Management

**User Story:** As a developer, I want all per-invocation state properly cleaned up at invocation end, so that state does not leak between invocations in the same Lambda container.

#### Acceptance Criteria

1. WHEN onInvocationEnd is called, THE Plugin SHALL clear the SpanMap
2. WHEN onInvocationEnd is called, THE Plugin SHALL clear the workflowSpan reference
3. WHEN onInvocationEnd is called, THE Plugin SHALL clear the invocationSpan reference
4. WHEN onInvocationEnd is called, THE Plugin SHALL clear the savedInvocationContext reference
5. WHEN onInvocationEnd is called, THE Plugin SHALL reset the executionArn to empty string
6. WHEN onInvocationEnd is called, THE Plugin SHALL clear the attemptSpan reference

### Requirement 22: TracerProvider Flush at Invocation Boundary

**User Story:** As a developer, I want spans flushed at the end of each invocation, so that spans are exported before the Lambda environment freezes.

#### Acceptance Criteria

1. WHEN onInvocationEnd is called and the TracerProvider has a forceFlush method, THE Plugin SHALL call forceFlush; THE Plugin relies on the Lambda runtime or application code to call onInvocationEnd
2. IF forceFlush throws an error, THEN THE Plugin SHALL log the error to console.error and continue without propagating the error
3. THE Plugin SHALL call forceFlush before clearing per-invocation state; WHEN the TracerProvider lacks a forceFlush method, THE Plugin SHALL skip the flush and still proceed to clear per-invocation state

### Requirement 23: enrichLogContext

**User Story:** As a developer, I want structured trace context injected into log entries, so that I can correlate logs with traces in my observability platform.

#### Acceptance Criteria

1. WHEN a span is active in the current context, THE Plugin SHALL return an object with traceId, spanId, and otelTraceSampled fields, including for unsampled traces
2. THE Plugin SHALL extract traceId and spanId from the active span's spanContext
3. THE Plugin SHALL compute otelTraceSampled as a boolean from (traceFlags & 1) !== 0
4. WHEN no span is active in the current context, THE Plugin SHALL return undefined (not an empty object)

### Requirement 24: Configuration Defaults

**User Story:** As a developer, I want sensible defaults for all optional configuration, so that the plugin works with zero configuration.

#### Acceptance Criteria

1. WHEN no contextExtractor is configured, THE Plugin SHALL default to xRayContextExtractor
2. WHEN no instrumentationName is configured, THE Plugin SHALL default to "aws-durable-execution-sdk-js"
3. WHEN no enableHttpInstrumentation is configured, THE Plugin SHALL default to true (HTTP instrumentation enabled)
4. WHEN no propagators are configured, THE Plugin SHALL default to [AWSXRayPropagator, W3CTraceContextPropagator]
5. WHEN no useDefaultTracerProvider is configured, THE Plugin SHALL default to false
6. WHEN no workflowSpanName is configured, THE Plugin SHALL default to "Workflow"

### Requirement 25: Shared Configuration Interface

**User Story:** As a developer maintaining both OTel plugins, I want a single configuration interface shared between ExecutionOtelPlugin and InvocationOtelPlugin, so that configuration options are consistent and not duplicated across plugins.

#### Acceptance Criteria

1. THE ExecutionOtelPluginConfig interface SHALL be the canonical configuration type used by both ExecutionOtelPlugin and InvocationOtelPlugin
2. THE InvocationOtelPlugin SHALL accept ExecutionOtelPluginConfig (or a compatible subset) as its config parameter, replacing its current InvocationOtelPluginConfig interface
3. THE shared config interface SHALL include at minimum: tracerProvider, contextExtractor, instrumentationName, enableHttpInstrumentation, exporterConfig, propagators, useDefaultTracerProvider, and workflowSpanName
4. WHEN the InvocationOtelPlugin receives configuration fields that are only relevant to ExecutionOtelPlugin (e.g., workflowSpanName), THE InvocationOtelPlugin SHALL ignore those fields without error
5. THE InvocationOtelPluginConfig interface SHALL be deprecated or removed in favor of the shared ExecutionOtelPluginConfig

### Requirement 26: Shared TracerProvider Factory

**User Story:** As a developer maintaining both OTel plugins, I want a single TracerProvider factory function used by both plugins, so that provider resolution logic (explicit → global → auto-configured) is consistent and not duplicated.

#### Acceptance Criteria

1. THE createTracerProvider factory function SHALL be used by both ExecutionOtelPlugin and InvocationOtelPlugin to resolve their TracerProvider
2. WHEN InvocationOtelPlugin is constructed without a custom tracerProvider, THE InvocationOtelPlugin SHALL use createTracerProvider to obtain a TracerProvider following the same 3-level priority resolution as ExecutionOtelPlugin (explicit tracerProvider → useDefaultTracerProvider → auto-configured)
3. THE InvocationOtelPlugin SHALL default useDefaultTracerProvider to true when no explicit tracerProvider is provided and useDefaultTracerProvider is not set in config, preserving its current default behavior of using the global provider
4. THE createTracerProvider function SHALL return the same ProviderResult structure (tracerProvider + ownsProvider) for both plugins
5. THE InvocationOtelPlugin SHALL remove its inline TracerProvider resolution logic (the if/else block that checks config.tracerProvider vs trace.getTracerProvider()) and delegate entirely to createTracerProvider

### Requirement 27: Shared Instrumentation Registration

**User Story:** As a developer maintaining both OTel plugins, I want a single instrumentation registration function used by both plugins, so that AWS SDK and HTTP instrumentation setup is consistent and not duplicated.

#### Acceptance Criteria

1. THE registerStandaloneInstrumentations function SHALL be used by both ExecutionOtelPlugin and InvocationOtelPlugin to register instrumentations
2. WHEN InvocationOtelPlugin is constructed without a custom tracerProvider and useDefaultTracerProvider is false, THE InvocationOtelPlugin SHALL call registerStandaloneInstrumentations to register AWS SDK and HTTP instrumentations
3. WHEN InvocationOtelPlugin uses the global TracerProvider (useDefaultTracerProvider=true or no explicit provider), THE InvocationOtelPlugin SHALL still register AwsInstrumentation with the global provider (preserving current behavior) via registerStandaloneInstrumentations
4. THE InvocationOtelPlugin SHALL remove its inline AwsInstrumentation registration code and delegate entirely to registerStandaloneInstrumentations
5. THE registerStandaloneInstrumentations function SHALL support being called with useDefaultTracerProvider=true for InvocationOtelPlugin's use case, registering only AwsInstrumentation (not HTTP instrumentation) when the global provider is in use
6. WHEN a custom tracerProvider is explicitly provided in config, THE registerStandaloneInstrumentations function SHALL skip all instrumentation registration (consistent with current behavior for both plugins)

### Requirement 28: Shared Module Structure

**User Story:** As a developer re-implementing this package, I want clear module boundaries for shared code, so that I know which files contain shared helpers vs plugin-specific logic.

#### Acceptance Criteria

1. THE shared configuration interface SHALL be defined in a dedicated module (e.g., execution-plugin-config.ts) that is imported by both plugins
2. THE shared TracerProvider factory SHALL be defined in a dedicated module (e.g., execution-plugin-provider.ts) that is imported by both plugins
3. THE shared instrumentation registration SHALL be defined in a dedicated module (e.g., execution-plugin-instrumentations.ts) that is imported by both plugins
4. THE shared modules SHALL NOT import from either plugin's implementation module (no circular dependencies) AND SHALL be independently testable without requiring either plugin class to be instantiated; both constraints must be satisfied together
5. THE package index.ts SHALL export the shared config type (ExecutionOtelPluginConfig), context extractors, and deterministic ID utilities as public API for both plugin consumers
