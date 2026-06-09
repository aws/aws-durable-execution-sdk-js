# Implementation Plan: Checkpoint-Driven Plugin Hooks

## Overview

Centralize operation-level plugin hook dispatch into CheckpointManager, add `wrapOperationAttemptFn` to the step-handler, add inter-invocation hook dispatch via `updatedOperationIds`, and remove the redundant `onOperationAttemptStart`/`onOperationAttemptEnd` hooks along with `AttemptEndInfo` and `AttemptEndInfoOutcome` types. This builds on top of the current main branch (PR #596) which already wires invocation-level hooks and passes the plugin to CheckpointManager.

## Tasks

- [x] 1. Type changes and plugin interface updates
  - [x] 1.1 Add `updatedOperationIds` optional field to `DurableExecutionInvocationInput`
    - Add `updatedOperationIds?: string[]` to the interface in `src/types/core.ts`
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 Rename and consolidate operation hook methods in `DurableInstrumentationPlugin` interface
    - Rename `onOperationFirstStart` to `onOperationStart` in `src/types/plugin.ts`
    - Remove the old separate `onOperationStart` method (was for re-encounter; now collapsed into the renamed hook)
    - Rename `onOperationFirstEnd` to `onOperationEnd` in `src/types/plugin.ts`
    - Update `OperationEndInfo` reference if needed (type name stays the same)
    - _Requirements: 8.1_

  - [x] 1.3 Remove `onOperationAttemptStart` and `onOperationAttemptEnd` from `DurableInstrumentationPlugin` interface
    - Remove method signatures from `src/types/plugin.ts`
    - _Requirements: 7.1, 7.2_

  - [x] 1.4 Remove `AttemptEndInfo` interface and `AttemptEndInfoOutcome` enum from plugin types
    - Remove the interface and enum definitions from `src/types/plugin.ts`
    - Remove from all barrel/index re-exports
    - _Requirements: 7.3, 7.4_

  - [x] 1.5 Update `createPluginRunner` to remove dispatch of removed hooks
    - Remove `onOperationAttemptStart` and `onOperationAttemptEnd` from the returned composite plugin object in `src/utils/plugin/plugin-runner.ts`
    - Remove `AttemptEndInfo` import if no longer needed
    - Rename `onOperationFirstStart`/`onOperationFirstEnd` references to `onOperationStart`/`onOperationEnd`
    - Remove the old duplicate `onOperationStart` entry (previously for re-encounter semantics)
    - _Requirements: 7.6, 8.1_

  - [x] 1.6 Update barrel exports (index files) to remove `AttemptEndInfo` and `AttemptEndInfoOutcome`
    - Find and update all index.ts/barrel files that re-export these removed types
    - Verify `AttemptInfo` is still exported (used by `wrapOperationAttemptFn`)
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 1.7 Remove `HashedId` and `HashedParentId` from `OperationInfo` interface
    - Remove `HashedId?: string` and `HashedParentId?: string` fields from `OperationInfo` in `src/types/plugin.ts`
    - Update JSDoc to document that `Id` and `ParentId` always contain hashed values
    - Update all code that populates `HashedId` or `HashedParentId` (e.g., in operation helpers) to stop setting those fields
    - _Requirements: 8.2_

- [x] 2. Checkpoint - Ensure all type changes compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add Hook_Dispatcher logic to CheckpointManager
  - [x] 3.1 Add `toOperationInfoFromOperation` and `toOperationEndInfoFromOperation` helper methods
    - Implement methods that derive `OperationInfo` / `OperationEndInfo` from checkpoint response `Operation` records
    - Add `isTerminalStatus` and `extractErrorFromOperation` private helpers
    - _Requirements: 1.4, 1.3_

  - [x] 3.2 Implement `dispatchOperationHooks` method in CheckpointManager
    - Detect new operations with STARTED status (not in previous stepData) → fire `onOperationStart`
    - Detect transition to terminal status (previous was non-terminal or absent) → fire `onOperationEnd`
    - Call plugin hooks directly (no wrapping needed — `createPluginRunner` already swallows errors)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 3.3 Update `updateStepDataFromCheckpointResponse` to snapshot previous state and call `dispatchOperationHooks`
    - Snapshot previous stepData for affected operations before update
    - Existing `onOperationChange` call is already direct (no safeDispatch needed)
    - Call `dispatchOperationHooks` after stepData update
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3_

  - [x]\* 3.4 Write unit tests for Hook_Dispatcher state transition detection
    - Test that `onOperationStart` fires for new STARTED operations
    - Test that `onOperationEnd` fires for terminal transitions
    - Test that hooks do NOT fire when status hasn't changed
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x]\* 3.5 Write unit tests for error isolation
    - Test that plugin errors don't interrupt checkpoint processing
    - Test that all plugins still receive hooks when one throws
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 4. Checkpoint - Ensure Hook_Dispatcher logic compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Inter-invocation hook dispatch
  - [x] 5.1 Update `initializeExecutionContext` to accept plugin param and dispatch inter-invocation hooks
    - Add optional `plugin?: DurableInstrumentationPlugin` parameter
    - After all paginated operations are loaded, iterate `event.updatedOperationIds`
    - For each ID: if terminal status → dispatch `onOperationEnd`; if STARTED → dispatch `onOperationStart`
    - Skip IDs not found in stepData or with non-actionable statuses
    - Call plugin hooks directly (no wrapping needed — `createPluginRunner` already swallows errors)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 5.2 Update `withDurableExecution` to pass plugin to `initializeExecutionContext`
    - Pass `plugin` to `initializeExecutionContext` call
    - No other changes needed — inter-invocation dispatch is fully handled inside `initializeExecutionContext`
    - _Requirements: 3.7, 3.8_

  - [x]\* 5.3 Write unit tests for inter-invocation dispatch filtering
    - Test hooks only fire for IDs in `updatedOperationIds`
    - Test no hooks fire when field is absent or empty
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**

