# Implementation Plan: Use Default Tracer Provider in StandaloneOtelPlugin

## Overview

This plan implements the `useDefaultTracerProvider` configuration option for `StandaloneOtelPlugin`. The implementation modifies the config interface, provider resolution factory, instrumentation registration guard, and the plugin's invocation lifecycle to support using the globally registered `TracerProvider` instead of creating an internal one. Span links replace the explicit Invocation_Span when in default-provider mode.

## Tasks

- [x] 1. Extend configuration interface and provider resolution
  - [x] 1.1 Add `useDefaultTracerProvider` field to `StandaloneOtelPluginConfig`
    - Add `useDefaultTracerProvider?: boolean` to the interface in `standalone-plugin-config.ts`
    - Include JSDoc describing precedence: explicit `tracerProvider` > `useDefaultTracerProvider` > auto-created
    - _Requirements: 1.1, 1.4, 2.1_

  - [x] 1.2 Update `createTracerProvider` to handle `useDefaultTracerProvider`
    - Add Priority 2 branch in `standalone-plugin-provider.ts`: when `config?.useDefaultTracerProvider` is true (and no explicit `tracerProvider`), return `{ tracerProvider: trace.getTracerProvider(), ownsProvider: false }`
    - Import `trace` from `@opentelemetry/api`
    - Ensure Priority 1 (explicit provider) still takes precedence
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2_

  - [x] 1.3 Update `registerStandaloneInstrumentations` guard condition
    - Expand the early-return guard in `standalone-plugin-instrumentations.ts` to also return when `config?.useDefaultTracerProvider` is true
    - _Requirements: 1.2, 3.1, 3.2, 3.3_

- [x] 2. Modify plugin invocation lifecycle
  - [x] 2.1 Add `savedInvocationContext` field and `useDefaultTracerProvider` flag to `StandaloneOtelPlugin`
    - Add `private savedInvocationContext: Context | undefined` field
    - Add `private readonly useDefaultTracerProvider: boolean` field, set from config in the constructor
    - Import `Context` type from `@opentelemetry/api`
    - _Requirements: 5.1_

  - [x] 2.2 Update `onInvocationStart` to capture ambient context and skip Invocation_Span
    - When `this.useDefaultTracerProvider` is true: save `context.active()` to `this.savedInvocationContext` BEFORE creating Workflow_Span
    - Wrap the existing Invocation_Span creation logic in `if (!this.useDefaultTracerProvider)` guard
    - Workflow_Span creation remains unchanged (ROOT_CONTEXT, deterministic ID)
    - _Requirements: 5.1, 5.2, 5.7, 5.8_

  - [x] 2.3 Create `buildInvocationLinks()` helper method
    - Private method that returns `Link[]`
    - If `this.useDefaultTracerProvider && this.savedInvocationContext`: extract span via `trace.getSpan(this.savedInvocationContext)` and return link to its SpanContext
    - Else if `this.invocationSpan`: return link to its SpanContext
    - Otherwise return `[]`
    - Import `Link` type from `@opentelemetry/api`
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

  - [x] 2.4 Update span creation methods to use `buildInvocationLinks()`
    - Replace inline invocation link construction in `onOperationStart` with `this.buildInvocationLinks()`
    - Replace inline invocation link construction in `onOperationAttemptStart` with `this.buildInvocationLinks()`
    - Replace inline invocation link construction in `wrapChildContextFn` (Context_Execution_Span) with `this.buildInvocationLinks()`
    - Replace inline invocation link construction in `onOperationEnd` (cross-invocation continuation span) with `this.buildInvocationLinks()`
    - _Requirements: 5.4, 5.5, 5.6, 5.8_

  - [x] 2.5 Update `onInvocationEnd` to always call `forceFlush` and never `shutdown` unowned providers
    - Remove the `if (this.ownsProvider)` guard around `forceFlush()` — always call it
    - Ensure `shutdown()` is never called on providers where `ownsProvider` is false
    - Add `this.savedInvocationContext = undefined` to state cleanup
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 2.5_

