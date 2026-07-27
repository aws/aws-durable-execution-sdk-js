# DAG Implementation Tasks — TypeScript / JS (`@aws/durable-execution-sdk-js`)

> Source of truth: [`DAG_SPEC.md`](./DAG_SPEC.md). Feature is **EXPERIMENTAL** — every exported DAG symbol MUST carry the repo's standard `@experimental` TSDoc tag (§0 of spec header).
>
> **Base-SDK prerequisite: NONE.** The canonical SDK already ships every reused primitive (steps, invoke, callback, wait, waitForCondition, runInChildContext, map, parallel, child-context handlers, serdes, replay validation, termination manager). DAG is a pure addition on top of the current mainline — no base-SDK feature must land first. Contrast Python/Java/Go, which have base-SDK prerequisites (see `DAG_TASKS_CROSS_LANGUAGE.md`).
>
> Ordering below is a landing sequence: each task is PR-sized and depends only on earlier tasks. Package root for all paths: `packages/aws-durable-execution-sdk-js/`.

---

## T1 — Core completion-reason extraction (`core.ts`) + base-type layering

- **Spec:** §7.2
- **Files changed:**
  - `src/types/core.ts` — add the 5-member `CompletionReason` (extracted here as the neutral base).
  - `src/types/batch.ts` — remove local `CompletionReason`; `import { CompletionReason } from "./core"` for internal use; do NOT re-export (barrel already surfaces via `export * from "./core"`).
  - `src/errors/durable-error/durable-error.ts` — update `import type { CompletionReason }` from `"../../types/batch"` → `"../../types/core"`.
- **Depends on:** —
- **Acceptance:**
  1. `tsc` + full existing suite pass with zero behavior change to map/parallel (`BatchResult.completionReason` still the 5-member type).
  2. No duplicate-export error from the `src/types/index.ts` barrel.
  3. `CompletionReason` is defined once (in `core.ts`) and imported everywhere else.

## T2 — Public DAG types (`src/types/dag.ts`)

- **Spec:** §2 (all), §2.8 `DagCompletionReason` superset, §2.9 `DagConfig`/`DagCompletionConfig`
- **Files created:** `src/types/dag.ts` — `DagContext`, `TaskHandle`/`AnyTaskHandle`, `DepsMap`, `StepTaskFn`/`PayloadTaskFn`/`SubmitterTaskFn`/`CheckTaskFn`/`ChildTaskFn`, `ConditionalConfig`, `TriggerRule`, `TaskStatus`/`SkipReason`, `TaskExecution`, `DagResult`, `DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES"`, `DagConfig`/`NestedDagConfig`, `DagCompletionConfig`/`DagCompletionItemStatus`/`DagCompletionStatus`/`DagCustomCompletionConfig`.
- **Depends on:** T1 (imports `CompletionReason` from `core`; reuses `ThresholdCompletionConfig`/`CompletionDecision` from `batch`).
- **Acceptance:**
  1. Every exported symbol carries `@experimental This <symbol> is experimental and may be changed or removed in future releases.`
  2. `DepsMap<[]>` resolves to `{}`; deps-first conditional fn types collapse to native shape when `TDeps` is empty (verified by `tsd`/`expectType` stubs later in T13).
  3. No runtime code in this file (types only); `tsc` clean.

## T3 — DAG error classes (`dag-errors.ts`) + error registry hook

