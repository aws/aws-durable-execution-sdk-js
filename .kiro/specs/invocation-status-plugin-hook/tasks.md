# Implementation Plan: Invocation Status Plugin Hook

## Overview

This plan refactors the plugin hook lifecycle by removing `onExecutionEnd`, consolidating execution-end information into `onInvocationEnd` via a new `InvocationEndInfo` interface, and introducing a new `PluginInvocationStatus` enum in `src/types/plugin.ts` with a `RETRYING` member. The existing `InvocationStatus` enum in `src/types/core.ts` remains completely unchanged. The implementation proceeds incrementally: type changes first, then plugin-runner updates, then orchestration logic in `with-durable-execution.ts`, and finally tests.

## Tasks

- [x] 1. Update types and interfaces in plugin.ts
  - [x] 1.1 Create PluginInvocationStatus enum and InvocationEndInfo interface in plugin.ts
    - Create a new `PluginInvocationStatus` enum in `src/types/plugin.ts` with exactly four members: `SUCCEEDED = "SUCCEEDED"`, `FAILED = "FAILED"`, `PENDING = "PENDING"`, `RETRYING = "RETRYING"`
    - Create `InvocationEndInfo` interface in `src/types/plugin.ts` that extends `InvocationInfo` with fields: `status: PluginInvocationStatus`, `executionResult?: unknown`, `executionError?: Error`, `executionInput: unknown`, `operations: Record<string, Operation>`
    - Update `onInvocationEnd` signature in `DurableInstrumentationPlugin` to accept `InvocationEndInfo` instead of `InvocationInfo`
    - Remove `onExecutionEnd` method from `DurableInstrumentationPlugin` interface
    - Remove `ExecutionEndInfo` interface from the file
    - The existing `InvocationStatus` enum in `src/types/core.ts` must NOT be modified
    - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.3, 2.9, 2.10, 3.1, 4.1, 4.3_

  - [x] 1.2 Update package exports in index.ts
    - Add `InvocationEndInfo` and `PluginInvocationStatus` to the named exports from `./types/plugin`
    - Remove `ExecutionEndInfo` from the named exports
    - Verify `InvocationStatus` is already exported (via `./types` barrel) and remains unchanged
    - _Requirements: 1.4, 2.10, 4.3, 6.5_

- [x] 2. Update plugin-runner dispatch logic
  - [x] 2.1 Update createPluginRunner in plugin-runner.ts
    - Remove the `onExecutionEnd` dispatch method from the returned object
    - Update `onInvocationEnd` dispatch to accept `InvocationEndInfo` parameter instead of `InvocationInfo`
    - Update the internal `PluginInfo` type union to include `InvocationEndInfo`
    - Remove the `ExecutionEndInfo` import
    - Add `InvocationEndInfo` to the imports from `../../types/plugin`
    - _Requirements: 4.2, 4.4, 3.1, 5.1, 5.2_