- [x] 6. Checkpoint - Ensure inter-invocation dispatch compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add wrapOperationAttemptFn to step-handler and wrapChildContextFn to run-in-child-context-handler
  - [x] 7.1 Add `wrapOperationAttemptFn` wrapping to step-handler
    - Import plugin types (`AttemptInfo`, `DurableInstrumentationPlugin`)
    - Accept plugin as a parameter to `createStepHandler`
    - In `executeStepLogic`, construct `AttemptInfo` from the operation state after checkpoint START
    - Wrap the user's step function call with `plugin.wrapOperationAttemptFn` when available
    - If `wrapOperationAttemptFn` is not defined, execute user's function directly
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 Add `wrapChildContextFn` wrapping to run-in-child-context-handler
    - Accept plugin as a parameter to `createRunInChildContextHandler`
    - In `executeChildContext`, construct `OperationInfo` from the operation state (hashed Id, Name, Type=CONTEXT, SubType, ParentId)
    - Wrap the call to `fn(durableChildContext)` with `plugin.wrapChildContextFn` when available
    - If `wrapChildContextFn` is not defined, execute `fn(durableChildContext)` directly
    - Do NOT wrap in the replay/completed path (`handleCompletedChildContext`) — only wrap in the active execution path
    - _Requirements: 5a.1, 5a.2, 5a.3, 5a.4_

  - [x] 7.3 Verify no inline notification hooks exist in any handler
    - Confirm step-handler, invoke-handler, wait-handler, and callback-handler do NOT call `onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`, or `onOperationAttemptEnd`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.7_

- [x] 8. Checkpoint - Ensure handler refactoring compiles and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update and add all affected unit tests
  - [x] 9.1 Update plugin-runner tests
    - Remove tests referencing `onOperationAttemptStart`, `onOperationAttemptEnd`, `AttemptEndInfo`, `AttemptEndInfoOutcome`
    - Remove `onOperationAttemptStart` and `onOperationAttemptEnd` from the returned composite plugin object
    - Verify `wrapOperationAttemptFn` tests still pass
    - _Requirements: 7.9, 8.1_

  - [x] 9.2 Add step-handler plugin tests for wrapOperationAttemptFn
    - Test that `wrapOperationAttemptFn` wraps user code on each attempt
    - Test that attempt number increments on retry
    - Test that `AttemptInfo` contains correct Id, Name, Type, SubType, ParentId, Attempt
    - Test graceful fallback when `wrapOperationAttemptFn` is not defined
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 9.3 Add run-in-child-context-handler plugin tests for wrapChildContextFn
    - Test that `wrapChildContextFn` wraps child context function in the execution path
    - Test that `OperationInfo` contains correct hashed Id, Name, Type (CONTEXT), SubType, ParentId
    - Test graceful fallback when `wrapChildContextFn` is not defined
    - Test that `wrapChildContextFn` is NOT called on the replay/completed path
    - _Requirements: 5a.1, 5a.2, 5a.3, 5a.4_

  - [x] 9.4 Update with-durable-execution tests
    - Update tests to account for new `initializeExecutionContext` signature (plugin param)
    - _Requirements: 3.7, 3.8_

  - [x] 9.5 Add unit tests for CheckpointManager hook dispatch
    - Test that `updateStepDataFromCheckpointResponse` fires `onOperationStart` for new STARTED operations
    - Test that `onOperationEnd` fires for terminal transitions
    - Test that `onOperationChange` continues to fire for status changes (existing behavior preserved)
    - Test error isolation (plugin throw doesn't break checkpoint processing)
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 6.1, 6.3_

  - [x] 9.6 Add unit tests for inter-invocation hook dispatch in initializeExecutionContext
    - Test no hooks fire when `updatedOperationIds` is absent
    - Test no hooks fire when `updatedOperationIds` is empty array
    - Test `onOperationEnd` fires for terminal operations in the list
    - Test `onOperationStart` fires for STARTED operations in the list
    - Test skips IDs not found in stepData
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Unit tests validate specific examples and edge cases
- The project uses TypeScript with Jest as the test runner — do NOT add fast-check or any other new dependencies
- `AttemptInfo` is preserved since it is used by `wrapOperationAttemptFn`
- No deduplication sets are needed — the backend only sends each operation's state transition once per invocation, and state doesn't persist across invocations
- No ordering guarantee exists between `onOperationChange` and operation-specific hooks (`onOperationStart`, `onOperationEnd`)
- `HashedId` and `HashedParentId` have been removed from `OperationInfo` — the `Id` and `ParentId` fields always contain hashed values as returned by the checkpoint response
- **Current state (main after PR #596)**: Plugin is already wired at invocation level and passed to CheckpointManager. Handlers do NOT have inline plugin hooks — operation-level hooks are being added exclusively via checkpoint-driven dispatch.
- The `onOperationChange` hook is already dispatched from `updateStepDataFromCheckpointResponse` — this work extends that method with `onOperationStart` and `onOperationEnd`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "1.6", "1.7"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3", "3.4", "3.5"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["9.5", "9.6"] }
  ]
}
```
