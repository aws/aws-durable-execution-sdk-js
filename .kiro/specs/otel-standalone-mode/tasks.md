# Implementation Plan: StandaloneOtelPlugin

## Overview

Implement a self-contained OpenTelemetry instrumentation plugin (`StandaloneOtelPlugin`) for the `@aws/durable-execution-sdk-js-otel` package that provides full distributed tracing without requiring the ADOT Lambda layer's auto-instrumentation. The implementation follows a composition approach (new class, not subclass) with a synthetic Workflow_Span as the trace root, deferred operation span export, and zero-config defaults.

## Tasks

- [x] 1. Extend DeterministicIdGenerator with deriveWorkflowSpanId
  - [x] 1.1 Add `deriveWorkflowSpanId` function to `deterministic-id-generator.ts`
    - Implement the function that accepts an execution ARN string and returns a valid 16-character lowercase hexadecimal span ID
    - Use SHA-256 hashing with a distinct salt (e.g., `"workflow:"` prefix) to differentiate from `deriveSpanIdFromOperationId`
    - Throw an Error if the input is an empty string
    - Ensure the result is never all-zeros (`0000000000000000`)
    - Export the new function from `index.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [ ]\* 1.2 Write property tests for `deriveWorkflowSpanId`
    - **Property 1: deriveWorkflowSpanId produces valid deterministic output**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]\* 1.3 Write property test for collision resistance
    - **Property 2: deriveWorkflowSpanId collision resistance**
    - **Validates: Requirements 7.3**

- [x] 2. Create StandaloneOtelPluginConfig interface and TracerProvider setup
  - [x] 2.1 Create `standalone-plugin-config.ts` with the `StandaloneOtelPluginConfig` interface
    - Define `tracerProvider`, `contextExtractor`, `instrumentationName`, `enableHttpInstrumentation`, `exporterConfig` (with `endpoint` and `headers`), and `propagators` fields
    - All fields optional with sensible defaults documented in JSDoc
    - _Requirements: 6.2, 6.3, 8.6_

  - [x] 2.2 Create `standalone-plugin-provider.ts` for internal TracerProvider factory
    - Implement a factory function that creates and configures a `NodeTracerProvider` with:
      - `OTLPSpanExporter` targeting `http://localhost:4318/v1/traces` (or `OTEL_EXPORTER_OTLP_ENDPOINT` env var)
      - `BatchSpanProcessor` wrapping the exporter
      - `AWSXRayPropagator` + `W3C TraceContext` propagator registered as composite propagator
      - `TraceIdRatioBasedSampler` from `OTEL_DURABLE_SAMPLING_RATIO` env var (default `AlwaysOnSampler`)
      - Lambda resource detector when `AWS_LAMBDA_FUNCTION_NAME` is set
    - Skip all auto-setup when a custom `tracerProvider` is provided
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 6.1, 6.5_

  - [x] 2.3 Implement HTTP and AWS SDK instrumentation registration
    - Register `@opentelemetry/instrumentation-http` with hostname suppression for `127.0.0.1` and `AWS_LAMBDA_RUNTIME_API`
    - Register `@opentelemetry/instrumentation-aws-sdk` (existing)
    - Skip HTTP instrumentation when `enableHttpInstrumentation` is `false` or when custom `tracerProvider` is provided
    - _Requirements: 3.1, 3.2, 3.6, 6.4_

