# Requirements Document

## Introduction

This feature refactors the plugin hook lifecycle in the JS/TS Durable Execution SDK by removing the `onExecutionEnd` hook and consolidating execution-end information into the `onInvocationEnd` hook via a new `InvocationEndInfo` interface. It also introduces a new plugin-specific `PluginInvocationStatus` enum in `src/types/plugin.ts` with a `RETRYING` value (in addition to SUCCEEDED, FAILED, PENDING), providing richer status information to plugin authors about how each invocation concluded, without modifying the existing `InvocationStatus` enum in `src/types/core.ts`.

## Glossary

- **Plugin_System**: The instrumentation framework (`DurableInstrumentationPlugin` interface and `createPluginRunner`) that dispatches lifecycle events to registered plugins during durable execution.
- **PluginInvocationStatus**: A new enum defined in `src/types/plugin.ts` representing the outcome status of a durable execution invocation from the plugin's perspective (SUCCEEDED, FAILED, PENDING, RETRYING).
- **InvocationStatus**: The existing enum in `src/types/core.ts` representing the outcome status of a durable execution invocation for Lambda output (SUCCEEDED, FAILED, PENDING only). This enum remains unchanged.
- **InvocationEndInfo**: An interface providing detailed information about how an invocation ended, including the plugin invocation status and optional execution result or error details.
- **Plugin_Runner**: The composite function (`createPluginRunner`) that dispatches lifecycle hook calls to all registered plugins.
- **onInvocationEnd**: A plugin hook called when an invocation completes, providing information about the invocation outcome.
- **onExecutionEnd**: A plugin hook (to be removed) that was previously called when a durable execution reached a terminal state.

## Requirements

### Requirement 1: Create PluginInvocationStatus enum in plugin.ts

**User Story:** As a plugin author, I want a plugin-specific `PluginInvocationStatus` enum that includes a `RETRYING` status, so that I can distinguish invocations that failed but will be retried by the backend from those that failed permanently, without modifying the core SDK types.

#### Acceptance Criteria

1. THE Plugin_System SHALL define a new `PluginInvocationStatus` enum in `src/types/plugin.ts` with exactly four members: `SUCCEEDED`, `FAILED`, `PENDING`, and `RETRYING`
2. THE PluginInvocationStatus enum SHALL assign string values matching their member names: `"SUCCEEDED"`, `"FAILED"`, `"PENDING"`, and `"RETRYING"`
3. THE `RETRYING` member SHALL be documented as indicating that the invocation failed but will be retried automatically by the backend
4. THE PluginInvocationStatus enum SHALL be publicly exported from the SDK package via the top-level package entry point
5. THE existing `InvocationStatus` enum in `src/types/core.ts` SHALL NOT be modified and SHALL remain with exactly three members: `SUCCEEDED`, `FAILED`, and `PENDING`

### Requirement 2: Create InvocationEndInfo interface

**User Story:** As a plugin author, I want the `onInvocationEnd` hook to receive an `InvocationEndInfo` object containing the invocation status and contextual details, so that I can understand how each invocation concluded without needing a separate `onExecutionEnd` hook.

#### Acceptance Criteria

1. THE InvocationEndInfo interface SHALL extend InvocationInfo (providing `requestId`, `executionArn` and `isFirstInvocation` fields)
2. THE InvocationEndInfo interface SHALL include a `status` field of type PluginInvocationStatus (one of SUCCEEDED, FAILED, PENDING, or RETRYING)
3. WHEN the invocation status is SUCCEEDED, THE InvocationEndInfo SHALL include an `executionResult` field containing the execution output, and the `executionError` field SHALL be undefined
4. WHEN the invocation status is FAILED, THE InvocationEndInfo SHALL include an `executionError` field of type Error, and the `executionResult` field SHALL be undefined
5. WHEN the invocation status is PENDING, THE InvocationEndInfo SHALL have both `executionResult` and `executionError` fields as undefined
6. WHEN the invocation status is RETRYING, THE InvocationEndInfo SHALL include an `executionError` field of type Error, and the `executionResult` field SHALL be undefined
7. THE InvocationEndInfo interface SHALL include an `executionInput` field of type `unknown` containing the original deserialized customer handler event
8. THE InvocationEndInfo interface SHALL include an `operations` field of type `Record<string, Operation>` containing the record of operations executed during this invocation
9. THE InvocationEndInfo interface SHALL be publicly exported from the SDK package's main entry point (index.ts)

### Requirement 3: Update onInvocationEnd hook signature

**User Story:** As a plugin author, I want the `onInvocationEnd` hook to accept `InvocationEndInfo` instead of `InvocationInfo`, so that I receive richer context about the invocation outcome in a single hook.

#### Acceptance Criteria

