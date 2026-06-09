# Requirements Document

## Introduction

This feature adds operation-level plugin hook dispatch (`onOperationStart`, `onOperationEnd`) to the AWS Durable Execution SDK (JS/TS). These hooks are triggered based on data from the `checkpointDurableExecutionRequest` API response and the `updatedStepData` returned in the checkpoint response, dispatched centrally from the `CheckpointManager` rather than inline in each handler. Additionally, for operations that update between invocations (invoke, wait, callback), hooks are dispatched from `initializeExecutionContext` — the location where `stepData` is populated from `DurableExecutionInvocationInput` between invocations.

Note: The current codebase (as of the "Wire plugin into execution lifecycle" PR #596) already wires invocation-level hooks (`onInvocationStart`, `onInvocationEnd`, `wrapInvocation`, `onOperationChange`) and passes the plugin to `CheckpointManager`. Handler-level operation hooks have NOT been added inline — they are being implemented directly via the checkpoint-driven approach described here.

The `DurableExecutionInvocationInput` includes an optional `updatedOperationIds` field — an array of operation IDs that were updated between invocations. When present, this field tells the SDK exactly which operations changed externally, enabling targeted hook dispatch during initialization. When absent, no inter-invocation hooks are fired.

The `onOperationAttemptStart` and `onOperationAttemptEnd` hooks are removed from the plugin interface as part of this work. The `wrapOperationAttemptFn` hook already wraps the execution of user code per attempt (in steps and wait-for-condition) and receives `AttemptInfo`, making the separate notification hooks redundant. The `AttemptEndInfo` and `AttemptEndInfoOutcome` types are also removed since they were only used by `onOperationAttemptEnd`.

This work:

- Implements operation-level plugin hooks via the checkpoint response (never added inline to handlers)
- Provides a single, authoritative source of truth for operation state transitions (the checkpoint response)
- Ensures that operations which complete between invocations (via backend processing) still fire the appropriate plugin hooks when their updated state is received, guided by the explicit `updatedOperationIds` field
- Adds `wrapOperationAttemptFn` to the step-handler for wrapping user code execution per attempt
- Removes redundant attempt-level notification hooks that are already covered by `wrapOperationAttemptFn`

## Glossary

- **Checkpoint_Manager**: The `CheckpointManager` class in `src/utils/checkpoint/checkpoint-manager.ts` responsible for batching, sending `checkpointDurableExecutionRequest` API calls, and processing checkpoint responses.
- **Checkpoint_Response**: The response from the `checkpointDurableExecutionRequest` API, containing a new `CheckpointToken` and `NewExecutionState.Operations` (the updated step data).
- **Updated_Step_Data**: The `NewExecutionState.Operations` array from the checkpoint response, representing the latest server-side state of operations after a checkpoint is processed.
- **Plugin_System**: The instrumentation framework (`DurableInstrumentationPlugin` interface and `createPluginRunner`) that dispatches lifecycle events to registered plugins.
- **Operation_Handler**: Any of the handler modules (step-handler, invoke-handler, wait-handler, callback-handler). These currently do NOT have inline plugin hook calls — operation-level hooks are being added exclusively via the checkpoint-driven approach.
- **Inter_Invocation_Operation**: An operation whose status changes between Lambda invocations due to external events (e.g., a wait timer expiring, a callback being received, or a chained invoke completing on the backend).
- **Hook_Dispatcher**: The proposed centralized component within `Checkpoint_Manager` responsible for determining which plugin hooks to fire based on checkpoint request/response data.
- **DurableExecutionInvocationInput**: The input payload provided to durable functions by the service. Contains `DurableExecutionArn`, `CheckpointToken`, `InitialExecutionState` (with `Operations` and `NextMarker`), and optionally `updatedOperationIds` — an array of operation IDs that were updated between invocations.
- **updatedOperationIds**: An optional field on `DurableExecutionInvocationInput` containing the IDs of operations that changed between invocations (e.g., a wait timer expiring, a callback being received, a chained invoke completing). When present, only the listed operations should have inter-invocation hooks dispatched. When absent or undefined, no inter-invocation hook dispatch occurs.
- **Execution_Context_Initializer**: The `initializeExecutionContext` function in `src/context/execution-context/execution-context.ts` that loads `stepData` from `DurableExecutionInvocationInput.InitialExecutionState.Operations` at the start of each invocation. This is where operations that completed between invocations are first visible.
- **updateStepDataFromCheckpointResponse**: The method in `CheckpointManager` that processes `NewExecutionState.Operations` from the `CheckpointDurableExecution` API response. This is where operation state changes within an invocation (including inter-invocation completions reported via checkpoint response) are detected and should trigger plugin hooks.

## Requirements

### Requirement 1: Centralized hook dispatch on checkpoint response

**User Story:** As an SDK maintainer, I want plugin hooks to be dispatched from a single location based on checkpoint response data, so that hook logic is not duplicated across multiple handler files and is always consistent with the server-confirmed operation state.

#### Acceptance Criteria

1. WHEN the Checkpoint_Manager receives Updated_Step_Data from a Checkpoint_Response, THE Hook_Dispatcher SHALL compare the previous operation state with the new operation state for each operation in the response by checking whether the operation Id existed in stepData before the update and whether its Status or Attempt field changed
2. WHEN an operation's Id is not present in the previous stepData and its status is `STARTED` in the Updated_Step_Data, THE Hook_Dispatcher SHALL call `onOperationStart` with an `OperationInfo` derived from the updated operation
3. WHEN an operation transitions from a non-terminal status (or from no prior state) to `SUCCEEDED` or `FAILED` or `TIMED_OUT` or `STOPPED` or `CANCELLED` status in the Updated_Step_Data, THE Hook_Dispatcher SHALL call `onOperationEnd` with an `OperationEndInfo` derived from the updated operation, where the `error` field is populated from the operation's error data when the status is `FAILED`
4. THE Hook_Dispatcher SHALL derive all `OperationInfo` fields (Id, Name, Type, SubType, ParentId, StartTimestamp, EndTimestamp) from the Updated_Step_Data operation record. The `Id` and `ParentId` fields always contain hashed values as returned by the checkpoint response — no separate `HashedId` or `HashedParentId` fields exist
5. WHEN the Hook_Dispatcher detects a state transition, it SHALL fire the corresponding hooks without maintaining any deduplication state, since within a single invocation the backend only sends each operation's state transition once

### Requirement 2: Operation-level hooks dispatched exclusively from CheckpointManager

**User Story:** As an SDK maintainer, I want operation-level plugin hooks to be dispatched exclusively from the Checkpoint_Manager based on checkpoint response data, so that hook logic is never scattered across handler files and remains consistent with server-confirmed operation state.

#### Acceptance Criteria

1. THE step-handler module SHALL NOT contain any source-level invocations of `onOperationStart` or `onOperationEnd` on the plugin object
2. THE invoke-handler module SHALL NOT contain any source-level invocations of `onOperationStart` or `onOperationEnd` on the plugin object
3. THE wait-handler module SHALL NOT contain any source-level invocations of `onOperationStart` or `onOperationEnd` on the plugin object
4. THE callback-handler module SHALL NOT contain any source-level invocations of `onOperationStart` or `onOperationEnd` on the plugin object
5. THE Checkpoint_Manager already receives the `plugin` parameter via its constructor (wired in PR #596); THE Hook_Dispatcher SHALL use this existing plugin reference to dispatch operation-level hooks
6. WHEN a checkpoint response is processed by the Checkpoint_Manager, THE Hook_Dispatcher SHALL dispatch the appropriate operation-level hooks (same hook method, same arguments) for each operation lifecycle event detected in the response

### Requirement 3: Hook dispatch for inter-invocation operation updates

**User Story:** As a plugin author, I want to receive `onOperationStart` and `onOperationEnd` hooks for operations that updated between invocations (e.g., wait timers expiring, callbacks being received, chained invokes completing), so that I have complete observability even when state changes happen outside the current Lambda invocation.

#### Acceptance Criteria

1. IF the `updatedOperationIds` field is absent or undefined in the `DurableExecutionInvocationInput`, THEN THE Hook_Dispatcher SHALL skip all inter-invocation hook dispatch and SHALL NOT fire any hooks based on operation states loaded during initialization
2. WHEN the `updatedOperationIds` field is present in the `DurableExecutionInvocationInput`, THE Hook_Dispatcher SHALL dispatch hooks only for operations whose IDs appear in the `updatedOperationIds` array and exist in the loaded `stepData`
3. WHEN the `updatedOperationIds` field is present and an operation listed in `updatedOperationIds` has a terminal status (SUCCEEDED, FAILED, TIMED_OUT, STOPPED, CANCELLED), THE Hook_Dispatcher SHALL call `onOperationEnd` with an `OperationEndInfo` derived from the operation
4. WHEN the `updatedOperationIds` field is present and an operation listed in `updatedOperationIds` is in `STARTED` status, THE Hook_Dispatcher SHALL call `onOperationStart` with an `OperationInfo` for each such operation
5. IF an operation ID in `updatedOperationIds` is not found in the loaded `stepData` or has a status that is neither terminal nor `STARTED` (e.g., `PENDING`), THEN THE Hook_Dispatcher SHALL skip hook dispatch for that operation without error
6. THE Hook_Dispatcher SHALL NOT dispatch any inter-invocation hooks for operations that are NOT listed in the `updatedOperationIds` array, regardless of their status
7. THE Hook_Dispatcher SHALL dispatch hooks for inter-invocation updates from within `initializeExecutionContext`, after all paginated operations have been loaded into `stepData` but before returning the execution context to the caller
8. THE Hook_Dispatcher SHALL call hooks for inter-invocation updates before `onInvocationStart` is dispatched and before the handler begins execution

### Requirement 4: Preserve existing onOperationChange behavior

**User Story:** As a plugin author, I want the existing `onOperationChange` hook to continue firing with the same semantics as before, so that plugins relying on change notifications are not broken by this refactoring.

#### Acceptance Criteria

1. WHEN the Checkpoint_Manager detects that one or more operations have a different `Status` value in the checkpoint response compared to the previously stored `stepData`, THE Plugin_System SHALL call `onOperationChange` with an `OperationChangeInfo` containing `requestId`, `executionArn`, `updatedOperations` (only the operations whose status changed), and the full `operations` record (all operations in `stepData`)
2. THE `onOperationChange` hook signature and `OperationChangeInfo` interface (containing `requestId: string`, `executionArn: string`, `updatedOperations: Record<string, Operation>`, `operations: Record<string, Operation>`) SHALL remain unchanged from the current implementation
3. IF the `onOperationChange` hook throws a synchronous error or returns a rejected promise, THEN THE Plugin_System SHALL swallow the error and continue execution without interrupting checkpoint processing or other plugin dispatch

### Requirement 5: Preserve wrapOperationAttemptFn behavior

**User Story:** As a plugin author, I want the `wrapOperationAttemptFn` hook to continue wrapping step execution, so that tracing and instrumentation plugins can still inject middleware around user code execution.

#### Acceptance Criteria

1. WHEN a step is about to execute the user's step function, THE step-handler module SHALL call `wrapOperationAttemptFn` with an `AttemptInfo` parameter and the user's step function, and SHALL use the hook's return value as the step execution result
2. WHEN a step retries due to a failed attempt, THE step-handler module SHALL call `wrapOperationAttemptFn` again on each subsequent attempt with an updated `AttemptInfo` reflecting the current attempt number
3. THE `AttemptInfo` parameter passed to `wrapOperationAttemptFn` SHALL include the operation Id, Name, Type, SubType, ParentId, and the current attempt number (1-indexed), constructed from the local operation state after the checkpoint START request has been issued
4. IF the `wrapOperationAttemptFn` hook is not defined on the plugin, THEN THE step-handler module SHALL execute the user's step function directly without wrapping

### Requirement 5a: Wire wrapChildContextFn in run-in-child-context-handler

**User Story:** As a plugin author, I want the `wrapChildContextFn` hook to wrap child context execution, so that tracing and instrumentation plugins can inject middleware around grouped operations within `runInChildContext`.

#### Acceptance Criteria

1. WHEN a child context is about to execute the user's child function (in `executeChildContext`), THE run-in-child-context-handler module SHALL call `wrapChildContextFn` with an `OperationInfo` parameter and the user's child function, and SHALL use the hook's return value as the child context execution result
2. THE `OperationInfo` parameter passed to `wrapChildContextFn` SHALL include the operation Id (hashed), Name, Type (`CONTEXT`), SubType (e.g., `RUN_IN_CHILD_CONTEXT`), and ParentId (hashed if present), derived from the operation's local state
3. IF the `wrapChildContextFn` hook is not defined on the plugin, THEN THE run-in-child-context-handler SHALL execute the user's child function directly without wrapping
4. WHEN a child context has already completed (replay path), THE run-in-child-context-handler SHALL NOT call `wrapChildContextFn` since the user function is not being re-executed for real work

### Requirement 6: Plugin error isolation

**User Story:** As an SDK user, I want plugin errors in checkpoint-driven hooks to never affect the SDK's checkpoint processing or execution flow, so that faulty plugins cannot break my durable function.

#### Acceptance Criteria

1. IF a plugin throws a synchronous error in any hook dispatched via the composite plugin (from `createPluginRunner`), THEN the error SHALL be swallowed without re-throwing, other registered plugins SHALL still receive the hook call, and checkpoint processing SHALL proceed normally
2. IF a plugin returns a rejected promise from any hook dispatched via the composite plugin, THEN the rejection SHALL be suppressed (no unhandled promise rejection emitted) and no error SHALL propagate to the checkpoint processing logic or the caller
3. THE Checkpoint_Manager SHALL complete checkpoint processing (updating step data, resolving waiting operations, emitting stepDataUpdated events) regardless of whether any plugin hook throws a synchronous error or returns a rejected promise
4. THE error isolation behavior is provided by `createPluginRunner` — individual call sites (CheckpointManager, initializeExecutionContext) do NOT need additional error wrapping

### Requirement 7: Remove onOperationAttemptStart and onOperationAttemptEnd from plugin interface

**User Story:** As an SDK maintainer, I want the `onOperationAttemptStart` and `onOperationAttemptEnd` hooks removed from the plugin interface along with the `AttemptEndInfo` and `AttemptEndInfoOutcome` types, so that the plugin API is simplified and attempt-level instrumentation is consolidated in `wrapOperationAttemptFn`.

#### Acceptance Criteria

1. THE DurableInstrumentationPlugin interface SHALL NOT include the `onOperationAttemptStart` method
2. THE DurableInstrumentationPlugin interface SHALL NOT include the `onOperationAttemptEnd` method
3. THE `AttemptEndInfo` interface SHALL be removed from the type definition file (`src/types/plugin.ts`) and from all barrel/index re-exports
4. THE `AttemptEndInfoOutcome` enum SHALL be removed from the type definition file (`src/types/plugin.ts`) and from all barrel/index re-exports
5. THE `AttemptInfo` interface SHALL be preserved in `src/types/plugin.ts` and SHALL continue to be exported, as it is used by `wrapOperationAttemptFn`
6. THE Plugin_System SHALL NOT dispatch `onOperationAttemptStart` or `onOperationAttemptEnd` calls to plugins from any location, including the Checkpoint_Manager, the Hook_Dispatcher, or any Operation_Handler
7. THE step-handler, invoke-handler, wait-handler, and callback-handler modules SHALL NOT contain any source-level invocations of `onOperationAttemptStart` or `onOperationAttemptEnd` on the plugin object
8. THE SDK SHALL compile successfully with zero TypeScript errors after all `onOperationAttemptStart`, `onOperationAttemptEnd`, `AttemptEndInfo`, and `AttemptEndInfoOutcome` references are removed
9. THE Plugin_System SHALL remove or update all unit tests that reference `onOperationAttemptStart`, `onOperationAttemptEnd`, `AttemptEndInfo`, or `AttemptEndInfoOutcome` so that the test suite passes without errors

### Requirement 8: Updated plugin interface contract

**User Story:** As a plugin author, I want the `DurableInstrumentationPlugin` interface to reflect the simplified hook set, so that I understand which hooks are available for instrumentation after this refactoring.

#### Acceptance Criteria

1. THE `DurableInstrumentationPlugin` interface SHALL include the following method signatures: `onOperationStart`, `onOperationEnd`, `wrapOperationAttemptFn`, `wrapChildContextFn` (operation hooks), `onInvocationStart`, `wrapInvocation`, `onInvocationEnd` (invocation hooks), and `onOperationChange`, `enrichLogContext` (utility hooks)
2. THE `OperationInfo` interface SHALL NOT include the `HashedId` field or the `HashedParentId` field, and the `Id` and `ParentId` fields SHALL always contain hashed values (as returned by the checkpoint response). The remaining exported types (`OperationEndInfo`, `AttemptInfo`, `OperationChangeInfo`, `InvocationInfo`, `InvocationEndInfo`, `InvocationBaseInfo`, `PluginInvocationStatus`, `CustomerFn`, and `CustomerFnResult`) SHALL retain the same fields, field types, and field optionality as before the refactoring
3. WHEN a plugin implements any remaining hook method, THE Plugin_System SHALL call it with the same parameter types and structure as before the refactoring, such that a plugin compiled against the post-refactoring interface requires no source changes for the surviving hooks
4. THE order in which hooks are called for a single operation lifecycle SHALL be: `onOperationStart` → `wrapOperationAttemptFn` → `onOperationEnd`
5. IF a plugin hook throws a synchronous exception or returns a rejected promise, THEN THE Plugin_System SHALL swallow the error without propagating it to the caller or interrupting SDK execution, preserving the existing error-isolation contract
