# Sub-project 1: Plugin Interface — TypeScript SDK Core

## Status: In Progress

---

## Done ✅

- **`src/types/plugin.ts`** — `DurableInstrumentationPlugin` interface and all supporting types (`InvocationInfo`, `OperationInfo`, `AttemptInfo`, `AttemptEndInfo`, `ExecutionEndInfo`, `OperationChangeInfo`)
- **`src/utils/plugin/plugin-runner.ts`** — `createPluginRunner(plugins)` fan-out runner with error isolation and fire-and-forget semantics
- **`src/types/durable-execution.ts`** — `plugins?: DurableInstrumentationPlugin[]` added to `DurableExecutionConfig`
- **`src/types/index.ts`** — plugin types exported
- **`src/with-durable-execution.ts`** — `onExecutionStart`, `onInvocationStart`, `onExecutionEnd`, `onInvocationEnd` wired
- **`src/utils/checkpoint/checkpoint-manager.ts`** — `onOperationChange` wired (fires only when ≥1 status changed)
- **`shouldSampleExecution`** — implemented in `plugin.ts`
- **`src/plugin.test.ts`** — tests for all wired hooks, fan-out, error isolation, `enrichLogContext`, `shouldSampleExecution`
- **`src/documents/PLUGIN_IMPLEMENTATION.md`** — implementation notes

---

## Remaining ❌

### Wire operation/attempt hooks into handlers

Each handler needs to call `onOperationStart`, `onOperationEnd`, `onOperationAttemptStart`, `onOperationAttemptEnd` at the right points. The plugin must be threaded through the context or passed directly to each handler.

| Handler           | File                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| step              | `src/handlers/step-handler/step-handler.ts`                                 |
| wait              | `src/handlers/wait-handler/wait-handler.ts`                                 |
| invoke            | `src/handlers/invoke-handler/invoke-handler.ts`                             |
| parallel          | `src/handlers/parallel-handler/parallel-handler.ts`                         |
| map               | `src/handlers/map-handler/map-handler.ts`                                   |
| runInChildContext | `src/handlers/run-in-child-context-handler/run-in-child-context-handler.ts` |
| waitForCallback   | `src/handlers/wait-for-callback-handler/wait-for-callback-handler.ts`       |
| waitForCondition  | `src/handlers/wait-for-condition-handler/wait-for-condition-handler.ts`     |

### Wire `enrichLogContext` into the SDK logger

`src/utils/logger/default-logger.ts` — call `plugin.enrichLogContext?.()` before each log line and merge the result into the structured log output. The logger currently has no plugin reference; it needs to be passed in or accessed via context.

### Export `shouldSampleExecution` from public `index.ts`

Currently exported from `src/types/index.ts` but needs to be verified it reaches the package's public `src/index.ts` barrel export.
