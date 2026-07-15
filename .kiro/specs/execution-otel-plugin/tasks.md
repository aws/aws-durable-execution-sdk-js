# Implementation Plan: Execution OTel Plugin — InvocationOtelPlugin Refactoring

## Overview

All shared modules (`execution-plugin-config.ts`, `execution-plugin-provider.ts`, `execution-plugin-instrumentations.ts`, `deterministic-id-generator.ts`, `context-extractors.ts`) and `ExecutionOtelPlugin` are already fully implemented. The remaining work is to refactor `InvocationOtelPlugin` to consume these shared modules instead of its own inline duplicates, adapting the shared instrumentation function where needed, and updating `index.ts` exports and tests.

## Tasks

- [x] 1. Adapt shared instrumentation registration for InvocationOtelPlugin's use case
  - [x] 1.1 Update `registerStandaloneInstrumentations` to support registering AwsInstrumentation when `useDefaultTracerProvider=true`
    - Currently `registerStandaloneInstrumentations` skips ALL registration when `config.useDefaultTracerProvider` is true
    - InvocationOtelPlugin's current behavior: when using the global provider, it still registers `AwsInstrumentation` with `suppressInternalInstrumentation: true` and `sqsExtractContextPropagationFromPayload: true`
    - Modify the skip logic: when `useDefaultTracerProvider=true`, skip HTTP instrumentation but still register `AwsInstrumentation` on the provided tracerProvider
    - When `config.tracerProvider` is explicitly provided (custom provider), continue to skip all registration (caller owns instrumentation)
    - Ensure ExecutionOtelPlugin's behavior is preserved: when neither `tracerProvider` nor `useDefaultTracerProvider` is set, register both HTTP and AWS SDK instrumentations
    - _Requirements: 27.1, 27.2, 27.3, 27.5, 27.6_

  - [ ]\* 1.2 Write unit tests for updated instrumentation registration behavior
    - Test that with `useDefaultTracerProvider=true`: only AwsInstrumentation is registered (no HttpInstrumentation)
    - Test that with explicit `tracerProvider` in config: nothing is registered
    - Test that with neither set: both HttpInstrumentation and AwsInstrumentation are registered
    - Test that HTTP suppression rules (127.0.0.1, AWS_LAMBDA_RUNTIME_API) still work in standalone mode
    - _Requirements: 4.1, 4.2, 27.5, 27.6_

- [x] 2. Refactor InvocationOtelPlugin to use shared modules
  - [x] 2.1 Replace InvocationOtelPlugin's config interface and provider resolution with shared modules
    - Change constructor to accept `ExecutionOtelPluginConfig` instead of `InvocationOtelPluginConfig`
    - Keep `InvocationOtelPluginConfig` as a deprecated type alias pointing to `ExecutionOtelPluginConfig` for backward compatibility
    - Replace the inline if/else TracerProvider resolution with a call to `createTracerProvider`, passing config with `useDefaultTracerProvider` defaulting to `true` when neither `tracerProvider` nor `useDefaultTracerProvider` is explicitly set
    - Replace inline `AwsInstrumentation` registration with a call to `registerStandaloneInstrumentations`
    - Remove imports of `AwsInstrumentation` and `registerInstrumentations` from `@opentelemetry/instrumentation-aws-sdk` and `@opentelemetry/instrumentation`
    - Add imports of `createTracerProvider` from `./execution-plugin-provider` and `registerStandaloneInstrumentations` from `./execution-plugin-instrumentations`
    - Add import of `ExecutionOtelPluginConfig` from `./execution-plugin-config`
    - Ensure InvocationOtelPlugin silently ignores config fields it doesn't use (e.g., `workflowSpanName`, `exporterConfig`)
    - _Requirements: 25.1, 25.2, 25.4, 25.5, 26.1, 26.2, 26.3, 26.5, 27.1, 27.4_

  - [ ]\* 2.2 Write unit tests for refactored InvocationOtelPlugin shared module integration
    - Test that InvocationOtelPlugin accepts `ExecutionOtelPluginConfig` without errors
    - Test that InvocationOtelPlugin defaults `useDefaultTracerProvider` to `true` (uses global TracerProvider) when no explicit provider or useDefaultTracerProvider is configured
    - Test that InvocationOtelPlugin with explicit `tracerProvider` in config uses that provider
    - Test that `InvocationOtelPluginConfig` type alias still works for backward compatibility
    - Test that irrelevant config fields (`workflowSpanName`, `exporterConfig`) are ignored without error
    - Test that AwsInstrumentation is registered via shared function (no inline registration)
    - _Requirements: 25.1, 25.2, 25.4, 26.2, 26.3, 27.3, 27.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update package exports and verify integration
  - [x] 4.1 Update `index.ts` exports to reflect the refactored InvocationOtelPlugin
    - Export `InvocationOtelPluginConfig` as a deprecated type re-export (pointing to `ExecutionOtelPluginConfig`) if the type alias lives in `invocation-plugin.ts`
    - Ensure all existing public exports remain intact (ExecutionOtelPlugin, InvocationOtelPlugin, ExecutionOtelPluginConfig, DeterministicIdGenerator, derivation functions, context extractors)
    - Verify no circular dependency issues between shared modules and plugin modules
    - _Requirements: 28.4, 28.5_

  - [ ]\* 4.2 Write integration test verifying no circular dependencies and both plugins coexist
    - Import both `ExecutionOtelPlugin` and `InvocationOtelPlugin` from the package index
    - Construct both plugins with `ExecutionOtelPluginConfig` and verify they initialize without errors
    - Verify InvocationOtelPlugin's lifecycle (onInvocationStart → onOperationStart → onOperationEnd → onInvocationEnd) still works end-to-end after refactoring
    - _Requirements: 28.4, 28.5_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The shared modules (`execution-plugin-config.ts`, `execution-plugin-provider.ts`, `execution-plugin-instrumentations.ts`, `deterministic-id-generator.ts`, `context-extractors.ts`) are already fully implemented and tested
- `ExecutionOtelPlugin` is already fully implemented and tested
- The key behavioral change in task 1.1 is making `registerStandaloneInstrumentations` register AwsInstrumentation even when `useDefaultTracerProvider=true` (but skip HTTP instrumentation), so InvocationOtelPlugin's current behavior is preserved
- The `InvocationOtelPluginConfig` type should become a deprecated alias to `ExecutionOtelPluginConfig` for backward compat
- Existing tests in `__tests__/invocation-plugin.test.ts` should be updated to reflect the refactored constructor
- TypeScript with Jest is the testing setup (project's existing configuration)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["4.2"] }
  ]
}
```