1. THE Plugin_System SHALL define `onInvocationEnd` in the `DurableInstrumentationPlugin` interface with parameter type `InvocationEndInfo`
2. WHEN the handler completes successfully and returns `InvocationStatus.SUCCEEDED`, THE Plugin_System SHALL call `onInvocationEnd` with status set to `PluginInvocationStatus.SUCCEEDED`
3. WHEN the handler fails with a `DurableExecutionError` and returns `InvocationStatus.FAILED`, THE Plugin_System SHALL call `onInvocationEnd` with status set to `PluginInvocationStatus.FAILED` and the `executionError` field set to the caught error
4. WHEN the invocation is terminated by a `TerminationError` or `SuspensionError` and returns `InvocationStatus.PENDING`, THE Plugin_System SHALL call `onInvocationEnd` with status set to `PluginInvocationStatus.PENDING`
5. WHEN the invocation fails with an `UnrecoverableInvocationError` that causes the Lambda to be retried, THE Plugin_System SHALL call `onInvocationEnd` with status set to `PluginInvocationStatus.RETRYING` and the `executionError` field set to the caught error
6. THE Plugin_System SHALL call `onInvocationEnd` exactly once per invocation regardless of the outcome

### Requirement 4: Remove onExecutionEnd hook

**User Story:** As an SDK maintainer, I want the `onExecutionEnd` hook removed from the plugin interface, so that the plugin lifecycle is simplified and execution-end information is consolidated into `onInvocationEnd`.

#### Acceptance Criteria

1. THE DurableInstrumentationPlugin interface SHALL NOT include the `onExecutionEnd` method
2. THE Plugin_Runner SHALL NOT dispatch `onExecutionEnd` calls to plugins
3. THE ExecutionEndInfo interface SHALL be removed from the type definition file and from all barrel/index re-exports
4. THE Plugin_System SHALL NOT reference or depend on `onExecutionEnd` in any internal implementation, including call sites in `with-durable-execution.ts` and the composite dispatch in `plugin-runner.ts`
5. THE Plugin_System SHALL remove or update all unit tests that reference `onExecutionEnd` or `ExecutionEndInfo` so that the test suite passes without errors
6. THE SDK SHALL compile successfully with zero TypeScript errors after all `onExecutionEnd` and `ExecutionEndInfo` references are removed

### Requirement 5: Plugin error isolation for onInvocationEnd

**User Story:** As an SDK user, I want plugin errors in `onInvocationEnd` to never affect the SDK's execution or return value, so that faulty plugins cannot break my durable function.

#### Acceptance Criteria

1. IF a plugin throws a synchronous error in `onInvocationEnd`, THEN THE Plugin_Runner SHALL catch the error without re-throwing and SHALL continue calling `onInvocationEnd` on all subsequent registered plugins in order
2. IF a plugin returns a rejected promise from `onInvocationEnd`, THEN THE Plugin_Runner SHALL suppress the rejection without surfacing it to the caller and SHALL continue calling `onInvocationEnd` on all subsequent registered plugins in order
3. WHEN `onInvocationEnd` is dispatched after the invocation completes, THE Plugin_System SHALL return the same `DurableExecutionInvocationOutput` (status and result) that was determined prior to calling `onInvocationEnd`, regardless of whether any plugin threw a synchronous error or returned a rejected promise during `onInvocationEnd` dispatch
4. IF all registered plugins throw errors in `onInvocationEnd`, THEN THE Plugin_Runner SHALL suppress every error and THE Plugin_System SHALL return the previously determined invocation output without throwing

### Requirement 6: Backward compatibility for InvocationStatus in core.ts and invocation output

**User Story:** As an SDK maintainer, I want the existing `InvocationStatus` enum in `src/types/core.ts` to remain unchanged and the introduction of `PluginInvocationStatus` to have no impact on the existing invocation output types, so that the SDK's contract with the durable execution service remains unchanged.

#### Acceptance Criteria

1. THE `InvocationStatus` enum in `src/types/core.ts` SHALL remain unchanged with exactly three members: `SUCCEEDED`, `FAILED`, and `PENDING`
2. THE DurableExecutionInvocationOutput type SHALL define its `Status` field using the existing `InvocationStatus` enum (SUCCEEDED, FAILED, PENDING only), with no additional status values permitted in the type definition
3. THE `PluginInvocationStatus.RETRYING` value SHALL only be used within plugin hook parameters (InvocationEndInfo) and SHALL NOT appear in the Lambda response output
4. WHEN the SDK produces a DurableExecutionInvocationOutput response to return to the Lambda runtime, THE Status field SHALL be set to one of SUCCEEDED, FAILED, or PENDING and SHALL NOT contain the value "RETRYING"
5. THE `PluginInvocationStatus` enum SHALL be a separate type from `InvocationStatus` and SHALL NOT extend or modify the existing `InvocationStatus` enum in any way
