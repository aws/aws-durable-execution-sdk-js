# Plugin System — Implementation Notes

This document describes the implementation of the `DurableInstrumentationPlugin` system in the TypeScript SDK. It covers what was changed, why, and the key decisions made during implementation.

---

## Files Changed

### New Files

| File                                | Purpose                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/plugin.ts`               | Defines all plugin types: `DurableInstrumentationPlugin`, `OperationInfo`, `AttemptInfo`, `AttemptEndInfo`, `InvocationInfo`, `ExecutionEndInfo`, `OperationChangeInfo`, and the `shouldSampleExecution` helper |
| `src/utils/plugin/plugin-runner.ts` | `createPluginRunner(plugins)` — wraps an array of plugins into a single fan-out object that calls all registered plugins for each hook                                                                          |
| `src/plugin.test.ts`                | Tests for all wired hooks, fan-out behavior, error isolation, `enrichLogContext` merging, and `shouldSampleExecution`                                                                                           |

### Modified Files

| File                                         | Change                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/durable-execution.ts`             | Added `plugins?: DurableInstrumentationPlugin[]` to `DurableExecutionConfig`                                                                       |
| `src/types/index.ts`                         | Exports plugin types (named exports only — avoids name conflict with internal `OperationInfo` from `operation-lifecycle.ts`)                       |
| `src/with-durable-execution.ts`              | Wires `onExecutionStart`, `onInvocationStart`, `onExecutionEnd`, `onInvocationEnd`; creates the plugin runner and passes it to `CheckpointManager` |
| `src/utils/checkpoint/checkpoint-manager.ts` | Wires `onOperationChange`; accepts `plugin` and `requestId` as constructor params                                                                  |

---

## How It Works

`withDurableExecution` creates a single plugin runner from the array of registered plugins and passes it through the call chain:

```
withDurableExecution(handler, { plugins: [pluginA, pluginB] })
  └── createPluginRunner([pluginA, pluginB])  → single fan-out object
        └── passed to runHandler()
              ├── onExecutionStart / onInvocationStart called here
              ├── passed to CheckpointManager (for onOperationChange)
              └── onExecutionEnd / onInvocationEnd called here
```

The plugin runner's methods each call the corresponding method on every registered plugin. A single call to `plugin.onInvocationEnd(info)` calls `pluginA.onInvocationEnd(info)` and `pluginB.onInvocationEnd(info)`.

---

## Decision: Which Hooks Are Awaited

Plugin hooks can be sync or async. The runner handles both, but only two hooks are awaited by the SDK:

| Hook              | Awaited            | Rationale                                                                                 |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `onExecutionEnd`  | ✅                 | Plugin may need to write a summary record or flush data before the invocation ends        |
| `onInvocationEnd` | ✅                 | Plugin must flush spans/metrics before Lambda freezes — this is the only safe flush point |
| All other hooks   | ❌ fire-and-forget | Must not add latency to step execution, checkpoint processing, or invocation startup      |

For fire-and-forget hooks, if the plugin returns a Promise, the runner attaches a no-op `.catch()` to prevent unhandled rejection warnings — but does not await it.

---

## Decision: Error Isolation

Plugin errors must never affect SDK execution. Every hook call is wrapped in a try/catch:

```typescript
try {
  const result = plugin.onOperationStart?.(info);
  if (result?.catch) result.catch(() => {}); // swallow async errors
} catch {
  // swallow sync errors
}
```

For awaited hooks (`onExecutionEnd`, `onInvocationEnd`), errors are also swallowed:

```typescript
for (const plugin of plugins) {
  try {
    await plugin.onInvocationEnd?.(info);
  } catch {
    // plugin error — SDK continues normally
  }
}
```

A buggy or slow plugin cannot crash the SDK, cause a Lambda timeout, or affect the execution result.

---

## Decision: `OperationInfo` Field Names Mirror `Operation`

The `OperationInfo` type passed to operation hooks uses the same field names as `Operation` from `@aws-sdk/client-lambda` (`Id`, `Name`, `Type`, `SubType`, `ParentId`, `StartTimestamp`). This makes it easier for plugin authors who also work with `operations: Record<string, Operation>` from `onExecutionEnd` and `onOperationChange` — consistent naming across the interface.

---

## Decision: `onOperationChange` Only Fires on Status Changes

`CheckpointManager.updateStepDataFromCheckpointResponse` is called after every checkpoint batch. However, `onOperationChange` only fires when at least one operation's status changed in the response. This avoids unnecessary plugin invocations for checkpoint responses that only update metadata without changing operation state.

---

## What Is Not Yet Wired

The operation/attempt hooks (`onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`, `onOperationAttemptEnd`) are defined in the interface and runner but not yet wired into the individual handlers (step, wait, invoke, parallel, map, runInChildContext, waitForCallback, waitForCondition). That is sub-project 1's remaining work.