- [x] 3. Checkpoint - Verify build and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Property-based tests for correctness properties
  - [x]\* 4.1 Write property test: Provider resolution precedence (Property 1)
    - **Property 1: Provider resolution precedence**
    - Generate random configs with both `tracerProvider` and `useDefaultTracerProvider: true`; assert explicit provider is always used
    - **Validates: Requirements 1.5, 2.1**

  - [x]\* 4.2 Write property test: Default provider retrieval (Property 2)
    - **Property 2: Default provider retrieval**
    - Generate configs with `useDefaultTracerProvider: true` (no explicit provider); assert resolved provider === `trace.getTracerProvider()`
    - **Validates: Requirements 1.1, 2.2**

  - [x]\* 4.3 Write property test: Backward compatibility (Property 3)
    - **Property 3: Backward compatibility when option is absent or false**
    - Generate configs where `useDefaultTracerProvider` is absent or false (no explicit provider); assert `ownsProvider === true`
    - **Validates: Requirements 1.4, 2.3, 2.4**

  - [x]\* 4.4 Write property test: ForceFlush always called (Property 4)
    - **Property 4: ForceFlush always called at invocation boundaries**
    - Mock TracerProvider with spy on `forceFlush`; run `onInvocationEnd` across owned/explicit/default modes; assert `forceFlush` always called
    - **Validates: Requirements 4.1, 2.5**

  - [x]\* 4.5 Write property test: Shutdown never called on unowned providers (Property 5)
    - **Property 5: Shutdown never called on unowned providers**
    - Mock TracerProvider with spy on `shutdown`; run multiple invocation lifecycles with `ownsProvider=false`; assert `shutdown` never called
    - **Validates: Requirements 4.2, 2.5**

  - [x]\* 4.6 Write property test: Per-invocation state cleared (Property 6)
    - **Property 6: Per-invocation state cleared on invocation end**
    - Generate random invocation sequences; after `onInvocationEnd`, assert all per-invocation fields are cleared
    - **Validates: Requirements 4.4**

  - [x]\* 4.7 Write property test: Workflow_Span is always root (Property 7)
    - **Property 7: Workflow_Span is always a root span**
    - Use InMemorySpanExporter; create plugin with various active contexts; assert Workflow_Span has no parentSpanId
    - **Validates: Requirements 5.2, 5.8**

  - [x]\* 4.8 Write property test: Span links on child spans (Property 8)
    - **Property 8: Span links to saved invocation context on child spans**
    - With `useDefaultTracerProvider=true` and a mock ambient span, create operation/attempt/context spans; assert each has link to saved invocation span
    - **Validates: Requirements 5.4, 5.5, 5.6**

  - [x]\* 4.9 Write property test: Deterministic ID generator applied (Property 9)
    - **Property 9: Deterministic ID generator applied regardless of provider source**
    - Across all 3 provider modes (owned, explicit, default), assert `tracer._idGenerator` is a `DeterministicIdGenerator` instance
    - **Validates: Requirements 6.3, 6.1**

- [x] 5. Unit tests for new behavior paths
  - [x] 5.1 Write unit tests for provider resolution and instrumentation skipping
    - Test `useDefaultTracerProvider=true` skips exporter, propagator, and instrumentation registration
    - Test `ownsProvider=false` when `useDefaultTracerProvider=true`
    - Test precedence: explicit `tracerProvider` wins over `useDefaultTracerProvider`
    - Test `useDefaultTracerProvider=false` behaves same as absent
    - _Requirements: 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

  - [x] 5.2 Write unit tests for invocation lifecycle in default-provider mode
    - Test no Invocation_Span is created when `useDefaultTracerProvider=true`
    - Test Workflow_Span has no span links to saved invocation context
    - Test ambient context is captured BEFORE Workflow_Span creation
    - Test `forceFlush` error is logged and swallowed (not propagated)
    - Test per-invocation state (including `savedInvocationContext`) is cleared after `onInvocationEnd`
    - _Requirements: 4.3, 5.1, 5.3, 5.7_

  - [x] 5.3 Write unit tests for span link construction
    - Test `buildInvocationLinks()` returns link to ambient span when in default-provider mode
    - Test `buildInvocationLinks()` returns link to explicit Invocation_Span when not in default-provider mode
    - Test `buildInvocationLinks()` returns empty array when no invocation context exists
    - Test tracer is created with correct `instrumentationName` from provider (defaults to `"aws-durable-execution-sdk-js"`)
    - _Requirements: 5.4, 5.5, 5.6, 6.1, 6.2, 6.4_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integration test with InMemorySpanExporter
  - [x] 7.1 Write integration test verifying end-to-end span export with default provider
    - Register a `NodeTracerProvider` with `InMemorySpanExporter` globally
    - Create `StandaloneOtelPlugin` with `useDefaultTracerProvider: true`
    - Simulate a full invocation lifecycle (start → operation → attempt → end)
    - Assert: Workflow_Span is root (no parent), operation/attempt spans have invocation links, spans are exported via InMemorySpanExporter, no shutdown called
    - _Requirements: 1.1, 4.1, 5.2, 5.4, 5.5, 5.8_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. X-Ray E2E verification with default tracer provider
  - [x] 9.1 Write X-Ray E2E example and test for `useDefaultTracerProvider` mode
    - Create a new example at `packages/aws-durable-execution-sdk-js-examples/src/examples/otel/standalone-default-provider-xray-e2e/`
    - Handler registers a `NodeTracerProvider` globally (with OTLP exporter in cloud, InMemorySpanExporter locally), then creates `StandaloneOtelPlugin` with `useDefaultTracerProvider: true`
    - Exercise multiple operation types: step, wait, runInChildContext with inner step
    - In cloud mode: fetch X-Ray trace and assert: Workflow_Span is root (no parent), NO Invocation_Span is created by the plugin, operation/attempt spans have span links to the ambient invocation span, spans are exported via the global provider's pipeline
    - In local mode: use InMemorySpanExporter to assert same structural properties
    - Add collector.yaml (same pattern as standalone-xray-e2e)
    - Register example in examples-catalog.json
    - Follow existing `standalone-xray-e2e` pattern with `createTests` helper
    - _Requirements: 1.1, 4.1, 5.2, 5.4, 5.5, 5.7, 5.8_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using `fast-check` (already in devDependencies)
- Unit tests use Jest (project's existing test framework) with mocks for TracerProvider
- All test files go in `packages/aws-durable-execution-sdk-js-otel/src/__tests__/`
- The implementation uses TypeScript throughout (matching the existing codebase)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["4.1", "4.2", "4.3", "4.9"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 7, "tasks": ["4.7", "4.8"] },
    { "id": 8, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["9.1"] }
  ]
}
```