- [x] 3. Update orchestration logic in with-durable-execution.ts
  - [x] 3.1 Refactor with-durable-execution.ts to use onInvocationEnd with InvocationEndInfo
    - Remove all `plugin.onExecutionEnd?.(...)` call sites (3 locations: context validation error, large result checkpoint, normal completion, and handler error)
    - Remove the `finally` block that calls `plugin.onInvocationEnd?.(invocationInfo)`
    - Import `PluginInvocationStatus` from `./types/plugin` (NOT from `./types/core`)
    - Add `onInvocationEnd` calls in each outcome branch passing a fully-constructed `InvocationEndInfo` with `PluginInvocationStatus` values:
      - SUCCEEDED path: `PluginInvocationStatus.SUCCEEDED`, executionResult set, executionError undefined
      - FAILED path (handler error): `PluginInvocationStatus.FAILED`, executionError set, executionResult undefined
      - PENDING path (termination): `PluginInvocationStatus.PENDING`, both executionResult and executionError undefined
      - Context validation error path: `PluginInvocationStatus.FAILED`, executionError set
    - Add a catch block for `UnrecoverableInvocationError` that calls `onInvocationEnd` with `PluginInvocationStatus.RETRYING` status before re-throwing
    - Ensure `onInvocationEnd` is called exactly once per invocation regardless of code path
    - Continue using `InvocationStatus` (from core.ts, unchanged) for `DurableExecutionInvocationOutput.Status` values
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 4.4, 6.1, 6.2, 6.3, 6.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update unit tests for plugin-runner
  - [x] 5.1 Update plugin-runner.test.ts to remove onExecutionEnd and update onInvocationEnd tests
    - Remove all test cases referencing `onExecutionEnd` or `ExecutionEndInfo`
    - Update `onInvocationEnd` tests to pass `InvocationEndInfo` objects (with `status: PluginInvocationStatus.*`, executionInput, operations fields)
    - Update the full lifecycle integration test to remove `onExecutionEnd` assertions and update `onInvocationEnd` assertions to check for `PluginInvocationStatus` values
    - Remove `ExecutionEndInfo` from imports
    - Add `InvocationEndInfo` and `PluginInvocationStatus` to imports
    - Verify error isolation tests pass with the new parameter type
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 Write property test for plugin error isolation (Property 6)
    - **Property 6: Plugin error isolation in onInvocationEnd**
    - Using fast-check, generate arbitrary sets of plugins where some throw sync errors or return rejected promises from `onInvocationEnd`
    - Assert all plugins receive their `onInvocationEnd` call regardless of prior plugin failures
    - Assert the SDK output is never affected by plugin errors
    - Minimum 100 iterations
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 6. Update integration tests for with-durable-execution
  - [x] 6.1 Update with-durable-execution.plugin.test.ts
    - Remove all test cases referencing `onExecutionEnd`
    - Update the `beforeEach` plugin mock to remove `onExecutionEnd` and keep `onInvocationEnd`
    - Update `onInvocationEnd` assertions to verify `InvocationEndInfo` structure (status using `PluginInvocationStatus`, executionResult, executionError, executionInput, operations)
    - Add test case for SUCCEEDED status path: verify onInvocationEnd receives `PluginInvocationStatus.SUCCEEDED`
    - Add test case for FAILED status path: verify onInvocationEnd receives `PluginInvocationStatus.FAILED` and executionError
    - Update the "plugin errors do not affect SDK execution" test to remove `onExecutionEnd` from the throwing plugin
    - Update the "fans out hooks to multiple plugins" test to verify onInvocationEnd with InvocationEndInfo containing `PluginInvocationStatus` values
    - _Requirements: 3.2, 3.3, 3.6, 4.5, 5.1_

  - [x] 6.2 Write property test for successful invocation InvocationEndInfo (Property 1)
    - **Property 1: Successful invocation produces correct InvocationEndInfo**
    - Using fast-check, generate arbitrary handler return values
    - Assert `onInvocationEnd` is called with `status` equal to `PluginInvocationStatus.SUCCEEDED`, executionResult equal to handler's return value, and executionError undefined
    - Minimum 100 iterations
    - **Validates: Requirements 2.4, 3.2**

  - [x] 6.3 Write property test for failed invocation InvocationEndInfo (Property 2)
    - **Property 2: Failed invocation produces correct InvocationEndInfo**
    - Using fast-check, generate arbitrary Error messages for handler failures
    - Assert `onInvocationEnd` is called with `status` equal to `PluginInvocationStatus.FAILED`, executionError matching the thrown error, and executionResult undefined
    - Minimum 100 iterations
    - **Validates: Requirements 2.5, 3.3**

  - [x] 6.4 Write property test for RETRYING never in Lambda output (Property 7)
    - **Property 7: RETRYING never appears in Lambda response output**
    - Using fast-check, generate arbitrary invocation outcomes
    - Assert the `DurableExecutionInvocationOutput.Status` is always one of `InvocationStatus.SUCCEEDED`, `InvocationStatus.FAILED`, or `InvocationStatus.PENDING` (from core.ts) and never contains "RETRYING"
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- A NEW `PluginInvocationStatus` enum is created in `src/types/plugin.ts` — the existing `InvocationStatus` in `src/types/core.ts` is NOT modified
- `PluginInvocationStatus.RETRYING` is only used in the `InvocationEndInfo` passed to plugins; it never appears in `DurableExecutionInvocationOutput`
- `DurableExecutionInvocationOutput.Status` continues to use the original `InvocationStatus` enum from `core.ts` (3 members: SUCCEEDED, FAILED, PENDING)
- The existing fire-and-forget `run` dispatch pattern is maintained for `onInvocationEnd` to ensure error isolation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "6.2", "6.3", "6.4"] }
  ]
}
```