- **Spec:** §5.10, §7.2
- **Files created:** `src/errors/dag-errors/dag-errors.ts` — `DagCyclicDependencyError`, `DagInvalidTaskNameError`, `DagDuplicateTaskError`, `DagInvalidDependencyError`, `DagExecutionError extends DurableOperationError` (`errorType = "DagExecutionError"`, carries first failed task's `error` as `cause`).
- **Files changed:** `src/errors/durable-error/durable-error.ts` — register `"DagExecutionError"` in `DurableOperationError.fromErrorObject`.
- **Depends on:** —
- **Acceptance:**
  1. All error classes carry `@experimental`.
  2. `DagExecutionError` round-trips through `toErrorObject`/`fromErrorObject`.
  3. `errorType` string matches the registry key exactly.

## T4 — `OperationSubType.DAG` enum member

- **Spec:** §7.2
- **Files changed:** `src/types/durable-execution.ts` — add `DAG = "Dag"` to `OperationSubType`.
- **Depends on:** —
- **Acceptance:**
  1. `tsc` clean; existing exhaustiveness switches over `OperationSubType` still compile (add cases where required).
  2. No change to task-level subtypes (`STEP`, `CHAINED_INVOKE`, etc. stay native).

## T5 — `createTaskId` + Family-A explicit-ID variants (no batch)

- **Spec:** §7.3, §7.3.1, §7.3.2 (step / invoke / wait / waitForCondition / runInChildContext)
- **Files changed:** `src/context/durable-context/durable-context.ts` — add `@internal` `createTaskId(name)`, `NOOP_REPLAY_MODE`, and: `runStepWithExplicitId`, `runInvokeWithExplicitId` (pass `NOOP_REPLAY_MODE` at 5th positional), `runWaitWithExplicitId` (`NOOP_REPLAY_MODE` at 5th positional), `runWaitForConditionWithExplicitId` (NO mode param — swap `createStepId` only), `runInChildContextWithExplicitId`.
- **Depends on:** T4 (subtype), T2 (types referenced in signatures).
- **Acceptance:**
  1. Variants do NOT wrap in `withDurableModeManagement`; each mints `() => this.createTaskId(name)` and never advances `_stepCounter`.
  2. `createTaskId` returns `${prefix}-DAG_NODE_T_${name}` (or `DAG_NODE_T_${name}` unprefixed); unit-tested for prefixed/unprefixed/nested recursion and no collision with counter IDs.
  3. No `checkAndUpdateReplayMode` no-op is injected into `createStepHandler`/`createWaitForConditionHandler`/`createRunInChildContextHandler` (would corrupt their `logger`/factory positional).

## T6 — Family-B (submitter callback) + batch/nested explicit-ID variants

- **Spec:** §7.3.2 (`runCallbackTaskWithExplicitId`, `_executeConcurrentlyWithExplicitId`, `runMapWithExplicitId`, `runParallelWithExplicitId`, `runDagWithExplicitId`), F6
- **Files changed:** `src/context/durable-context/durable-context.ts` — add the above `@internal` variants. Container `runInChildContext` binding into `createConcurrentExecutionHandler` is the explicit-ID variant; per-item children stay counter-based (deterministic array order).
- **Depends on:** T5.
- **Acceptance:**
  1. `runCallbackTaskWithExplicitId` runs the submitter inside `runInChildContextWithExplicitId` (container = `DAG_NODE_T_{name}`, internal callback child = `DAG_NODE_T_{name}-1`).
  2. `_executeConcurrentlyWithExplicitId` does NOT reuse `_executeConcurrently`, skips `withDurableModeManagement`, and injects the explicit-ID container binding; `concurrent-execution-handler.ts` is unchanged.
  3. `runDagWithExplicitId` wires `createDagHandler` with `runInChildContextWithExplicitId` for the nested container.

## T7 — `TaskHandleImpl` (reference + builder)

- **Spec:** §2.4, §3
- **Files created:** `src/handlers/dag-handler/task-handle.ts` — `TaskHandleImpl` with `name`, `_id: symbol`, phantom `_resultType`, chainable `.after(...)` and `.triggerRule(...)` mutating the backing `TaskDef`.
- **Depends on:** T2.
- **Acceptance:**
  1. `@experimental` on exported surface; `_id` is a `symbol` and is never serialized.
  2. `.after(...)` appends to `allDeps` only; inline deps populate both `inlineDeps` and `allDeps` (unit-tested in T13).
  3. Builder methods return `this` for chaining.

## T8 — `trigger-rules.ts` (evaluators)

- **Spec:** §2.7, §5.3, F8 (empty-upstream)
- **Files created:** `src/handlers/dag-handler/trigger-rules.ts` — `triggerRuleEvaluators: Record<TriggerRule, (statuses: TaskStatus[]) => boolean>` incl. the `s.length > 0` guard on `ALL_FAILED`.
- **Depends on:** T2.
- **Acceptance:**
  1. Full §5.3 truth table (6 rules × {empty, all-succ, all-fail, mixed, includes-skip}) passes in T13.
  2. Empty-upstream: success/done-family run, failure-family skip.

## T9 — `dag-validator.ts`

- **Spec:** §6 (all), §4.2 injectivity
- **Files created:** `src/handlers/dag-handler/dag-validator.ts` — name rules (`^[a-zA-Z0-9_]+$`, ≤100, no `DAG_NODE_T_` substring), duplicate detection, missing-dep check (over `allDeps`), Kahn cycle detection over `allDeps`. Throws the matching `Dag*Error`.
- **Depends on:** T3, T7.
- **Acceptance:**
  1. Rejects dash names and `DAG_NODE_T_`-embedding names with `DagInvalidTaskNameError`; accepts `T_shirt`, `count_T`, `fetch_data`.
  2. Cycle detection uses `allDeps` (not `inlineDeps`) and returns the cyclic node list.
  3. Foreign-scope dep handle ⇒ `DagInvalidDependencyError`.

## T10 — `DagContextImpl` (registration) + `TaskDef`

- **Spec:** §2.2, §2.3 deps-first rule, §7.5, F7 (`inlineDeps` vs `allDeps`)
- **Files created:** `src/handlers/dag-handler/dag-context.ts` — `DagContextImpl` with `step`/`invoke`/`callback`/`wait`/`waitForCondition`/`runInChildContext`/`map`/`parallel`/`dag`; internal `TaskDef` (fields per §7.5); eager name+duplicate validation on each registration; `executor` closures applying the deps-first rule and delegating to the T5/T6 explicit-ID variants.
- **Depends on:** T5, T6, T7, T9.
- **Acceptance:**
  1. Each method returns a `TaskHandleImpl`; executors are NOT invoked during registration.
  2. `executor` closure builds `depsMap` from `inlineDeps` only; `runIf`/`triggerRule` stored on `TaskDef`, not passed to handlers.
  3. `@experimental` on the public `DagContext` impl surface.

## T11 — `dag-executor.ts` (topological scheduler)

- **Spec:** §5 (all), §5.7/§5.8 completion & failure model
- **Files created:** `src/handlers/dag-handler/dag-executor.ts` — `DagExecutor` with `results`/`inFlight`/ready-set, `tryStartNext` (respects `maxConcurrency`), trigger-rule + `runIf` gating, skip propagation, drain-by-default failure semantics, `DagCompletionConfig` threshold + custom paths mapping to `DagCompletionStatus`. (Also declares `reconstructDagResult` signature; body lands in T12.)
- **Depends on:** T8, T10.
- **Acceptance:**
  1. Default (no `completionConfig`) drains the reachable graph; `completionReason` = `ALL_COMPLETED` (clean) or `COMPLETED_WITH_FAILURES` (≥1 failure); DAG promise does NOT reject on task failure.
  2. `maxConcurrency` throttles top-level task starts; in-flight tasks not cancelled at early completion (appear `STARTED`); never-started tasks absent from `results`.
  3. Empty DAG resolves immediately with `totalCount: 0`, `ALL_COMPLETED`.

## T12 — `DagResult` + serdes + container envelope + reconstruction

- **Spec:** §2.8, §8, §8.1, §7.7
- **Files created:** `src/handlers/dag-handler/dag-result.ts` — `DagResultImpl` (`getResult`/`getStatus`/`succeeded`/`failed`/`skipped`/counts/`completionReason`/`throwIfError`), `createDagResultSerdes` with `resultKind` discriminator (`plain`/`batch`/`dag`, recursive restore via `restoreBatchResult`/`restoreDagResult`), `buildDagOffloadPayload`/`readDagEnvelope`.
- **Files changed:** `src/handlers/dag-handler/dag-executor.ts` — implement `reconstructDagResult` (re-run deterministic register + skip/trigger recompute, read per-task checkpoints, source counts/reason/`startedTaskNames` from envelope; empty STARTED set on missing/malformed envelope, never hang).
- **Depends on:** T11.
- **Acceptance:**
  1. Serdes round-trips heterogeneous results: `map`/`parallel` restore to methoded `BatchResult`, nested `dag` to methoded `DagResult` (recursive); errors via `to/fromErrorObject`.
  2. `throwIfError()` throws `DagExecutionError` when `failureCount > 0` OR `completionReason === "CUSTOM_COMPLETION_FAILED"`.
  3. `DagSummary` is SDK-owned: customer `summaryGenerator` output stored only under `summary`, never read on replay; malformed/missing envelope derives from checkpoints without live re-scheduling.

## T13 — `createDagHandler` + config guards + replay-mode branch

- **Spec:** §7.4, §9.4, F12, §5.10 (register throws)
- **Files created:** `src/handlers/dag-handler/dag-handler.ts` — `createDagHandler(runInChildContext, makeExecutorContext, executionContext)`; pre-body guards (`maxConcurrency <= 0` throws plain `Error`; `validateDagCompletionConfig` terminates with `CONFIG_VALIDATION_ERROR` + never-resolving promise); child-context body runs `register` → `validateDag` → replay-mode branch (`ReplaySucceededContext` ⇒ `reconstructDagResult`, else `DagExecutor.run()`); wires `subType: DAG`, `serdes`, SDK envelope `summaryGenerator`, and `errorMapper: (e) => e`.
- **Depends on:** T9, T11, T12.
- **Acceptance:**
  1. Graph-shape `Dag*Error`s and deterministic `register` throws surface UNWRAPPED (pass-through errorMapper), not as `ChildContextError`.
  2. Config guards fire before the child context is entered (pure functions of `config`); `validateDag` runs after `register` inside the body.
  3. Large-payload completed replay reconstructs (does not re-schedule) and does not read `summary`.

## T14 — Wire `dag()` into `DurableContext`

- **Spec:** §2.1, §7.2, §7.4
- **Files changed:**
  - `src/types/durable-context.ts` — add `dag(name, register, config?): DurablePromise<DagResult>` to `DurableContext<TLogger>` (with `@experimental`).
  - `src/context/durable-context/durable-context.ts` — implement `dag()` wiring `createDagHandler` with `this.runInChildContext.bind(this)` (top-level container = counter slot) + explicit-ID accessors; nested `dag` task uses `runDagWithExplicitId`.
- **Depends on:** T6, T13.
- **Acceptance:**
  1. `context.dag(...)` returns a `DurablePromise<DagResult>`; `@experimental` on the interface method.
  2. Top-level container checkpoints as a `DAG` subtype node (counter ID in parent); nested containers get `DAG_NODE_T_{name}`.
  3. `tsc` + existing suite unaffected (pure addition).

## T15 — Unit tests

- **Spec:** §12.1
- **Files created:** `dag-validator.test.ts`, `trigger-rules.test.ts`, `task-handle.test.ts` (incl. `tsd`/`expectType` `DepsMap` type tests), `dag-executor.test.ts` (mock context), `dag-result.test.ts`, and `createTaskId` entity-ID tests — all under `src/handlers/dag-handler/`.
- **Depends on:** T5–T13.
- **Acceptance:**
  1. Cycle/name/duplicate/missing-dep coverage; full trigger-rule truth table; readiness/throttle/skip/`runIf`/completion paths; serdes round-trip incl. error reconstruction.
  2. `DepsMap` type-level tests pass for empty vs non-empty deps and name-keyed result typing.
  3. Entity-ID tests cover nested recursion and counter-ID disjointness.

## T16 — `LocalDurableTestRunner` integration + replay tests

- **Spec:** §12.2, §12.3
- **Files created:** `*.composed.test.ts` + `dag-handler.replay.test.ts` under `src/handlers/dag-handler/` (follow existing `concurrent-execution-handler.replay.test.ts` patterns).
- **Depends on:** T14.
- **Acceptance:**
  1. Diamond concurrency, mixed-op-type tasks (each native subtype under a `DAG_NODE_T_`-derived id), compensation (`ALL_FAILED`/`ALL_DONE`), `runIf` branching, nested DAG scope isolation, custom-completion early stop all pass.
  2. Order-independence replay (B-before-C vs C-before-B) yields identical `DagResult` with no `NonDeterministicExecutionError`.
  3. Large-payload replay reconstructs an equal `DagResult` from envelope + per-task nodes; custom/malformed `summary` neither changes the result nor hangs (the #751 regression guard).

## T17 — Exports + docs

- **Spec:** §7.2, spec header (`@experimental`)
- **Files changed:** `src/index.ts`, `src/types/index.ts` — re-export DAG public types + errors. Docs: DAG section in `src/documents/CONCEPTS.md` (or a new doc) covering worked examples §13.
- **Depends on:** T2, T3, T14.
- **Acceptance:**
  1. All DAG public symbols exported and still tagged `@experimental` (API Extractor treats them as `@beta`, excluded from a `public`-trimmed rollup).
  2. `npm run build` (API Extractor incl.) passes with no unexpected public-surface additions.
  3. Docs compile in examples (typecheck of snippets where applicable).

---

Total: 17 tasks.