- [x] 3. Implement StandaloneOtelPlugin class core lifecycle
  - [x] 3.1 Create `standalone-plugin.ts` with `StandaloneOtelPlugin` class skeleton
    - Implement `DurableInstrumentationPlugin` interface
    - Initialize per-invocation state fields: `workflowSpan`, `invocationSpan`, `spanMap`, `executionArn`, `attemptSpan`, `contextExecutionCount`
    - Track `ownsProvider` flag and cold start detection
    - Wire constructor to use the provider factory from 2.2
    - Reuse existing `DeterministicIdGenerator` and context extractor utilities
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 3.2 Implement `onInvocationStart`
    - Derive workflow span ID from execution ARN using `deriveWorkflowSpanId`
    - Create Workflow_Span (in-memory) with deterministic ID and `durable.execution.arn` attribute
    - Set Workflow_Span start time to `executionStartTimestamp` from InvocationInfo
    - Create Invocation_Span as child of Workflow_Span with Lambda semantic attributes (`faas.invocation_id`, `faas.coldstart`, `cloud.resource_id`, `cloud.provider`, `cloud.platform`, `faas.max_memory`)
    - Extract trace context via context extractor (same as OtelPlugin)
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.8, 2.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.4_

  - [x] 3.3 Implement `onInvocationEnd`
    - Always end and export Invocation_Span
    - If status is SUCCEEDED or FAILED: set `durable.execution.status` attribute on Workflow_Span, end and export it
    - If status is PENDING or RETRYING: discard Workflow_Span without exporting
    - Discard all open Operation_Spans without exporting
    - Flush TracerProvider (when `ownsProvider` is true)
    - Clear per-invocation state
    - _Requirements: 1.3, 1.4, 1.7, 2.2, 2.5, 8.7, 9.4_

  - [x] 3.4 Implement `wrapInvocation`
    - Set Workflow_Span as active context for the wrapped function (so HTTP instrumentation sees it)
    - Return the function result unmodified
    - _Requirements: 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement operation and attempt span lifecycle
  - [x] 5.1 Implement `onOperationStart`
    - Create Operation_Span as child of Workflow_Span (or parent operation's span for nested contexts)
    - Use deterministic span ID from `deriveSpanIdFromOperationId`
    - Add span link to Invocation_Span
    - For replay CONTEXT/STEP: use random span ID with link to deterministic span (same branching as OtelPlugin)
    - Store span in `spanMap`
    - _Requirements: 2.3, 2.4, 9.1, 9.5, 8.8_

  - [x] 5.2 Implement `onOperationEnd`
    - Same-invocation: end Operation_Span with provided end timestamp, add span link to Invocation_Span
    - Cross-invocation (non-replay, not in spanMap): create span with deterministic ID, set start/end times, add link to Invocation_Span, export immediately
    - Skip replayed WAIT/INVOKE/CHAINED_INVOKE/CALLBACK
    - Record error if present (set status to ERROR, record exception)
    - _Requirements: 9.2, 9.3, 9.7, 9.8, 2.4_

  - [x] 5.3 Implement `onOperationAttemptStart` and `onOperationAttemptEnd`
    - Create Attempt_Span as child of the Operation_Span (using deterministic operation span ID as parent)
    - Add span link to Invocation_Span
    - Set `durable.operation.attempt` and other attributes
    - On end: set `durable.attempt.outcome`, record error if present, end span
    - _Requirements: 9.6, 2.4_

  - [x] 5.4 Implement `wrapOperationAttemptFn`
    - Set Attempt_Span as active context for the wrapped function
    - Return function result unmodified
    - _Requirements: 3.3, 8.8_

  - [ ]\* 5.5 Write property test for span hierarchy invariant
    - **Property 4: Span hierarchy invariant**
    - **Validates: Requirements 1.5, 2.3, 2.5**

  - [ ]\* 5.6 Write property test for operation/attempt span links
    - **Property 5: Operation and attempt spans link to invocation span**
    - **Validates: Requirements 2.4**

  - [ ]\* 5.7 Write property test for open spans discarded at invocation end
    - **Property 6: Open operation spans discarded at invocation end**
    - **Validates: Requirements 9.4**

  - [ ]\* 5.8 Write property test for cross-invocation operation span deterministic ID
    - **Property 7: Cross-invocation operation span uses deterministic ID**
    - **Validates: Requirements 9.3**

  - [ ]\* 5.9 Write property test for attempt span parent ID
    - **Property 8: Attempt spans parented under deterministic operation span ID**
    - **Validates: Requirements 9.6**

- [x] 6. Implement Context Execution Spans and remaining hooks
  - [x] 6.1 Implement `wrapChildContextFn` with Context_Execution_Span
    - For CONTEXT type operations: create Context_Execution_Span as child of the CONTEXT Operation_Span
    - Name: `{operationName} execution {N}` (1-based counter tracked in `contextExecutionCount` map)
    - Set as active context during wrapped function execution
    - End span when function completes; record error if thrown
    - Include same attributes as Operation_Span (`durable.execution.arn`, `durable.operation.id`, `durable.operation.type`, `durable.operation.name`)
    - For non-CONTEXT operations: delegate to same behavior as OtelPlugin (set operation span as active context)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 6.2 Implement `onOperationChange` and `enrichLogContext`
    - `onOperationChange`: no-op (same as OtelPlugin)
    - `enrichLogContext`: return traceId, spanId, otelTraceSampled from active span context (same as OtelPlugin)
    - _Requirements: 8.8_

  - [ ]\* 6.3 Write property test for Context_Execution_Span lifecycle
    - **Property 9: Context_Execution_Span lifecycle**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.7**

  - [ ]\* 6.4 Write property test for error recording
    - **Property 10: Error recording on operation and context execution spans**
    - **Validates: Requirements 9.8, 10.5**

  - [ ]\* 6.5 Write property test for span attributes
    - **Property 11: Span attributes match input data**
    - **Validates: Requirements 1.6, 4.1**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Wire exports, add dependencies, write unit tests
  - [x] 8.1 Export `StandaloneOtelPlugin` and `StandaloneOtelPluginConfig` from package index
    - Add named exports to `src/index.ts` alongside existing `OtelPlugin`
    - Verify existing `OtelPlugin` exports remain unchanged
    - _Requirements: 8.1, 8.2_

  - [x] 8.2 Update `package.json` with new peer/optional dependencies
    - Add `@opentelemetry/exporter-trace-otlp-http` as optional peer dependency
    - Add `@opentelemetry/propagator-aws-xray` as peer dependency
    - Add `@opentelemetry/instrumentation-http` as peer dependency
    - Add `@opentelemetry/resources` and `@opentelemetry/sdk-trace-base` as needed
    - _Requirements: 11.10_

  - [ ]\* 8.3 Write unit tests for StandaloneOtelPlugin
    - Test terminal vs non-terminal invocation end (export vs discard Workflow_Span)
    - Test `faas.coldstart` toggling
    - Test replay skipping for WAIT/INVOKE/CHAINED_INVOKE/CALLBACK
    - Test Lambda semantic convention attributes
    - Test custom TracerProvider bypass
    - Test `OTEL_DURABLE_SAMPLING_RATIO` sampler configuration
    - Test `OTEL_EXPORTER_OTLP_ENDPOINT` override
    - Test Workflow_Span start time uses `executionStartTimestamp`
    - _Requirements: 1.3, 1.4, 1.8, 4.2, 4.6, 4.7, 5.2, 5.7, 9.7_

  - [ ]\* 8.4 Write property test for Workflow_Span deterministic ID
    - **Property 3: Workflow span uses deterministic ID from execution ARN**
    - **Validates: Requirements 1.1, 1.2, 7.4**

- [x] 9. Write README documentation
  - [x] 9.1 Create or update README with StandaloneOtelPlugin documentation
    - Document minimal handler setup (`new StandaloneOtelPlugin()` with `withDurableExecution`)
    - Document export strategies (collector layer recommended, direct to CloudWatch, third-party)
    - Document IAM permissions per strategy
    - Document environment variables (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_DURABLE_SAMPLING_RATIO`, `AWS_LAMBDA_FUNCTION_NAME`, `AWS_REGION`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`)
    - Include SAM/CloudFormation template snippets for each export strategy
    - Document `StandaloneOtelPluginConfig` interface options
    - Include trace structure diagram (Workflow_Span → Invocation_Span → Operation_Span → Attempt_Span)
    - Include "Migration from OtelPlugin" section
    - Document additional npm dependencies
    - Include "Collector Layer Setup" section with Option A (OTel community layer) and Option B (legacy ADOT)
    - Explain why a collector layer is required
    - Include sample `collector.yaml` configuration
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation reuses existing `DeterministicIdGenerator`, `ContextExtractor`, and test helpers from the package
- TypeScript is the implementation language (matching the existing codebase)
- Test framework: Jest with `fast-check` for property-based tests (both already in devDependencies)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["5.5", "5.6", "5.7", "5.8", "5.9", "6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5", "8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3", "8.4"] },
    { "id": 8, "tasks": ["9.1"] }
  ]
}
```
