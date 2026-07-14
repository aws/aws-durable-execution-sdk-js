# Requirements Document

## Introduction

This feature adds a configuration option to the `StandaloneOtelPlugin` that allows it to fetch and use the default (global) OpenTelemetry `TracerProvider` instead of always creating its own internal provider. This enables users who have already configured a global `TracerProvider` (e.g., via the OpenTelemetry SDK's `NodeTracerProvider.register()`) to reuse it with the standalone plugin without duplicating setup or passing explicit references.

## Glossary

- **Standalone_Plugin**: The `StandaloneOtelPlugin` class that provides self-contained OpenTelemetry instrumentation for durable executions without relying on the ADOT Lambda layer.
- **Tracer_Provider**: An OpenTelemetry `TracerProvider` instance responsible for creating `Tracer` objects and managing span export pipelines.
- **Default_Tracer_Provider**: The globally registered `TracerProvider` accessible via `trace.getTracerProvider()` from the `@opentelemetry/api` package.
- **Plugin_Config**: The `StandaloneOtelPluginConfig` interface that defines configuration options for the `StandaloneOtelPlugin`.
- **Auto_Setup**: The internal provider creation logic (OTLP exporter, propagators, instrumentations) performed by the Standalone_Plugin when no custom Tracer_Provider is supplied.

## Requirements

### Requirement 1: Use Default Tracer Provider Option

**User Story:** As a developer, I want to configure the StandaloneOtelPlugin to use the globally registered TracerProvider, so that I can reuse my existing OpenTelemetry setup without passing an explicit provider reference.

#### Acceptance Criteria

1. WHEN the `useDefaultTracerProvider` option is set to `true` in the Plugin_Config, THE Standalone_Plugin SHALL retrieve the Default_Tracer_Provider via `trace.getTracerProvider()` and use it as its Tracer_Provider.
2. WHEN the `useDefaultTracerProvider` option is set to `true`, THE Standalone_Plugin SHALL skip all Auto_Setup including exporter creation, propagator registration, sampler registration, and instrumentation registration (HTTP and AWS SDK instrumentations).
3. WHEN the `useDefaultTracerProvider` option is set to `true`, THE Standalone_Plugin SHALL set `ownsProvider` to `false`, indicating the plugin does not manage the provider lifecycle.
4. WHEN the `useDefaultTracerProvider` option is not provided or is set to `false`, THE Standalone_Plugin SHALL maintain its current behavior (create an internal provider or use an explicitly supplied `tracerProvider`).
5. IF both `useDefaultTracerProvider` is set to `true` and an explicit `tracerProvider` is supplied in the Plugin_Config, THEN THE Standalone_Plugin SHALL use the explicitly supplied `tracerProvider` and ignore the `useDefaultTracerProvider` option.

### Requirement 2: Configuration Precedence

**User Story:** As a developer, I want clear precedence rules when multiple provider options are specified, so that the plugin behavior is predictable and unambiguous.

#### Acceptance Criteria

1. WHEN both `tracerProvider` and `useDefaultTracerProvider` are specified in the Plugin_Config, THE Standalone_Plugin SHALL use the explicitly provided `tracerProvider`, ignore the `useDefaultTracerProvider` option, and skip all auto-setup (no exporter, propagators, or instrumentations are registered by the plugin).
2. WHEN only `useDefaultTracerProvider` is set to `true` (and no explicit `tracerProvider` is provided), THE Standalone_Plugin SHALL retrieve and use the globally registered TracerProvider from the OpenTelemetry API and skip auto-setup of exporters, propagators, and instrumentations.
3. WHEN neither `tracerProvider` nor `useDefaultTracerProvider` is provided in the Plugin_Config, THE Standalone_Plugin SHALL create and manage its own internal Tracer_Provider configured with an OTLP exporter, span processor, sampler, propagators, and HTTP/AWS SDK instrumentations.
4. IF `useDefaultTracerProvider` is set to `false` and no explicit `tracerProvider` is provided, THEN THE Standalone_Plugin SHALL behave identically to when neither option is provided (creating its own internal Tracer_Provider with auto-setup).
5. WHEN the Standalone_Plugin uses a user-provided `tracerProvider`, THE Standalone_Plugin SHALL still call `forceFlush()` at invocation boundaries but SHALL NOT call `shutdown()` on that provider, delegating shutdown lifecycle management to the caller.

### Requirement 3: Instrumentation Registration Behavior

**User Story:** As a developer, I want to understand whether auto-instrumentations are registered when using the default tracer provider, so that I can avoid duplicate instrumentation registration in my application.

#### Acceptance Criteria

1. WHEN `useDefaultTracerProvider` is set to `true`, THE Standalone_Plugin SHALL skip registration of HTTP and AWS SDK instrumentations by returning from `registerStandaloneInstrumentations` without calling `registerInstrumentations()`.
2. WHEN `useDefaultTracerProvider` is set to `true`, THE Standalone_Plugin SHALL skip propagator registration by not calling `tracerProvider.register()` with a propagator and not calling `propagation.setGlobalPropagator()`.
3. WHEN `useDefaultTracerProvider` is set to `true`, THE Standalone_Plugin SHALL NOT modify, remove, or override any instrumentations or propagators previously registered by the application on the Default_Tracer_Provider.

### Requirement 4: Flush Behavior with Default Provider

**User Story:** As a developer, I want the plugin to handle span flushing correctly when using the default tracer provider, so that spans are exported reliably at invocation boundaries.

#### Acceptance Criteria

1. WHEN an invocation ends, THE Standalone_Plugin SHALL call `forceFlush()` on the TracerProvider regardless of whether the provider is owned internally, supplied explicitly, or retrieved as the Default_Tracer_Provider.
2. WHEN an invocation ends, THE Standalone_Plugin SHALL NOT call `shutdown()` on a TracerProvider it does not own (i.e., when `ownsProvider` is `false`).
3. IF `forceFlush()` is called and the flush operation throws an error, THEN THE Standalone_Plugin SHALL log the error and continue clearing per-invocation state without propagating the exception to the caller.
4. WHEN an invocation ends, THE Standalone_Plugin SHALL clear all per-invocation span references regardless of whether the TracerProvider is owned or externally supplied.

### Requirement 5: Workflow Span as Root Span with Invocation Links on Child Spans

**User Story:** As a developer, I want the workflow span to be a self-contained root span, with invocation traceability preserved via links on the operation-level spans, so that the durable execution trace tree is independent but each operation can be correlated back to the triggering invocation.

#### Acceptance Criteria

1. WHEN `useDefaultTracerProvider` is set to `true`, THE Standalone_Plugin SHALL capture and save the current active context (representing the invocation span created by the environment/layer) BEFORE creating or activating the Workflow_Span.
2. WHEN the Standalone_Plugin creates the Workflow_Span, THE Standalone_Plugin SHALL create it as a root span using `ROOT_CONTEXT` (no parent), regardless of any active span context propagated by the TracerProvider.
3. THE Standalone_Plugin SHALL NOT add a span link from the Workflow_Span to the saved invocation context.
4. WHEN a saved invocation context exists, THE Standalone_Plugin SHALL add a span link to the saved invocation span on each Operation_Span it creates.
5. WHEN a saved invocation context exists, THE Standalone_Plugin SHALL add a span link to the saved invocation span on each Operation Attempt_Span it creates.
6. WHEN a saved invocation context exists, THE Standalone_Plugin SHALL add a span link to the saved invocation span on each Context_Execution_Span it creates.
7. WHEN `useDefaultTracerProvider` is set to `true`, THE Standalone_Plugin SHALL NOT create an explicit Invocation_Span, relying instead on the ambient invocation span captured from the active context.
8. THE Standalone_Plugin SHALL ensure that all child spans (Operation_Spans, Attempt_Spans, Context_Execution_Spans) are parented under the Workflow_Span or its descendants, not under any ambient active span from the global context.

### Requirement 6: Tracer Creation from Default Provider

**User Story:** As a developer, I want the plugin to correctly create a tracer from the default provider, so that spans are attributed to the correct instrumentation scope.

#### Acceptance Criteria

1. WHEN no custom `tracerProvider` is supplied in the `StandaloneOtelPluginConfig`, THE Standalone_Plugin SHALL create a Tracer from the internally created Default_Tracer_Provider using the configured `instrumentationName`, defaulting to `"aws-durable-execution-sdk-js"` if `instrumentationName` is not specified.
2. WHEN a custom `tracerProvider` is supplied in the `StandaloneOtelPluginConfig`, THE Standalone_Plugin SHALL create a Tracer from the supplied TracerProvider using the configured `instrumentationName`, defaulting to `"aws-durable-execution-sdk-js"` if `instrumentationName` is not specified.
3. THE Standalone_Plugin SHALL assign the DeterministicIdGenerator instance to the Tracer's internal `_idGenerator` property so that all spans produced by the Tracer use deterministic trace and span IDs.
4. IF the Tracer is created successfully, THEN THE Standalone_Plugin SHALL use that single Tracer instance for all span creation operations (Workflow_Span, Invocation_Span, Operation_Spans, and Attempt_Spans) within the plugin's lifetime.
