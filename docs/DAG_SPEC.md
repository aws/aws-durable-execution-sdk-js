# DAG Support (`context.dag()`) — Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature.** The entire surface described in this document — `context.dag()`, `DagContext`, `TaskHandle`, `DepsMap`, `DagResult`, `DagConfig`, `TriggerRule`, `runIf`, the `DagSummary` envelope, and all associated types and errors — is **experimental and may be changed or removed in future releases** without a major-version bump. Do not depend on it in production until it is promoted to stable.
>
> **Required API annotation.** Every exported DAG symbol MUST carry the repo's standard TSDoc experimental tag (already used on 22 existing symbols, e.g. `src/types/plugin.ts`):
>
> ```ts
> /**
>  * ...summary...
>  *
>  * @experimental This <symbol> is experimental and may be changed or removed in future releases.
>  */
> ```
>
> API Extractor treats `@experimental` as `@beta`-equivalent, so these symbols are excluded from a future `public`-trimmed `.d.ts` rollup. The equivalent per-language experimental annotations (Python/Java/Go) are specified in each language spec and summarized in [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md).

Status: Draft (implementation-ready) · **Stability: Experimental** · Target: `@aws/durable-execution-sdk-js` v1 · Scope: core package `packages/aws-durable-execution-sdk-js`

This spec is grounded in the current codebase (commit state as of authoring). Where the source design docs in `Downloads/DAG/` diverge from the code, this spec follows the **code** and calls out the divergence in a **[CODE NOTE]** callout.

---

## 1. Overview

`context.dag()` adds a first-class primitive for declaring a **directed acyclic graph of tasks** with dependencies. Customers describe the graph once in a declarative _registration phase_; the runtime then schedules tasks topologically, runs independent chains concurrently, evaluates per-task trigger rules and `runIf` predicates, and aggregates results into a `DagResult`.

A DAG is implemented as a **child context** (one `runInChildContext` node in the parent's operation tree) whose body runs a **name-based scheduler**. Each task delegates to the **same operation handler** the equivalent `DurableContext` method uses (`createStepHandler`, `createInvokeHandler`, etc.), the only difference being that the task's entity ID is derived from its **name** (`{parentId}-DAG_NODE_T_{name}`) instead of the per-context monotonic counter. This is what makes DAGs replay-safe for arbitrary graph shapes.

### 1.1 Motivation

The SDK assigns each operation an entity ID from a per-context monotonic counter (`DurableContextImpl.createStepId()` in `src/context/durable-context/durable-context.ts`):

```ts
private createStepId(): string {
  this._stepCounter++;
  return this._stepPrefix ? `${this._stepPrefix}-${this._stepCounter}` : `${this._stepCounter}`;
}
```

IDs are assigned at operation **start**. `parallel`/`map` are replay-safe because `ConcurrentExecutionController.executeItemsConcurrently` starts items in **deterministic array order** (`currentIndex++`), so IDs never depend on completion order. In an arbitrary DAG, a downstream task starts when its upstream deps _complete_, and completion order can vary across replays — so counter-based IDs would diverge and `validateReplayConsistency` (`src/utils/replay-validation/replay-validation.ts`) would terminate the execution with a `NonDeterministicExecutionError`. DAG solves this with name-based IDs (§5).

Secondary motivations (from the customer brief): declarative typed data-flow, maximum natural parallelism, per-task trigger rules for compensation/fallback, `runIf` conditional skips, heterogeneous task types, nested DAGs, and start-time cycle detection.

### 1.2 Goals

- Declarative task-graph API with typed data-flow (`DepsMap`).
- Replay-safe for **any** graph shape, completion order, or timing.
- Reuse existing checkpoint/replay/retry/serdes machinery unchanged.
- Per-task `triggerRule` and `runIf`.
- Heterogeneous tasks: `step`, `invoke`, `callback`, `wait`, `waitForCondition`, `runInChildContext`, `map`, `parallel`, nested `dag`.
- Backward compatible: pure addition; `DurableContext` is unchanged; `DagContext` is a separate type.

### 1.3 Non-Goals (v1)

- Airflow-style dedicated branch operator (covered by `runIf`; deferred).
- Dynamic task creation at runtime (tasks spawning tasks).
- Cross-task resource pools / semaphores.
- Pre-built operators, cron scheduling, custom UI.

---

## 2. Public API

All new public types live in `src/types/dag.ts` and are re-exported from `src/index.ts` and `src/types/index.ts`.

### 2.1 Entry point (added to `DurableContext`)

```ts
// Addition to interface DurableContext<TLogger> in src/types/durable-context.ts
dag(
  name: string,
  register: (dagCtx: DagContext<TLogger>) => void | Promise<void>,
  config?: DagConfig,
): DurablePromise<DagResult>;
```

- `register` is a **registration-only** callback: tasks are _declared_ but do not execute until it returns.
- Returns a `DurablePromise<DagResult>` — consistent with every other `DurableContext` operation (all return `DurablePromise`, see `src/types/durable-promise.ts`). It resolves after the scheduler finishes.

[CODE NOTE] The early-investigation doc typed the entry as `context.dag<TName>(...)`. The `TName` generic on the top-level call is unused (the top-level DAG result is not a dependency of anything), so it is dropped. Nested `dag()` on `DagContext` _does_ carry `TName` because it returns a `TaskHandle`.

### 2.2 `DagContext`

Separate type (does **not** extend `DurableContext`) so only declarative task methods are visible inside `register`. Each method registers exactly one task and returns a `TaskHandle`.

```ts
export interface DagContext<TLogger extends DurableLogger = DurableLogger> {
  step<TName extends string, TDeps extends readonly AnyTaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepTaskFn<TDeps, TResult, TLogger>,
    config?: StepConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  invoke<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TIn,
    TOut,
  >(
    name: TName,
    funcId: string,
    deps: TDeps,
    payloadFn: PayloadTaskFn<TDeps, TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TOut>;

  callback<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult = string,
  >(
    name: TName,
    deps: TDeps,
    submitter: SubmitterTaskFn<TDeps, TLogger>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  wait<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    duration: Duration,
    config?: ConditionalConfig<TDeps>,
  ): TaskHandle<TName, void>;

  waitForCondition<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TState,
  >(
    name: TName,
    deps: TDeps,
    check: CheckTaskFn<TDeps, TState, TLogger>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TState>;

  runInChildContext<
    TName extends string,
    TDeps extends readonly AnyTaskHandle[],
    TResult,
  >(
    name: TName,
    deps: TDeps,
    fn: ChildTaskFn<TDeps, TResult, TLogger>,
    config?: ChildConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  map<TName extends string, TDeps extends readonly AnyTaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TDeps extends readonly AnyTaskHandle[], TOut>(
    name: TName,
    deps: TDeps,
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  dag<TName extends string, TDeps extends readonly AnyTaskHandle[]>(
    name: TName,
    deps: TDeps,
    register: (subDagCtx: DagContext<TLogger>) => void | Promise<void>,
    config?: NestedDagConfig & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, DagResult>;
}
```

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `ChildConfig`, `MapConfig`, `ParallelConfig`, `MapFunc`, `ParallelFunc`, `NamedParallelBranch`, `Duration`, `BatchResult` are the **existing** SDK types (unchanged), reused verbatim so per-task retry/serdes/semantics/completion behavior is identical to the standalone operations.

### 2.3 Function-signature types (conditional on empty deps)

**Argument-order rule (uniform across all task kinds):** when `TDeps` is non-empty, `deps: DepsMap<TDeps>` is **always the first parameter**; the operation's native parameters follow in their normal order. When `TDeps` is empty, the deps parameter is omitted entirely and the signature collapses to the underlying SDK function's native shape. This single rule removes the argument-order inconsistency between task kinds.

[CODE NOTE — how the collapse is delivered] The conditional types below express the rule but cannot implement it on their own: a call site passing a bare `[]` does **not** infer `TDeps` as the empty tuple — TypeScript widens the literal to an array type, whose `length` is `number` — so the conditional always selects the deps-bearing branch. Writing the check as `TDeps["length"] extends 0` does not help, for the same reason. Every task kind whose callback has a native shape therefore carries an explicit **`deps: readonly []` overload** alongside its generic signature (both declared on `DagContext` and on `DagContextImpl`, since a class method with only one overload declaration hides its implementation signature from callers). Overload resolution matches on the parameter type instead of relying on inference, so no-deps call sites get the native shape without writing `[] as const` or spelling out every type argument. Without the overload the mis-typing is loud for `waitForCondition` (its native first parameter is `state`, so the call is rejected) and silent for the kinds whose native callback merely has fewer parameters — there the context parameter is typed as the deps map. `dag` and `wait` need no overload: neither takes a deps-position callback. Guarded by `dag-context.types.test.ts`.

**Separate, still-open limitation:** a conditional-typed callback parameter is not an inference site for the result type, so `TResult`/`TState` widen to `unknown` on deps-bearing calls unless the caller annotates the callback's return type (as the examples and conformance handlers do) or pins the type arguments. The overloads do not change this.

```ts
type StepTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TResult,
  TLogger extends DurableLogger,
> = TDeps extends readonly []
  ? (ctx: StepContext<TLogger>) => Promise<TResult>
  : (deps: DepsMap<TDeps>, ctx: StepContext<TLogger>) => Promise<TResult>;

type PayloadTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TIn,
> = TDeps extends readonly []
  ? () => TIn | Promise<TIn>
  : (deps: DepsMap<TDeps>) => TIn | Promise<TIn>;

type SubmitterTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TLogger extends DurableLogger,
> = TDeps extends readonly []
  ? (callbackId: string, ctx: WaitForCallbackContext<TLogger>) => Promise<void>
  : (
      deps: DepsMap<TDeps>,
      callbackId: string,
      ctx: WaitForCallbackContext<TLogger>,
    ) => Promise<void>;

type CheckTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TState,
  TLogger extends DurableLogger,
> = TDeps extends readonly []
  ? (state: TState, ctx: WaitForConditionContext<TLogger>) => Promise<TState>
  : (
      deps: DepsMap<TDeps>,
      state: TState,
      ctx: WaitForConditionContext<TLogger>,
    ) => Promise<TState>;

type ChildTaskFn<
  TDeps extends readonly AnyTaskHandle[],
  TResult,
  TLogger extends DurableLogger,
> = TDeps extends readonly []
  ? (ctx: DurableContext<TLogger>) => Promise<TResult>
  : (deps: DepsMap<TDeps>, ctx: DurableContext<TLogger>) => Promise<TResult>;
```

[CODE NOTE] The `step` task fn keeps the existing `StepContext<TLogger>` argument (logger + `attempt`), matching `StepFunc` in `src/types/step.ts` (the code passes `fn(stepContext)` in `step-handler.ts`). Likewise `SubmitterTaskFn` preserves the native `(callbackId, ctx)` shape from `WaitForCallbackSubmitterFunc` (`src/types/callback.ts`), `CheckTaskFn` preserves `(state, ctx)` from `WaitForConditionCheckFunc`, and `ChildTaskFn` preserves `(ctx)` from `ChildFunc`. In every non-empty-deps case the deps map is prepended as the first argument (per the rule above), so `deps` access is uniform while the operation's native arguments keep their usual relative order and meaning.

**Per-kind signatures at a glance.** For each task kind, the with-deps form is the no-deps form with `deps: DepsMap<TDeps>` prepended:

| Task kind                  | No-deps (`deps: []`)      | With-deps (`deps: [a, b]`)     |
| -------------------------- | ------------------------- | ------------------------------ |
| `step`                     | `(ctx) => …`              | `(deps, ctx) => …`             |
| `invoke` (payloadFn)       | `() => payload`           | `(deps) => payload`            |
| `callback` (submitter)     | `(callbackId, ctx) => …`  | `(deps, callbackId, ctx) => …` |
| `waitForCondition` (check) | `(state, ctx) => …`       | `(deps, state, ctx) => …`      |
| `runInChildContext`        | `(ctx) => …`              | `(deps, ctx) => …`             |
| `wait`                     | _(no fn — duration only)_ | _(no fn — duration only)_      |

**Worked examples (no-deps vs with-deps for each kind):**

```ts
// ── step: native arg is StepContext ────────────────────────────────────────
const fetch = dagCtx.step("fetch", [], async (ctx) => fetchSource());
const xform = dagCtx.step("xform", [fetch], async (deps, ctx) =>
  transform(deps.fetch),
);
//                                                   ^^^^  ^^^  deps first, then native ctx

// ── invoke: the "native arg" is the payload the fn must return ──────────────
dagCtx.invoke("charge", "payment-fn:prod", [], async () => ({ amount: 100 }));
dagCtx.invoke("charge", "payment-fn:prod", [validate], async (deps) => ({
  amount: deps.validate.amount,
}));

// ── callback: native args are (callbackId, ctx) ─────────────────────────────
dagCtx.callback("approval", [], async (callbackId, ctx) =>
  sendApproval(callbackId),
);
dagCtx.callback("approval", [charge], async (deps, callbackId, ctx) =>
  sendApproval(deps.charge.userId, callbackId),
);
//                                            ^^^^  ^^^^^^^^^^  ^^^  deps first, then native args

// ── waitForCondition: native args are (state, ctx) ──────────────────────────
dagCtx.waitForCondition(
  "poll",
  [],
  async (state, ctx) => ({ ...state, s: await check() }),
  opts,
);
dagCtx.waitForCondition(
  "poll",
  [job],
  async (deps, state, ctx) => ({ ...state, s: await check(deps.job.id) }),
  opts,
);

// ── runInChildContext: native arg is the child DurableContext ───────────────
dagCtx.runInChildContext("finalize", [], async (ctx) =>
  ctx.step("audit", () => audit()),
);
dagCtx.runInChildContext("finalize", [approval], async (deps, ctx) =>
  ctx.step("audit", () => audit(deps.approval)),
);
```

**Reminder — only inline deps populate the map.** Ordering-only deps added via the `.after(...)` builder (§3) gate scheduling but do **not** appear in `DepsMap`, so they never add a parameter:

```ts
// `a` is inline (typed, in deps map); `b` is ordering-only (waits for b, but no deps.b)
const e = dagCtx.step("e", [a], async (deps, ctx) => process(deps.a)).after(b);
//                                       deps === { a: <a's result> }   // no `b` key
```

### 2.4 `TaskHandle`

Registration-time reference + builder. **Never serialized** (`_id` is a `symbol`; it exists only during registration/scheduling in-memory).

```ts
export interface TaskHandle<TName extends string = string, TResult = unknown> {
  /** Customer-facing result key (used by getResult/getStatus/DepsMap). */
  readonly name: TName;
  /** @internal in-memory identity; not serialized */
  readonly _id: symbol;
  /** @internal phantom; carries TResult for DepsMap only */
  readonly _resultType?: TResult;

  /** Ordering-only deps: wait for these but do not receive their results. */
  after(...deps: readonly AnyTaskHandle[]): this;

  /** Trigger rule (default from DagConfig.defaultTriggerRule, else ALL_SUCCESS). */
  triggerRule(rule: TriggerRule): this;
}

export type AnyTaskHandle = TaskHandle<string, unknown>;
```

Builder methods mutate the underlying `TaskDef` and return `this` for chaining.

### 2.5 `DepsMap` type machinery

```ts
export type DepsMap<TDeps extends readonly AnyTaskHandle[]> = {
  [K in TDeps[number] as K["name"]]: K extends TaskHandle<string, infer R>
    ? R
    : never;
};
```

Empty deps ⇒ `TDeps[number]` is `never` ⇒ `DepsMap<[]>` is `{}`, so `StepTaskFn<[], ...>` collapses to the no-deps form.

[CODE NOTE — TYPE CAVEAT] `DepsMap` types every dep result as its declared `R`, but at **runtime** a dep's result is `undefined` unless that dep actually `SUCCEEDED`. This only matters for trigger rules other than `ALL_SUCCESS` (the default), where an upstream can be `FAILED`/`SKIPPED` and still let this task run. Documented behavior: with non-`ALL_SUCCESS` rules, treat `DepsMap` values as possibly-`undefined`. v1 does not weaken the static type (doing so would hurt the common `ALL_SUCCESS` path); this is called out in docs and an open question (§11).

### 2.6 `ConditionalConfig` (runIf)

```ts
export interface ConditionalConfig<TDeps extends readonly AnyTaskHandle[]> {
  /** Synchronous, deterministic predicate over resolved upstream results.
   *  Returns false => task is SKIPPED with skipReason "RUN_IF_PREDICATE". */
  runIf?: (deps: DepsMap<TDeps>) => boolean;
}
```

Sync-only by design (async predicates invite non-deterministic IO on replay). Evaluated **after** the trigger rule passes and **before** the operation runs. A predicate that **throws** aborts the whole DAG with a typed `DagPredicateError` — it is neither a task failure nor a skip (§5.4).

### 2.7 `TriggerRule`

```ts
export type TriggerRule =
  | "ALL_SUCCESS" // default
  | "ALL_FAILED"
  | "ALL_DONE"
  | "ANY_SUCCESS"
  | "ANY_FAILED"
  | "NONE_FAILED";
```

Default is `ALL_SUCCESS` (or `DagConfig.defaultTriggerRule`). For a task with **no** upstream deps the rule is evaluated against an empty set — see the empty-upstream row and `triggerRuleEvaluators` definitions in §5.3 (success/done-family rules run; failure-family rules skip).

### 2.8 `DagResult` / `TaskExecution`

```ts
export type TaskStatus = "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";
export type SkipReason = "TRIGGER_RULE" | "RUN_IF_PREDICATE";

export interface TaskExecution<TResult = unknown> {
  name: string;
  status: TaskStatus;
  skipReason?: SkipReason; // present only when status === "SKIPPED"
  result?: TResult; // present only when status === "SUCCEEDED"
  error?: DurableOperationError; // present only when status === "FAILED"
  startedAt?: Date;
  completedAt?: Date;
}

export interface DagResult {
  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;
  getStatus(taskNameOrHandle: string | AnyTaskHandle): TaskStatus | undefined;

  succeeded(): TaskExecution[];
  failed(): TaskExecution[];
  skipped(): TaskExecution[];

  readonly results: ReadonlyMap<string, TaskExecution>;

  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;

  readonly completionReason: DagCompletionReason;

  // NOTE (F13): under the DEFAULT (no `completionConfig`) the DAG drains the
  // reachable graph, then reports one of TWO reasons based on outcome:
  //   • all reachable tasks succeeded (or skipped)  => "ALL_COMPLETED"
  //   • one or more tasks FAILED                    => "COMPLETED_WITH_FAILURES"
  // So `completionReason` DOES disambiguate a clean run from a drained-with-
  // failures run — unlike a bare `ALL_COMPLETED` alias. `throwIfError()` still
  // keys off `failureCount` (not the reason), so it throws in the
  // "COMPLETED_WITH_FAILURES" case. The other reasons
  // (`MIN_SUCCESSFUL_REACHED` / `FAILURE_TOLERANCE_EXCEEDED` /
  // `CUSTOM_COMPLETION_*`) appear ONLY when a `completionConfig` is supplied.
  // Note the deliberate divergence from `BatchResult`, whose default is
  // fail-fast (`FAILURE_TOLERANCE_EXCEEDED`); the DAG drains and reports
  // "COMPLETED_WITH_FAILURES" instead. See §5.8.

  /** Throws DagExecutionError if any task FAILED (or a FAILED custom completion). */
  throwIfError(): void;
}

// DAG builds on the SHARED CORE completion vocabulary (src/types/core.ts), NOT on
// the batch/map/parallel type. `CompletionReason` is the neutral base that both
// BatchResult (map/parallel) and DagResult extend; DAG has no dependency on the
// batch type. See §7.2 for the core-type extraction.
import { CompletionReason } from "./core"; // the shared 5-member base

// DAG is a SUPERSET of the core base: it adds ONE DAG-specific member so the
// default-drain-with-failures case is unambiguous (resolves the F13 footgun).
export type DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES";
//   base = "ALL_COMPLETED" | "MIN_SUCCESSFUL_REACHED" | "FAILURE_TOLERANCE_EXCEEDED"
//        | "CUSTOM_COMPLETION_SUCCEEDED" | "CUSTOM_COMPLETION_FAILED"
//   + DAG-only: "COMPLETED_WITH_FAILURES"
```

**`TaskStatus` semantics.** `SUCCEEDED`/`FAILED`/`SKIPPED` are terminal. `STARTED` means a task began executing but the DAG resolved before it finished — this happens **only** under early completion (`completionConfig`) when in-flight tasks are not awaited (§5.7); it mirrors `BatchItemStatus.STARTED` in `src/types/batch.ts`. A task that **never started** (e.g. the scheduler stopped starting new tasks before reaching it) is **not** given a status: it is simply **absent** from `results`, so `getStatus` returns `undefined` (§9.6). This matches `CompletionItemStatus.status?: BatchItemStatus | undefined` (a not-yet-started item is `undefined`, never labeled `STARTED`).

[CODE NOTE — completion reason] `DagCompletionReason` is a **superset of the shared core `CompletionReason`** (extracted to `src/types/core.ts`, §7.2), **not** an alias of the batch type — the DAG has no dependency on the map/parallel `CompletionReason`. It adds exactly one DAG-specific member, `"COMPLETED_WITH_FAILURES"`, and introduces **no `TASK_FAILED` reason** (the earlier draft's `TASK_FAILED` was rejected in review, A.2, because it masqueraded as a batch-union member). When a DAG has no `completionConfig` and drains to completion, `completionReason` is `"ALL_COMPLETED"` if every reachable task succeeded/skipped, or `"COMPLETED_WITH_FAILURES"` if one or more failed; either way individual failures remain observable via `failureCount`/`failed()`/`throwIfError()`. See §5.8 for the full failure model and the deliberate divergence from the batch handler's default fail-fast.

[CODE NOTE — error type] `error` is typed `DurableOperationError` (the SDK base in `src/errors/durable-error/durable-error.ts`), not the doc's `ChildContextError`. A task's error is whatever its underlying handler throws: `StepError`, `InvokeError`, `CallbackError`, `ChildContextError`, `WaitForConditionError`, etc. (Note: tasks routed through a child-context wrapper — `runInChildContext`, `map`, `parallel`, and the submitter-based `callback` per §7.3 — surface a `ChildContextError`, consistent with `BatchItem.error`. **Exception (F4):** a **nested `dag` task** wires the pass-through `errorMapper: (e) => e` on its own container (§7.4), so if the nested DAG fails at _registration/validation_ (a `Dag*Error`) or via a deterministic `register` throw, that error is recorded **unwrapped** as the nested-dag task's `error` — not as a `ChildContextError`. A nested DAG whose _tasks_ fail does not throw at all: it resolves with a `DagResult` whose `failureCount > 0`, per §5.8.)

### 2.9 `DagConfig` / `NestedDagConfig` / DAG completion

```ts
export interface DagConfig {
  maxConcurrency?: number; // default: 40 (DEFAULT_DAG_MAX_CONCURRENCY); must be > 0
  completionConfig?: DagCompletionConfig; // DAG-specific (see below); NOT batch CompletionConfig
  defaultRetryStrategy?: RetryStrategy; // applied to tasks with no own retryStrategy
  defaultTriggerRule?: TriggerRule; // default "ALL_SUCCESS"
  serdes?: Serdes<DagResult>; // for the DagResult container payload
  summaryGenerator?: (result: DagResult) => string; // OBSERVABILITY-ONLY text for the large-payload fallback; stored verbatim under DagSummary.summary and NEVER read on replay (§8.1). Cannot override the SDK-owned count/reason/started fields. Contrast batch, where this string is load-bearing on replay (issue #751).
  nesting?: NestingType; // NestingType.NESTED (default) | FLAT for task child contexts
}

// A nested DAG task's trigger rule is set ONLY via the builder handle
// (`.triggerRule()`, §2.4), uniformly with every other task kind — there is no
// config-level triggerRule (see F10). NestedDagConfig therefore adds nothing
// beyond DagConfig in v1; it is kept as a distinct alias for future divergence.
export type NestedDagConfig = DagConfig;
```

**DAG-specific completion (`DagCompletionConfig`).** The reason the DAG does **not** reuse `CompletionConfig`/`CompletionStatus` from `src/types/batch.ts` verbatim is that those types are result-blind and skip-blind: `CompletionItemStatus` is `{ index, name?, status? }` where `status` is `BatchItemStatus | undefined` (`SUCCEEDED | FAILED | STARTED`) — it carries **no result payload** (so a predicate cannot short-circuit on a task's _value_, e.g. `verdict === "REJECT"`) and has **no `SKIPPED`** member (so a skipped task cannot be represented distinctly from not-yet-started). The DAG needs both. It therefore defines its own completion vocabulary that mirrors the batch shape but adds task results and the `SKIPPED` status:

```ts
// Threshold-based completion is reused from batch UNCHANGED (it is result-blind
// by design and needs no results/skip info): min/tolerated counts over terminal
// task states, where SKIPPED counts toward neither success nor failure.
import { ThresholdCompletionConfig, CompletionDecision } from "./batch";

/** Per-task snapshot passed to a DAG custom completion predicate. */
export interface DagCompletionItemStatus<TResult = unknown> {
  name: string;
  /** Full task status INCLUDING "SKIPPED"; `undefined` if not yet started. */
  status?: TaskStatus; // TaskStatus = SUCCEEDED|FAILED|SKIPPED|STARTED
  /** Present only when status === "SUCCEEDED". Enables result-based short-circuit. */
  result?: TResult;
  skipReason?: SkipReason; // present only when status === "SKIPPED"
}

export interface DagCompletionStatus {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  /** successCount + failureCount + skippedCount (all terminal states). */
  completedCount: number;
  totalCount: number;
  /** Per-task snapshot, ordered by registration order (stable index). */
  items: readonly DagCompletionItemStatus[];
  /** Live view of terminal task results by name — the results map the batch type lacks. */
  results: ReadonlyMap<string, DagCompletionItemStatus>;
}

export interface DagCustomCompletionConfig {
  /** Deterministic predicate over DAG progress + task results. */
  shouldComplete: (status: DagCompletionStatus) => CompletionDecision; // continueBatch()/completeBatch(outcome)
  minSuccessful?: never;
  toleratedFailureCount?: never;
  toleratedFailurePercentage?: never;
}

export type DagCompletionConfig =
  | ThresholdCompletionConfig
  | DagCustomCompletionConfig;
```

`ThresholdCompletionConfig`, `CompletionDecision`, `completeBatch`, `continueBatch`, `CompletionOutcome`, `NestingType`, `Serdes`, `RetryStrategy` are existing types (reused unchanged). Only the **custom-predicate status shape** is DAG-specific — the decision type (`CompletionDecision`) and the threshold config are reused verbatim.

[CODE NOTE — divergence from "verbatim reuse"] An earlier draft claimed the DAG reuses `CompletionConfig`/`CompletionStatus` verbatim. That is infeasible: the batch `CompletionItemStatus` has no result payload and no `SKIPPED` status (verified in `src/types/batch.ts`). The DAG reuses the _threshold_ half and the _decision_ factories unchanged, but defines `DagCompletionStatus`/`DagCompletionItemStatus` for the custom-predicate path so result-based short-circuit (§13.4) and skip accounting (§5.7) are expressible.

`maxConcurrency <= 0` throws (same guard shape as `concurrent-execution-handler.ts`, re-implemented in the DAG handler — §7.4, §9.4). Mutual exclusivity of the completion union is enforced at the type level and by a runtime guard mirroring `validateCompletionConfig` (§7.4, §9.4).

---

## 3. Two ways to declare dependencies

```ts
// Inline deps => typed access in fn body
const c = dagCtx.step("c", [a, b], async (deps) => process(deps.a, deps.b));
// Root task => empty array (no typed access)
const a = dagCtx.step("a", [], async () => fetchA());
// Ordering-only via builder => no result access
const d = dagCtx.step("d", [], async () => notify()).after(a);
// Mixed: typed inline deps + ordering-only builder deps
const e = dagCtx.step("e", [a], async (deps) => process(deps.a)).after(b);
```

Inline `deps` populate `DepsMap` (typed). Builder `.after(...)` add edges for scheduling/trigger-rule evaluation only; they are **not** in `DepsMap`. Concretely, `TaskDef` (§7.5) stores these as two fields: `inlineDeps` (drives `DepsMap`) and `allDeps` = `inlineDeps ∪ builder edges` (drives readiness, trigger-rule status, cycle detection, and missing-dep validation).

---

## 4. Entity ID strategy & replay correctness

### 4.1 IDs are opaque, hashed keys

Entity IDs are **never parsed** by the runtime. `getStepData(stepId)` (`ExecutionContext.getStepData`) and `src/utils/step-id-utils/step-id-utils.ts::hashId()` MD5-hash the string ID to a 16-char key before any checkpoint lookup/store. The **real** `hashId` is a **memoized** function with a bounded (`MAX_HASH_CACHE_SIZE = 10_000`) module-global `hashCache` that clears-and-rebuilds when full; the snippet below is **simplified for illustration** — it is functionally equivalent (identical output for a given input) but omits the cache:

```ts
// SIMPLIFIED — the real step-id-utils.ts memoizes this in a bounded hashCache.
export const hashId = (input: string): string =>
  createHash("md5")
    .update(input)
    .digest("hex")
    .substring(0, HASH_LENGTH /* 16 */);
```

Consequence: **any** deterministic string works as an ID; the structural `-` joins are handled transparently. Name-based IDs like `1-2-DAG_NODE_T_rule_a` are safe.

### 4.2 Name-based task IDs

A task's entity ID is `${parentId}-DAG_NODE_T_${name}` where `parentId` is the DAG child-context's own entity ID (its `_stepPrefix`). If the DAG context has no prefix, the ID is `DAG_NODE_T_${name}`.

```
Parent execution root:            (root)
context.dag(...) child context:   1-2          (one counter slot in the parent)
  task "fetch_data":              1-2-DAG_NODE_T_fetch_data
  task "validate":                1-2-DAG_NODE_T_validate
  nested dag "validation":        1-2-DAG_NODE_T_validation
    sub-task "rule_a":            1-2-DAG_NODE_T_validation-DAG_NODE_T_rule_a
```

**Injectivity of the ID scheme.** For the checkpoint keying to be sound, the map `(parentPrefix, taskName) → entityId` — and its transitive composition across nesting — MUST be **injective**: two structurally distinct (scope, name) positions must never produce the same string. The threat is a task name that _embeds the delimiter_ `-DAG_NODE_T_` and thereby collides with a nested path. Concrete collision **if names could contain `-`** (parent prefix `P`):

- Sibling task named `x-DAG_NODE_T_y` → `P-DAG_NODE_T_x-DAG_NODE_T_y`.
- Nested-dag task `x` (container `P-DAG_NODE_T_x`) with sub-task `y` → `P-DAG_NODE_T_x-DAG_NODE_T_y`.

These would hash to the identical `hashId` key — silent checkpoint aliasing.

**Resolution (two enforced charset rules → injective encoding).** Two registration-time rules on task names (§6.1, `DagInvalidTaskNameError`) make the delimiter unforgeable:

1. **No `-` in names** — the name charset is `^[a-zA-Z0-9_]+$` (dash excluded; §6.1). Since the delimiter `-DAG_NODE_T_` _begins with_ `-`, and `-` appears in an entity ID **only** as a structural join (counter joins like `1-2`, and delimiter prefixes), **a name can never contain the delimiter's leading `-`**. This alone makes `-DAG_NODE_T_` unforgeable and the encoding injective — the collision above cannot even be _expressed_, because `x-DAG_NODE_T_y` is not a legal name.
2. **No `DAG_NODE_T_` substring in names** — kept as defense-in-depth (and to reserve the token cleanly), though rule (1) already suffices. The token is long deliberately: entity IDs are **hashed** before storage (§4.1), so the token never appears in persisted data or the console; its only job is to be an internal marker that an ordinary name is astronomically unlikely to contain.

Injectivity argument, given rule (1):

1. Every `-` in an entity ID is **structural** — it comes from a counter join (`1-2`) or the leading `-` of a `-DAG_NODE_T_` delimiter. No `-` originates inside a name.
2. Therefore every occurrence of the 12-char sequence `-DAG_NODE_T_` in an entity ID is a **real delimiter**: its leading `-` cannot come from a name, and the trailing `DAG_NODE_T_` cannot be forged from the digits-and-`-` counter prefix.
3. Splitting an entity ID on `-DAG_NODE_T_` is thus **unambiguous**: the first segment is the counter prefix and each subsequent segment is exactly one task name (each dash-free). The decomposition into `(prefix, name₁, name₂, …)` is unique, and names are unique within each scope (§10.1) — so the full ID is a bijection with its `(scope-path, name)` position.

This guarantee is **enforced at registration** (not merely asserted), so it cannot be silently violated. Counter-child IDs (`1-2-1`) also remain disjoint from task IDs (`1-2-DAG_NODE_T_…`) — a task ID always contains `DAG_NODE_T_`, a counter ID never does.

> **Why forbid `-` in names (future-proofing).** Reserving `-` as a _structural-only_ character keeps the ID grammar clean (names occupy the leaf segments, `-` only ever joins structure) and future-proof: charset restrictions can be **loosened** in a later version without breaking any in-flight execution, but can never be **tightened**. With zero users today, being strict now preserves the option to allow `-` later if a real need appears. Developers use `_` or camelCase instead (`fetch_data`, `ruleA`).

> **Rejected alternatives.** (a) _Allowing `-` in names_ and relying solely on the long `DAG_NODE_T_` token is injective too (an earlier revision), but leaves `-` doing double duty (structural join _and_ name content), which is harder to reason about and to parse in any future diagnostics. (b) _Escaping_ names before composition complicates the round-trip; (c) _length-prefixed / per-segment-hashed_ encoding is fully general but opaque. The chosen scheme — dash-free names + a long reserved token — is trivial to validate, and because IDs are hashed to a fixed 16-char key before storage (§4.1) the token length has **no** effect on stored size. Chosen for v1.

### 4.3 Why name-based (not counter or index)

- **Counter-based** diverges: DAG task _start_ order follows dep _completion_ order, which varies across replays (the core motivation, §1.1).
- **Index-based** (`T0,T1,…` from declaration order) is fragile to reordering/insertion and hostile to future dynamic tasks.
- **Name-based** is stable across reordering, insertion, and (future) dynamic tasks, and is self-describing in **debug logs** (the SDK logs the raw `entityId`, e.g. `1-2-DAG_NODE_T_fetch`). Note the _persisted_ history identifies a task by its `Name` field (all schemes set `Name` equally); the entity ID itself is hashed before storage (§4.1), so the readability benefit is a debug-log convenience, not a stored-data property.

### 4.4 Replay-correctness argument (grounded)

The scheduler's _traversal order_ may differ run-to-run, but correctness depends only on (a) stable IDs and (b) topological ordering — **not** on traversal order. Concretely:

1. Each task's ID is a pure function of its name and the DAG context prefix (§4.2) — identical every run.
2. When the scheduler runs task `X`, it invokes `X`'s underlying handler with `createStepId: () => idOf(X)`. If `X` already completed in a prior invocation, `step-handler.ts` hits its **fast path**: `stepData?.Status === SUCCEEDED` ⇒ it `safeDeserialize`s and returns the checkpointed result _without re-executing_ (`FAILED` ⇒ rethrows the checkpointed error). Same fast paths exist in every handler (`run-in-child-context-handler.ts::handleCompletedChildContext`, etc.).
3. `validateReplayConsistency(idOf(X), {type, name, subType}, checkpointData, context)` compares `Type`/`Name`/`SubType` against the checkpoint. Because the same task name always maps to the same operation type/subtype, this passes. It does **not** inspect ID format, so `DAG_NODE_T_`-prefixed IDs are transparent to it.
4. The scheduler rebuilds its in-memory `results` map each run by reading each completed task's result via the fast path. `DepsMap` is therefore reconstructed identically, and topological order guarantees a task's deps are already in `results` before it runs.

Thus the only new requirement over `map`/`parallel` is the ID derivation; everything downstream (checkpoint, retry, serdes, replay validation, termination) is the existing machinery.

---

## 5. Scheduler semantics (`dag-executor.ts`)

The executor is a topological scheduler over the registered `TaskDef[]`. It maintains: `results: Map<string, TaskExecution>` (in-memory), `inFlight: Set<string>`, and a ready set.

### 5.1 Readiness

A task is **ready** when every dep (inline + builder) is present in `results` (i.e. reached a terminal state: `SUCCEEDED`/`FAILED`/`SKIPPED`). Root tasks (no deps) are ready immediately. This is `queueDownstream` after each terminal transition.

### 5.2 Concurrency

`tryStartNext()` starts ready tasks while `inFlight.size < (config.maxConcurrency ?? DEFAULT_DAG_MAX_CONCURRENCY)` — **40** when unset (§2.9). Because each operation handler kicks off its work **eagerly** when invoked (e.g. `step-handler.ts` builds `phase1Promise` immediately and attaches `.catch(()=>{})`), the scheduler controls concurrency by _deferring the handler call itself_ until the task is both ready and under the concurrency cap.

### 5.3 Trigger-rule evaluation

When a ready task is dequeued, evaluate its `triggerRule` against the **statuses** of its deps (inline + builder), per this table (from the design doc, matching the runtime semantics):

| Upstream states     | ALL_SUCCESS | ALL_FAILED | ALL_DONE |    ANY_SUCCESS     |   ANY_FAILED    |  NONE_FAILED   |
| ------------------- | :---------: | :--------: | :------: | :----------------: | :-------------: | :------------: |
| **Empty (no deps)** |   **Run**   |  **Skip**  | **Run**  |      **Skip**      |    **Skip**     |    **Run**     |
| All succeeded       |     Run     |    Skip    |   Run    |        Run         |      Skip       |      Run       |
| All failed          |    Skip     |    Run     |   Run    |        Skip        |       Run       |      Skip      |
| Mixed succ/fail     |    Skip     |    Skip    |   Run    |        Run         |       Run       |      Skip      |
| Includes SKIPPED    |    Skip     |    Skip    |   Run    | Run if any success | Run if any fail | Run if no fail |

`SKIPPED` counts as "not success" and "not failure" (i.e. `NONE_FAILED`-satisfying). If the rule is **not** satisfied ⇒ record `{status:"SKIPPED", skipReason:"TRIGGER_RULE"}`, do not run, propagate downstream.

**Empty upstream set (F8).** A task with **no** deps (inline or builder) evaluates its trigger rule against an empty status array. `triggerRuleEvaluators` are defined so the empty case is well-typed and never surprising:

```ts
const triggerRuleEvaluators: Record<TriggerRule, (s: TaskStatus[]) => boolean> =
  {
    ALL_SUCCESS: (s) => s.every((x) => x === "SUCCEEDED"), // [] => true  => Run
    ALL_FAILED: (s) => s.length > 0 && s.every((x) => x === "FAILED"), // [] => false => Skip
    ALL_DONE: () => true, // [] => true  => Run
    ANY_SUCCESS: (s) => s.some((x) => x === "SUCCEEDED"), // [] => false => Skip
    ANY_FAILED: (s) => s.some((x) => x === "FAILED"), // [] => false => Skip
    NONE_FAILED: (s) => s.every((x) => x !== "FAILED"), // [] => true  => Run
  };
```

Note the explicit `s.length > 0` guard on `ALL_FAILED`: without it, vacuous `every` would run a **depless** task on `ALL_FAILED`, which is meaningless (there is no failure upstream). The "failure-family" rules (`ALL_FAILED`, `ANY_FAILED`) therefore require at least one actual upstream failure; the "success/done-family" rules (`ALL_SUCCESS`, `ALL_DONE`, `NONE_FAILED`) are vacuously satisfied so a root task with the default `ALL_SUCCESS` runs. A **non-default** trigger rule on a depless task is **allowed** (not a validation error) and follows this table; the empty-row semantics are the documented contract. Recommendation: depless tasks should keep the default `ALL_SUCCESS` — a non-default rule on a root is legal but usually a modeling mistake.

### 5.4 `runIf` evaluation

If the trigger rule passed, build the `DepsMap` from `results` and evaluate `runIf(deps)` (sync). `false` ⇒ record `{status:"SKIPPED", skipReason:"RUN_IF_PREDICATE"}`, do not run, propagate downstream. `true`/absent ⇒ run.

**A throwing predicate aborts the DAG.** `runIf` is a pure, deterministic predicate, so a throw is a **defect**, not an outcome. The scheduler records **no terminal state** for the offending task, starts no further tasks, and fails the `dag()` operation with a typed `DagPredicateError` naming the task and carrying the original error as its cause; the DAG container checkpoints the failure. It is _not_ recorded as a task `FAILED` and _not_ coerced to `false` ⇒ `SKIPPED`. Recording it as a task failure would silently rewrite the graph's meaning: every downstream `ALL_FAILED` / `ANY_FAILED` / `ALL_DONE` task would fire, so a null-pointer bug in a predicate would issue a refund. Note the contrast with §5.5, where a rejecting task **body** is a normal `FAILED`. Semantically uniform across all four SDKs, though the error's **fidelity** across the container boundary is not — the typed identity and the task-naming message always survive, the structured task-name field and cause chain may not (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3); on the large-payload success-replay path a throw can only mean a non-deterministic predicate, and surfaces as the same typed error rather than being masked.

### 5.5 Running a task

Invoke `taskDef.executor(parentContext, depsMap)` which delegates to the operation's explicit-ID handler variant (§7). On resolve ⇒ `{status:"SUCCEEDED", result}`; on reject ⇒ `{status:"FAILED", error}`. Then `queueDownstream` and `tryStartNext`.

### 5.6 Skip propagation

Skipping a task is a terminal transition, so its downstream becomes eligible and evaluates _its own_ trigger rule against the skip (§5.3). Skips cascade naturally: an `ALL_SUCCESS` chain downstream of a skip will itself skip; an `ALL_DONE` sink still runs.

### 5.7 `completionConfig` interaction

Uses `DagCompletionConfig` (`ThresholdCompletionConfig | DagCustomCompletionConfig`, §2.9) — **not** the batch `CompletionConfig`. The DAG executor evaluates it the same way `ConcurrentExecutionController` does, but maps DAG progress into a **`DagCompletionStatus`** (which, unlike the batch `CompletionStatus`, carries per-task results and a `SKIPPED` status):

- `successCount`/`failureCount`/`skippedCount` = counts over terminal task states. `completedCount` = `successCount + failureCount + skippedCount` (SKIPPED **does** count toward `completedCount`, but toward neither success nor failure).
- `totalCount` = number of registered tasks.
- `items: DagCompletionItemStatus[]` = one entry per task **ordered by registration order** (stable index), `{ name, status, result?, skipReason? }`.
  - **How SKIPPED is represented (F3):** `status` here is the full `TaskStatus` (`SUCCEEDED | FAILED | SKIPPED | STARTED`), so a skipped task appears explicitly as `status: "SKIPPED"` with its `skipReason` — it is **not** conflated with not-yet-started. A task that has not started is `status: undefined` (absent from the `results` map), exactly mirroring how a not-started `map` item is `undefined`.
  - **How results are exposed (F2):** each `SUCCEEDED` item carries its `result`, and `status.results` is a `ReadonlyMap<string, DagCompletionItemStatus>` of terminal tasks by name. This is the results view the batch `CompletionStatus` lacks, and it is what makes result-based short-circuit (§13.4) implementable.
- **Threshold path**: `toleratedFailureCount`/`toleratedFailurePercentage` exceeded ⇒ stop starting new tasks, reason `FAILURE_TOLERANCE_EXCEEDED`; `minSuccessful` reached ⇒ reason `MIN_SUCCESSFUL_REACHED`. (Threshold config is the batch `ThresholdCompletionConfig`, reused unchanged; it ignores results by design.)
- **Custom path**: `shouldComplete(status: DagCompletionStatus)` returning `completeBatch(outcome)` ⇒ stop; reason `CUSTOM_COMPLETION_SUCCEEDED`/`CUSTOM_COMPLETION_FAILED`. The predicate may inspect `status.results`/`items[].result` for value-based completion.
- Mutual exclusivity of threshold-vs-custom is enforced at the type level; a runtime guard mirrors `validateCompletionConfig` (terminate with `TerminationReason.CONFIG_VALIDATION_ERROR`) for plain-JS callers (§7.4, §9.4).

When early completion fires, **in-flight tasks are not cancelled** — they finish, but their checkpoints are dropped via the existing `checkpoint.markAncestorFinished`/`hasFinishedAncestor` mechanism (the DAG child context is marked finished, so descendant checkpoints are ignored). This mirrors `minSuccessful` behavior in `map`/`parallel` (see design "Design Alternatives" §3 Option B). Such tasks appear as `STARTED` in `DagResult`; tasks the scheduler never started are absent (`getStatus` ⇒ `undefined`, §9.6).

### 5.8 Failure semantics of the DAG promise

A **failed task is a normal terminal state**, not an abort signal. This is the pivot that makes trigger rules work: compensation/fallback tasks (`ALL_FAILED`, `ALL_DONE`, `ANY_FAILED`, `NONE_FAILED`) downstream of a failure must still be scheduled and evaluated.

- **No `completionConfig` (default)**: the scheduler **drains the reachable graph** — it keeps starting ready tasks until no task is startable, letting downstream trigger rules react to each failure. When the graph drains, `completionReason` is `"ALL_COMPLETED"` if every reachable task succeeded or skipped, or `"COMPLETED_WITH_FAILURES"` (the DAG-specific superset member, §2.8) if one or more tasks failed — so the reason itself distinguishes a clean run from a drained-with-failures run. **The `dag()` promise itself does NOT reject** — it resolves with a `DagResult`; callers opt into throwing via `result.throwIfError()`, which throws `DagExecutionError` when `failureCount > 0`. This mirrors `BatchResult` (a failed batch still resolves; `throwIfError()` throws).

  [CODE NOTE — DELIBERATE DIVERGENCE from `ConcurrentExecutionController`] The batch handler's default (no `completionConfig`) is **fail-fast**: `executeItemsConcurrently.shouldContinue()` returns `failureCount === 0`, so it stops starting new items after the first failure and `getCompletionReason` returns `"FAILURE_TOLERANCE_EXCEEDED"` (`concurrent-execution-handler.ts`). The DAG **intentionally does not adopt this default**: fail-fast would prevent compensation tasks (the whole point of `ALL_FAILED`/`ALL_DONE` trigger rules, §13.2) from ever running. Instead, the DAG's own scheduler (`dag-executor.ts`) treats a failure as a terminal task state and continues scheduling; a customer who _wants_ batch-style fail-fast opts in explicitly with `completionConfig` (below). Because the DAG scheduler is a **separate** component from `ConcurrencyController`, this divergence is a local design choice, not a change to any shared code.

- **With `completionConfig`**: the batch thresholds/predicate apply and can stop the graph early (§5.7). The scheduler stops starting new tasks the moment `shouldContinue()` (threshold) or `shouldComplete()` (custom) says so, exactly as `ConcurrencyController` does; `completionReason` is one of `FAILURE_TOLERANCE_EXCEEDED` / `MIN_SUCCESSFUL_REACHED` / `CUSTOM_COMPLETION_SUCCEEDED` / `CUSTOM_COMPLETION_FAILED`. In-flight tasks are not cancelled (§5.7); not-yet-started tasks are left absent from `results` (§9.6).

- **`DagResult.throwIfError()`** throws `DagExecutionError` (wrapping the first failed task's `error` as `cause`) when `failureCount > 0` **or** `completionReason === "CUSTOM_COMPLETION_FAILED"`. Note that with the default (no `completionConfig`) a graph that has failures reports `completionReason === "COMPLETED_WITH_FAILURES"` — but `throwIfError` keys off `failureCount`, not the completion reason, so its behavior is unchanged either way.

### 5.9 Empty DAG

Zero registered tasks ⇒ resolve immediately with an empty `DagResult` (`totalCount: 0`, `completionReason: "ALL_COMPLETED"`).

### 5.10 Error types

- `DagCyclicDependencyError` — cycle detected at registration.
- `DagInvalidTaskNameError` — bad name at registration.
- `DagPredicateError` — a `runIf` predicate threw at scheduling time (§5.4). Carries the offending task name and the original error as its cause. Unlike the registration errors above this is raised **during** execution, and it aborts the DAG.
- `DagDuplicateTaskError` — duplicate name at registration.
- `DagInvalidDependencyError` — dep handle not registered in this DAG.
- `DagExecutionError extends DurableOperationError` (`errorType = "DagExecutionError"`) — thrown by `throwIfError()`; carries the first failed task's error as `cause`.

Validation errors (§6) are **registration-time** and deterministic (the same graph is registered every replay, per §10.2), so they reproduce identically on replay. They are surfaced by **throwing** the corresponding `Dag*Error` from within the DAG child-context body, and the `dag()` promise **rejects with the raw `Dag*Error` unwrapped**. This unwrapping is **not automatic**: `executeChildContext`/`handleCompletedChildContext` (verified in `run-in-child-context-handler.ts`) always rewrap a thrown error as `new ChildContextError(msg, cause)` _unless an `errorMapper` is supplied_. §7.4 therefore wires `errorMapper: (e) => e` (pass-through) into the container's `runInChildContext` options, which is what makes the raw `Dag*Error` reach the caller. This is deliberate: unlike the mutually-exclusive-`completionConfig` case (which follows the `terminationManager.terminate` path, matching `validateCompletionConfig`), graph-shape errors are customer programming errors raised from customer-visible registration calls, so a catchable throw is the right ergonomics — analogous to the plain-`Error` throws the batch handler uses for "requires an array of items" / invalid `maxConcurrency`. See §7.4 (errorMapper) and §9.4 for the full throw-vs-terminate breakdown.

**Register-callback throws (arbitrary customer errors).** The `register` callback runs first inside the DAG child-context body (`createDagHandler`, §7.4), _before_ validation and _before_ any task executes. If `register` throws a **non-`Dag*Error`** (any arbitrary customer `Error` — e.g. a bug in the registration logic, or a thrown value from an `await`ed expression in an async `register`), that error is **not caught** by the DAG machinery: it propagates out of the `runInChildContext` body and **rejects the `dag()` promise before any task runs**. No tasks are scheduled, no task IDs are minted, and the container node fails as a whole. Because §7.4 supplies the pass-through `errorMapper: (e) => e`, the thrown error surfaces **unwrapped** (as the raw customer `Error`), not re-wrapped in `ChildContextError` — consistent with how the `Dag*Error`s surface. Replay behavior follows determinism (§10.2): a **deterministic** throw (e.g. `if (rules.length === 0) throw new Error(...)`) reproduces identically on every replay, so the DAG deterministically fails the same way; a **non-deterministic** throw (e.g. throwing based on `Date.now()` or a network read done directly in `register`) is a §10.2 determinism violation and will surface as a `NonDeterministicExecutionError` on the first task whose replayed operation shape diverges, or as an inconsistent container outcome across invocations. Customers MUST keep `register` deterministic (§10.2); any non-deterministic work belongs inside a task, not in `register`.

---

## 6. Validation (`dag-validator.ts`)

Runs once, **after** `register` returns, **before** the executor starts.

### 6.1 Task name rules (`DagInvalidTaskNameError`)

- Non-empty, ≤ 100 chars, pattern `^[a-zA-Z0-9_]+$` — alphanumerics and underscore only. **`-` (dash) is NOT allowed** in task names: it is reserved as a structural-only character in entity IDs (counter joins and the `-DAG_NODE_T_` delimiter). Use `_` or camelCase instead (`fetch_data`, `ruleA`). Rationale and future-proofing in §4.2.
- **MUST NOT contain the reserved 11-character sequence `DAG_NODE_T_`** (case-sensitive) — defense-in-depth for delimiter injectivity (§4.2; the no-dash rule already suffices, but the token is reserved cleanly). The token is deliberately long so it (almost) never collides with a real name: `myTask`, `a_b`, `T_shirt`, `GET_T_oken`, `count_T` are all **accepted**. Rejected examples: any name containing a dash (`fetch-data`, `rule-a`, `step-1`, `T-1`) → dash rule; or embedding the token (`DAG_NODE_T_root`, `myDAG_NODE_T_x`) → token rule.
- Validated eagerly in each `DagContext` method as the task is registered (fail fast, before graph assembly).

### 6.2 Duplicates (`DagDuplicateTaskError`)

Each `DagContext` method inserts into a `Map<string, TaskDef>` keyed by name; a second registration under the same name (regardless of operation kind) throws immediately.

### 6.3 Missing dependencies (`DagInvalidDependencyError`)

Every dep `TaskHandle` (inline or builder) must have its `_id` present in the registry. A handle from a different (e.g. parent) DAG scope fails this check — enforcing scope isolation (§10.1).

### 6.4 Cycle detection (`DagCyclicDependencyError`)

Kahn's algorithm over inline+builder edges, `O(V+E)`, once:

```ts
// Edges = allDeps (inlineDeps ∪ builder .after), NOT inlineDeps alone (F7).
function detectCycle(tasks: TaskDef[]): string[] | null {
  const inDegree = new Map(tasks.map((t) => [t.name, t.allDeps.length]));
  const queue = tasks
    .filter((t) => inDegree.get(t.name) === 0)
    .map((t) => t.name);
  const visited: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    visited.push(n);
    for (const t of tasks)
      if (t.allDeps.some((d) => d.name === n)) {
        const d = inDegree.get(t.name)! - 1;
        inDegree.set(t.name, d);
        if (d === 0) queue.push(t.name);
      }
  }
  return visited.length === tasks.length
    ? null
    : tasks.filter((t) => !visited.includes(t.name)).map((t) => t.name);
}
```

Non-null ⇒ throw `DagCyclicDependencyError` listing the cyclic task names.

---

## 7. Implementation plan

### 7.1 File structure

```
src/handlers/dag-handler/
  dag-handler.ts        # createDagHandler: wraps registration+execution in a child context; replay-mode branch (design B)
  dag-context.ts        # DagContextImpl: registers TaskDefs, returns TaskHandles
  task-handle.ts        # TaskHandleImpl (reference + builder)
  dag-executor.ts       # topological scheduler (DagExecutor); reconstructDagResult (ReplaySucceededContext, design B — no re-scheduling)
  dag-validator.ts      # name/duplicate/missing-dep/cycle validation
  dag-result.ts         # DagResultImpl, createDagResultSerdes, restoreDagResult; DagSummary envelope: buildDagSummaryEnvelope / readDagSummaryEnvelope (parse+validate) / defaultDagSummaryGenerator
  trigger-rules.ts      # triggerRuleEvaluators: Record<TriggerRule, (statuses)=>boolean>
src/types/dag.ts        # public types (§2)
src/errors/dag-errors/dag-errors.ts   # Dag*Error classes
```

### 7.2 Changes to existing files

- `src/types/durable-context.ts` — add the `dag(...)` method to `DurableContext<TLogger>` (§2.1).
- `src/context/durable-context/durable-context.ts` — implement `dag()` and add the internal explicit-ID variants + `createTaskId` (§7.3).
- `src/types/index.ts`, `src/index.ts` — re-export new public types/errors.
- `src/types/durable-execution.ts` (`OperationSubType`) — add `DAG = "Dag"` for the DAG container subtype. Task subtypes stay native (`STEP`, `CHAINED_INVOKE`, `RUN_IN_CHILD_CONTEXT`, `MAP`, `PARALLEL`, …).
- `src/errors/durable-error/durable-error.ts` — register `"DagExecutionError"` in `DurableOperationError.fromErrorObject` so a nested-DAG failure reconstructs correctly across `runInChildContext` boundaries. Also update its existing `import type { CompletionReason } from "../../types/batch"` to `from "../../types/core"` (the only direct-from-`batch` importer of that type; see the core-extraction below).
- **`src/types/core.ts` — extract the shared base `CompletionReason`** (the 5 members) here, as the neutral vocabulary that BOTH map/parallel and DAG build on. This is the dependency-direction fix requested for the DAG superset: DAG must not depend on the batch type.
- `src/types/batch.ts` — **remove** its local `CompletionReason` declaration and instead `import { CompletionReason } from "./core"` for internal use (e.g. `BatchResult.completionReason`, `BatchResultImpl`). It must **not** re-export it (the `src/types/index.ts` barrel already surfaces it via `export * from "./core"`, which precedes `export * from "./batch"`; re-exporting from both would be a duplicate-export error). Map/parallel semantics are unchanged — `BatchResult.completionReason` stays exactly the 5-member core type.

**No changes** to `step-handler.ts`, `invoke-handler.ts`, `callback.ts`, `wait-handler.ts`, `wait-for-condition-handler.ts`, `run-in-child-context-handler.ts`, or `concurrent-execution-handler.ts`.

> **Base-type layering (requested design).** The completion-reason vocabulary is layered so there is **no DAG → batch dependency**:
>
> ```
> core.ts:   CompletionReason          = "ALL_COMPLETED" | "MIN_SUCCESSFUL_REACHED"
>                                        | "FAILURE_TOLERANCE_EXCEEDED"
>                                        | "CUSTOM_COMPLETION_SUCCEEDED" | "CUSTOM_COMPLETION_FAILED"
> batch.ts:  BatchResult.completionReason: CompletionReason           // map/parallel — base as-is
> dag.ts:    DagCompletionReason        = CompletionReason | "COMPLETED_WITH_FAILURES"   // DAG — superset of base
> ```
>
> Both features import the base from `core`; neither imports the other's completion type. Adding future core members benefits both; adding `COMPLETED_WITH_FAILURES` affects only the DAG surface.

### 7.3 Explicit-ID variants — grounded design

The DAG needs to run each task under a **name-based** entity ID (`DAG_NODE_T_{name}`, §4.2) instead of the per-context monotonic counter. Two facts from the code govern how this is done, and they split the handlers into **two families**:

**Family A — handlers that take `createStepId: () => string` directly.** Verified: `createStepHandler` (param at `step-handler.ts:44`, `const stepId = createStepId()` at `:55`), `createInvokeHandler` (`invoke-handler.ts:32` / `:78`), `createWaitHandler`, `createWaitForConditionHandler`, `createRunInChildContextHandler` (`run-in-child-context-handler.ts:75` / `const entityId = createStepId()` at `:103`), and the low-level `createCallback` factory (`callback.ts` — `createStepId` is the **3rd** positional param, `const stepId = createStepId()` mid-body; note it also takes `checkAndUpdateReplayMode` as its 4th param and `getDefaultCallbackDeserializer` as its 6th — its signature is **not** identical to the step handler's). For these, the explicit-ID variant is the existing public-method body with `this.createStepId.bind(this)` replaced by `() => this.createTaskId(name)`.

**Sub-split of Family A by `checkAndUpdateReplayMode`.** Taking `createStepId` is _not_ the same as taking `checkAndUpdateReplayMode`. Of the Family A handlers, **only three** additionally accept a `checkAndUpdateReplayMode?: () => void` callback:

- `createInvokeHandler(context, checkpoint, createStepId, parentId?, checkAndUpdateReplayMode?, getDefaultSerdes?, plugin?)` — **5th** positional (verified `invoke-handler.ts:29-36`).
- `createWaitHandler(context, checkpoint, createStepId, parentId?, checkAndUpdateReplayMode?, plugin?)` — **5th** positional (verified `wait-handler.ts:24-29`).
- the low-level `createCallback` factory — **4th** positional (verified `callback.ts`).

The remaining Family A handlers take **no** `checkAndUpdateReplayMode` parameter and MUST NOT be passed one:

- `createStepHandler(context, checkpoint, parentContext, createStepId, logger, parentId?, getDefaultSerdes?, plugin?)` — 4th positional is `createStepId`, **5th is `logger`** (verified `step-handler.ts:52-60`).
- `createWaitForConditionHandler(context, checkpoint, createStepId, logger, parentId?, getDefaultSerdes?, plugin?)` — **4th positional is `logger`** (verified `wait-for-condition-handler.ts:45-52`).
- `createRunInChildContextHandler(context, checkpoint, parentContext, createStepId, getParentLogger, createChildContext, parentId?, …)` — takes `getParentLogger`/`createChildContext`, no mode callback (verified `run-in-child-context-handler.ts:71-87`).

This sub-split is the authoritative list consumed by §7.3.1 and §7.3.2.

**Family B — `waitForCallback`, which does NOT take `createStepId`.** Verified: `createWaitForCallbackHandler(context, peekStepId, runInChildContext, getDefaultCallbackDeserializer?)` (`wait-for-callback-handler.ts:20-24`). It is built **on top of** `runInChildContext` (it wraps the submitter in a child context) and consults `peekStepId` for mode decisions — it never mints an ID via `createStepId`. Therefore the DAG `callback` task (which is submitter-based, matching AGENTS.md `waitForCallback`) **cannot** be handled by swapping `createStepId`. It is instead run **inside** `runInChildContextWithExplicitId(name, …)`: the `DAG_NODE_T_{name}` ID is the wrapping child context, and `waitForCallback`'s own internal child uses a counter ID _within that container's context_ (`DAG_NODE_T_{name}-1`) in deterministic order — replay-safe exactly like `map`/`parallel`/nested `dag` (§7.3.2).

> [CORRECTION vs. the previous draft] The earlier draft cited `callback.ts:37/58` and claimed _every_ handler exposes an identical `createStepId: () => string` injection point. That is false: (a) `callback.ts`'s factory signature differs (extra `checkAndUpdateReplayMode` and `getDefaultCallbackDeserializer` params), and (b) the DAG's `callback` task uses `waitForCallback`, whose handler takes `peekStepId` + `runInChildContext` and no `createStepId` at all. Both are corrected above.

#### 7.3.1 The mode-management coupling problem (why explicit-ID variants bypass `withDurableModeManagement`)

Every public `DurableContext` method wraps its body in `this.withDurableModeManagement(() => …)` (verified for `step`, `invoke`, `runInChildContext`, `wait`, `createCallback`, `waitForCallback`, `waitForCondition`, `map`, `parallel`, `_executeConcurrently` in `durable-context.ts`). **But `withDurableModeManagement` is coupled to the monotonic counter**: it calls `captureExecutionState()`, `checkAndUpdateReplayMode()`, and `checkForNonResolvingPromise()`, and **all three consult `peekStepId()`**, which is defined as:

```ts
private peekStepId(): string {
  const nextCounter = this._stepCounter + 1;       // COUNTER-based
  return this._stepPrefix ? `${this._stepPrefix}-${nextCounter}` : `${nextCounter}`;
}
```

A DAG task checkpoints under `…-DAG_NODE_T_{name}`, **never** under `…-{counter}`. If an explicit-ID variant were wrapped in `withDurableModeManagement`, the mode machinery would `peekStepId()` → a counter ID like `1-2-1` that has **no** checkpoint data (tasks live at `1-2-DAG_NODE_T_name`), and would then (in `checkAndUpdateReplayMode`) wrongly flip the context mode to `ExecutionMode`, or (in `checkForNonResolvingPromise`) mis-handle `ReplaySucceededContext`. This is the concrete "unproven mode-management reuse" defect: **reusing `withDurableModeManagement` for name-keyed tasks is incorrect.**

**Resolution (grounded):** the explicit-ID variants **do not** call `withDurableModeManagement`, and pass a **no-op `checkAndUpdateReplayMode` (`() => {}`)** to the handlers that accept such a parameter (per the §7.3 sub-split): `createInvokeHandler` (5th positional) and `createWaitHandler` (5th positional). The low-level `createCallback` factory also accepts it (4th positional), **but is not consumed by any DAG task in v1** (the `callback` task is submitter-based → Family B, §7.3.2 `runCallbackTaskWithExplicitId`; F11), so no `createCallback` explicit-ID variant is built. **`createStepHandler`, `createWaitForConditionHandler`, and `createRunInChildContextHandler` take no `checkAndUpdateReplayMode` parameter at all** — their explicit-ID variants simply omit it and only swap `createStepId`. This is not optional: `createStepHandler`'s 5th positional is `logger`, `createWaitForConditionHandler`'s 4th positional is `logger`, and `createRunInChildContextHandler` takes `getParentLogger`/`createChildContext` — so injecting a `() => {}` into any of those slots would corrupt the `logger`/factory argument (a positional-argument bug), not disable mode management. Task-level replay correctness is provided **entirely by machinery that is counter-independent**:

1. **Handler fast paths keyed on the explicit ID.** e.g. `step-handler.ts` checks `context.getStepData(stepId)` and returns/rethrows when `stepData?.Status === SUCCEEDED`/`FAILED` — keyed on `stepId = createStepId()` (the `DAG_NODE_T_{name}` string), not on the counter. Every handler has the equivalent fast path (`invoke-handler.ts:109/238/274`, `callback.ts` SUCCEEDED/FAILED branches, `run-in-child-context-handler.ts:55/62/136`).
2. **`validateReplayConsistency(stepId, …)`** is keyed on the explicit `stepId` and inspects only `Type`/`Name`/`SubType` — it never reads the counter or `peekStepId`.

Neither of these touches `_stepCounter` or `peekStepId`, so name-based IDs are fully transparent to them. The **context-level** replay decision (run the executor vs. return the checkpointed `DagResult`) is made **once, at the DAG container boundary** by the parent's `runInChildContext` wrapper (which _does_ use counter-based mode management correctly, because the container node _is_ a counter slot in the parent) — see §7.7. Within the DAG body the counter is never advanced (the body contains only `register()` and explicit-ID task calls), so leaving it untouched cannot desynchronize anything.

> Effect of the no-op: `checkAndUpdateReplayMode` only exists to transition the _context_ mode based on the counter's pending slot (primarily for mode-aware log dedup). DAG tasks are name-keyed, so the correct behavior is to leave the context mode untouched at the task level. The worst-case effect of the no-op is cosmetic (a task's first-run logs may be treated as replay logs); it cannot affect checkpoint reads/writes, which are driven solely by explicit-ID `getStepData`. Nested `map`/`parallel`/`dag`/`callback` tasks are unaffected because they run through `runInChildContextWithExplicitId`, and each such child context computes its **own** mode via `determineChildReplayMode` in `run-in-child-context-handler.ts` (independent of the parent DAG context's mode).

#### 7.3.2 Variant implementations

```ts
// DurableContextImpl additions (all @internal — NOT on the public DurableContext interface)
private createTaskId(name: string): string {
  return this._stepPrefix ? `${this._stepPrefix}-DAG_NODE_T_${name}` : `DAG_NODE_T_${name}`;
}
private static readonly NOOP_REPLAY_MODE = (): void => {};

/** Family A example. NOTE: no withDurableModeManagement wrapper (§7.3.1). */
runStepWithExplicitId<T>(name: string, fn: StepFunc<T, Logger>, options?: StepConfig<T>): DurablePromise<T> {
  const handler = createStepHandler(
    this._executionContext, this.checkpoint, this.lambdaContext,
    () => this.createTaskId(name),          // <-- name-based ID, no counter advance
    this.durableLogger, this._parentId,
    () => this._defaultSerdes, this.durableExecution.plugin,
  );
  return handler(name, fn, options);        // name passed => Operation.Name = task name
}

/** Family A with checkAndUpdateReplayMode param => pass the no-op (§7.3.1). */
runInvokeWithExplicitId<I, O>(name: string, funcId: string, payload: I, options?: InvokeConfig<I, O>): DurablePromise<O> {
  const handler = createInvokeHandler(
    this._executionContext, this.checkpoint,
    () => this.createTaskId(name),
    this._parentId,
    DurableContextImpl.NOOP_REPLAY_MODE,    // <-- no-op, NOT this.checkAndUpdateReplayMode
    () => this._defaultSerdes, this.durableExecution.plugin,
  );
  return handler(name, funcId, payload, options);
}
// runWaitWithExplicitId          — Family A + mode param: pass NOOP_REPLAY_MODE (createWaitHandler 5th positional).
// runWaitForConditionWithExplicitId — Family A, NO mode param: createWaitForConditionHandler's 4th positional is
//   `logger`, so the variant ONLY swaps createStepId (identical shape to runStepWithExplicitId above); do NOT pass a no-op.
// NOTE (F11): there is NO runCreateCallbackWithExplicitId in v1. The DAG `callback` task is submitter-based and runs
//   through Family B (`runCallbackTaskWithExplicitId` below → waitForCallback). The low-level `createCallback` factory
//   (which takes checkAndUpdateReplayMode as its 4th positional) has no corresponding DagContext method, so no
//   explicit-ID variant is built for it. It is listed in §7.3 only to document why callback is NOT a plain Family-A swap.

/** Family A: child context. Basis for map/parallel/nested-dag/submitter-callback. */
runInChildContextWithExplicitId<T>(name: string, fn: ChildFunc<T, Logger>, options?: ChildConfig<T>): DurablePromise<T> {
  const handler = createRunInChildContextHandler(
    this._executionContext, this.checkpoint, this.lambdaContext,
    () => this.createTaskId(name),          // <-- container gets DAG_NODE_T_{name}
    () => this.durableLogger,
    /* child-context factory adapter, identical to runInChildContext */ …,
    this._parentId, () => this._defaultSerdes, this.durableExecution.plugin,
    this._preserveChildDepth === Infinity ? Infinity : Math.max(0, this._preserveChildDepth - 1),
  );
  return handler(name, fn, options);
}

/** Family B: submitter-based callback — wrapped in an explicit-ID child context. */
runCallbackTaskWithExplicitId<T>(name, submitter, options): DurablePromise<T> {
  return this.runInChildContextWithExplicitId(name, async (childCtx) =>
    childCtx.waitForCallback(name, submitter, options),   // internal child => DAG_NODE_T_{name}-1
    { subType: OperationSubType.CALLBACK },
  );
}

/**
 * Batch variant (F6). NOTE: this does NOT reuse `_executeConcurrently`. Two concrete
 * changes from the standalone path:
 *   1. NO `withDurableModeManagement` wrapper (§7.3.1 — mode mgmt is counter-coupled).
 *   2. The CONTAINER's `runInChildContext` binding injected into
 *      `createConcurrentExecutionHandler` is the EXPLICIT-ID variant, so the batch
 *      container node gets `DAG_NODE_T_{name}` instead of a counter ID `P-{n}`.
 * The per-item children are created INTERNALLY by the handler via
 * `parentContext.runInChildContext(...)` (the container child context's OWN
 * counter-based binding) → `DAG_NODE_T_{name}-1`, `DAG_NODE_T_{name}-2`, … in deterministic array
 * order — identical to standalone map/parallel, no change needed there.
 */
private _executeConcurrentlyWithExplicitId<TItem, TResult>(...args): DurablePromise<BatchResult<TResult>> {
  const handler = createConcurrentExecutionHandler(
    this._executionContext,
    this.runInChildContextWithExplicitId.bind(this),  // <-- CONTAINER binding = explicit-ID (was this.runInChildContext)
    this.skipNextOperation.bind(this),                 // per-item replay skip: same as standalone
    () => this._defaultSerdes,
  );
  const promise = handler(...args);                    // first arg is the task name => container ID = DAG_NODE_T_{name}
  promise?.catch(() => {});
  return promise;                                       // deliberately NOT wrapped in withDurableModeManagement
}

runMapWithExplicitId<TIn, TOut>(name, items, mapFunc, options?): DurablePromise<BatchResult<TOut>> {
  return createMapHandler(this._executionContext, this._executeConcurrentlyWithExplicitId.bind(this))(
    name, items, mapFunc, options);
}
runParallelWithExplicitId<TOut>(name, branches, options?): DurablePromise<BatchResult<TOut>> {
  return createParallelHandler(this._executionContext, this._executeConcurrentlyWithExplicitId.bind(this))(
    name, branches, options);
}
runDagWithExplicitId(name, register, config?): DurablePromise<DagResult> {
  // Nested DAG: same principle — the nested container must get DAG_NODE_T_{name}, so createDagHandler
  // is wired with the EXPLICIT-ID child-context binding for ITS container (not this.runInChildContext).
  return createDagHandler(
    this.runInChildContextWithExplicitId.bind(this),   // <-- nested container gets DAG_NODE_T_{name}
    () => this /* explicit-ID accessor host */,
    this._executionContext,                            // for the pre-body config guards (§7.4, F12)
  )(name, register, config);
}
```

**F6 — how the batch/nested-dag container IDs are wired (concrete).** The standalone `_executeConcurrently` (verified `durable-context.ts`) does two things that make it **unusable as-is** for a DAG task: (a) it wraps in `this.withDurableModeManagement(...)` (counter-coupled, wrong for name-keyed tasks — §7.3.1); and (b) it injects `this.runInChildContext.bind(this)` (counter-based) as the **container's** `runInChildContext`, so the batch container node would get a _counter_ ID `P-{n}` — precisely the non-determinism DAG exists to prevent. The fix is a **two-level binding**, shown above:

- **Container level** — the `runInChildContext` argument passed into `createConcurrentExecutionHandler`/`createDagHandler` is the **explicit-ID** variant (`runInChildContextWithExplicitId`), so the container gets `DAG_NODE_T_{name}`.
- **Per-item level** — _unchanged_. `createConcurrentExecutionHandler` internally calls `parentContext.runInChildContext(item.name || item.id, …)` where `parentContext` is the container's own child context (verified in `concurrent-execution-handler.ts::executeItemsConcurrently`/`replayItems`). That is the container context's counter-based binding, yielding `DAG_NODE_T_{name}-1`, `DAG_NODE_T_{name}-2`, … in deterministic array order — replay-safe exactly as `map`/`parallel` are today.

So `concurrent-execution-handler.ts` itself needs **no change** (§7.2 is still accurate: we call the existing factory unchanged); the only new code is the thin `_executeConcurrentlyWithExplicitId`/`runMapWithExplicitId`/`runParallelWithExplicitId`/`runDagWithExplicitId` wrappers that (1) skip `withDurableModeManagement` and (2) supply the explicit-ID container binding. The earlier phrase "build on the existing `_executeConcurrently`" was misleading and is retracted.

These variants are `@internal` (JSDoc), not on the public `DurableContext` interface — the public surface gains only `dag()` (§2.1).

### 7.4 `createDagHandler` (high-level flow)

```ts
export const createDagHandler =
  (
    runInChildContext: DurableContext["runInChildContext"], // the EXPLICIT-ID binding for nested dags (§7.3.2); else this.runInChildContext for the top-level dag()
    makeExecutorContext: () => DurableContextImpl<Logger>, // the child ctx cast for explicit-ID calls
    executionContext: ExecutionContext, // for the pre-body config guards (terminationManager)
  ) =>
  (name, register, config?): DurablePromise<DagResult> =>
    new DurablePromise(async () => {
      // ── Config guards (F12): evaluated BEFORE the child context is entered.
      //    They depend only on `config`, not on registered tasks, so they fire
      //    before register()/validation. Both mirror concurrent-execution-handler.ts.
      // 1. maxConcurrency <= 0 => THROW a plain Error (async; surfaced when awaited). §9.4
      if (
        config?.maxConcurrency !== undefined &&
        config.maxConcurrency !== null &&
        config.maxConcurrency <= 0
      ) {
        throw new Error(
          `Invalid maxConcurrency: ${config.maxConcurrency}. Must be a positive number or undefined to use the default (${DEFAULT_DAG_MAX_CONCURRENCY}).`,
        );
      }
      // 2. Mutually-exclusive completionConfig => TERMINATE (non-retryable), return a
      //    never-resolving promise — re-implemented here (the DAG does NOT go through
      //    concurrent-execution-handler.ts), mirroring validateCompletionConfig. §9.4
      if (
        !validateDagCompletionConfig(
          config?.completionConfig,
          executionContext.terminationManager,
        )
      ) {
        return new Promise<DagResult>(() => {});
      }

      return runInChildContext(
        name,
        async (parentCtx) => {
          const dagCtx = new DagContextImpl(config);
          await register(dagCtx); // registration phase (may be async; see §11)
          const tasks = dagCtx.getTasks();
          validateDag(tasks); // §6 — throws Dag*Error inside this body

          // ── Replay-mode branch (design B, §8.1/§7.7). The child context carries the
          //    mode set by determineChildReplayMode; read it exactly as the batch body
          //    reads `durableExecutionMode` (concurrent-execution-handler.ts). In the
          //    large-payload completed-replay mode we RECONSTRUCT from the checkpointed
          //    DagSummary envelope + per-task checkpoints — we do NOT re-schedule.
          const mode = (
            parentCtx as unknown as {
              durableExecutionMode: DurableExecutionMode;
            }
          ).durableExecutionMode;
          const entityId = (parentCtx as unknown as { _stepPrefix?: string })
            ._stepPrefix;
          if (mode === DurableExecutionMode.ReplaySucceededContext) {
            // envelope = parsed DagSummary from this container's own checkpoint payload.
            const envelope = readDagSummaryEnvelope(executionContext, entityId); // validates; null if missing/malformed
            return reconstructDagResult(
              parentCtx as DurableContextImpl<Logger>,
              tasks,
              envelope,
            );
          }

          // Normal execution / ordinary replay: run the scheduler. Completed tasks hit
          // their name-based checkpoint fast paths; skips are recomputed deterministically.
          const executor = new DagExecutor(
            parentCtx as DurableContextImpl<Logger>,
            tasks,
            config,
          );
          return executor.run(); // resolves DagResult
        },
        {
          subType: OperationSubType.DAG,
          serdes: config?.serdes ?? createDagResultSerdes(),
          // ── SDK ENVELOPE builder (#751, §8.1). NOTE: we do NOT pass the customer
          //    generator directly. executeChildContext checkpoints EXACTLY the string
          //    this returns on the large-payload path, so it must be the FULL DagSummary
          //    envelope (SDK-owned counts/reason/startedTaskNames + the customer text
          //    quarantined under `summary`). Passing config.summaryGenerator raw would
          //    checkpoint only the observability string and lose the load-bearing fields.
          summaryGenerator: (result: DagResult) =>
            JSON.stringify(
              buildDagSummaryEnvelope(
                result,
                config?.summaryGenerator ?? defaultDagSummaryGenerator,
              ),
            ),
          // ── errorMapper PASS-THROUGH (F4). Without this, executeChildContext /
          //    handleCompletedChildContext (run-in-child-context-handler.ts) ALWAYS
          //    rewrap a thrown error as `new ChildContextError(msg, cause)`. The
          //    pass-through makes graph-shape Dag*Error's (and deterministic register
          //    throws) surface UNWRAPPED, so the dag() promise rejects with the raw
          //    DagCyclicDependencyError / DagDuplicateTaskError / etc. — the catchable
          //    throw ergonomics §5.10 relies on.
          errorMapper: (e) => e,
        },
      );
    });
```

**Guard ordering (F12).** The two config guards run **first**, before the child context is entered and before `register`, because they are pure functions of `config`. `validateDagCompletionConfig` is the DAG's own copy of `validateCompletionConfig` (the DAG does not route through `concurrent-execution-handler.ts`, so the guard must be re-implemented in the DAG handler); it terminates with `TerminationReason.CONFIG_VALIDATION_ERROR` and the handler returns a never-resolving promise so nothing else runs. Graph-shape validation (`validateDag`, §6) runs **after** `register` (it needs the assembled task set) and **inside** the child-context body.

**Replay-mode branch (design B — reconstruct, don't re-schedule).** The DAG body is replay-mode-aware, mirroring the batch handler's `executeOperation`→`ConcurrencyController.executeItems`→`replayItems` split (`concurrent-execution-handler.ts`): it reads `parentCtx.durableExecutionMode` (set by `determineChildReplayMode` in `runInChildContext`). In `ReplaySucceededContext` — the large-payload completed-replay mode — it calls `reconstructDagResult` (which re-runs only the deterministic `register` graph + skip/trigger recomputation, reads per-task results from checkpoints, and takes `totalCount`/counts/`completionReason`/`startedTaskNames` from the parsed `DagSummary` envelope) instead of running `DagExecutor`. This is what keeps the STARTED set and completion reason faithful and makes the customer `summary` string non-load-bearing (§8.1). In every other mode the scheduler runs normally (completed tasks hit their name-based fast paths). A `null`/malformed envelope ⇒ `reconstructDagResult` derives from checkpoints with an empty STARTED set (never hangs, §8.1).

**SDK envelope builder (not the raw customer generator).** `executeChildContext` checkpoints exactly the string returned by the `summaryGenerator` option on the large-payload path, so the DAG wires an **SDK wrapper** — `buildDagSummaryEnvelope(result, config.summaryGenerator ?? defaultDagSummaryGenerator)` — that emits the full `DagSummary` (SDK-owned fields + the customer text under `summary`). Passing `config.summaryGenerator` directly would checkpoint only the observability string and lose the load-bearing fields, reintroducing #751.

**errorMapper pass-through (F4).** Because the DAG body runs inside `runInChildContext`, and `executeChildContext`'s catch (verified in `run-in-child-context-handler.ts`) rewraps _any_ thrown error as `new ChildContextError(reconstructedError.message, reconstructedError)` **unless an `errorMapper` is supplied**, §7.4 supplies `errorMapper: (e) => e`. This is what lets a thrown `DagCyclicDependencyError`/`DagDuplicateTaskError`/`DagInvalidTaskNameError`/`DagInvalidDependencyError` reach the caller **unwrapped** (as §5.10 requires), rather than as a `ChildContextError` wrapping it. It also means a **deterministic** arbitrary throw from `register` surfaces as its raw error (not a `ChildContextError`); see §5.10 "Register-callback throws" (updated). For a **nested `dag` task**, the same pass-through applies at that nested container, so a nested DAG's validation error surfaces to the parent DAG's executor as the raw `Dag*Error`, recorded in the parent's `TaskExecution.error` (this is the one exception to the §2.8 "child-context-wrapped tasks surface `ChildContextError`" note, and is called out there).

`context.dag()` on `DurableContextImpl` wires `createDagHandler` with `this.runInChildContext.bind(this)` (the top-level DAG container is a real counter slot in the parent) and the internal explicit-ID accessors. A **nested** `dag` task instead wires it with `this.runInChildContextWithExplicitId.bind(this)` so the nested container gets `DAG_NODE_T_{name}` (§7.3.2 `runDagWithExplicitId`, F6).

### 7.5 `DagContextImpl` (registration)

Each method: validate name (§6.1) → assert-not-duplicate (§6.2) → build a `TaskDef` → store → return `new TaskHandleImpl(name, symbol)`. The `executor` closure binds the operation kind and applies the **deps-first argument rule** (§2.3).

**`TaskDef` carries two distinct dep sets (F7).** The inline `deps` array (typed, in `DepsMap`) and the builder `.after(...)` edges (ordering-only, **not** in `DepsMap`) have different consumers, so `TaskDef` stores them separately:

```ts
interface TaskDef {
  name: string;
  kind:
    | "step"
    | "invoke"
    | "callback"
    | "wait"
    | "waitForCondition"
    | "runInChildContext"
    | "map"
    | "parallel"
    | "dag";
  /** Inline deps only (from the `deps` argument). Drives DepsMap construction. */
  inlineDeps: readonly AnyTaskHandle[];
  /** inlineDeps ∪ builder .after(...) edges, de-duplicated. Drives scheduling,
   *  readiness, trigger-rule evaluation, and cycle detection. */
  allDeps: readonly AnyTaskHandle[];
  triggerRule?: TriggerRule;
  runIf?: (deps: Record<string, unknown>) => boolean;
  options?: unknown;
  executor: (
    ctx: DurableContextImpl<Logger>,
    depsMap: Record<string, unknown>,
  ) => DurablePromise<unknown>;
}
```

Which surface consumes which set:

| Consumer                                                    | Uses                                    | Section    |
| ----------------------------------------------------------- | --------------------------------------- | ---------- |
| `DepsMap` construction (typed result access in the fn body) | `inlineDeps`                            | §2.5, §7.6 |
| Readiness (`queueDownstream`)                               | `allDeps`                               | §5.1       |
| Trigger-rule status set                                     | `allDeps`                               | §5.3       |
| Missing-dep validation                                      | `inlineDeps ∪ allDeps` (i.e. `allDeps`) | §6.3       |
| Cycle detection (`detectCycle`)                             | `allDeps`                               | §6.4       |

`.after(...)` on the builder appends to `allDeps` only; the inline `deps` argument populates **both** `inlineDeps` and `allDeps`. This prevents builder deps from leaking into the typed `DepsMap` (the design doc's `buildDepsMap` must iterate `inlineDeps`, **not** the union) while still letting them gate scheduling/trigger/cycle. The scheduler builds a task's `depsMap` from `inlineDeps` (looking each up in `results`), so ordering-only builder deps never appear as keys.

The `executor` closure (deps-first rule, §2.3):

```ts
// step example — deps is the FIRST user-fn argument when inlineDeps are non-empty
const executor = (
  ctx: DurableContextImpl<Logger>,
  depsMap: Record<string, unknown>,
) =>
  ctx.runStepWithExplicitId(
    name,
    inlineDeps.length === 0
      ? (stepCtx) => (fn as StepTaskFn<[], TResult, TLogger>)(stepCtx)
      : (stepCtx) => (fn as any)(depsMap, stepCtx), // (deps, ctx)
    options,
  );
```

- `invoke`: `payload = await payloadFn(depsMap)` (or `payloadFn()` when no deps) first, then `runInvokeWithExplicitId(name, funcId, payload, options)`.
- `callback`: `runCallbackTaskWithExplicitId(name, wrappedSubmitter, options)` where `wrappedSubmitter` is `(callbackId, cbCtx) => submitter(depsMap, callbackId, cbCtx)` for non-empty deps, else the native `(callbackId, cbCtx) => submitter(callbackId, cbCtx)` (§7.3 Family B).
- `waitForCondition`: `runWaitForConditionWithExplicitId(name, (state, wcCtx) => check(depsMap, state, wcCtx), options)` — deps prepended.
- `runInChildContext`: `runInChildContextWithExplicitId(name, (childCtx) => fn(depsMap, childCtx), options)` — deps prepended.
- `map`/`parallel`/nested `dag`: resolve any deps-derived inputs (e.g. `items(depsMap)`) first, then delegate to the corresponding explicit-ID child-context variant.

`runIf` and `triggerRule` are stored on the `TaskDef` (evaluated by the scheduler, §5.3–§5.4), **not** passed to the handler.

### 7.6 In-memory deps flow (concrete `s1 → s2`)

```ts
const s1 = dagCtx.step("s1", [], async () => fetchData());
const s2 = dagCtx.step("s2", [s1], async (deps) => process(deps.s1));
```

1. Registration stores `s1`,`s2` `TaskDef`s; executors not called.
2. `s1` ready ⇒ scheduler calls `s1.executor(parentCtx, {})` ⇒ `runStepWithExplicitId("s1", () => fetchData())` ⇒ handler checkpoints at `…-DAG_NODE_T_s1`, returns result.
3. Scheduler stores `results.set("s1", {status:"SUCCEEDED", result})`.
4. `s2` ready ⇒ `depsMap = { s1: <result> }` (from `results`) ⇒ `s2.executor(parentCtx, {s1})` ⇒ `runStepWithExplicitId("s2", () => fn({s1}))` ⇒ checkpoints at `…-DAG_NODE_T_s2`.

The handlers never see `deps`; the DAG resolves them purely in memory.

### 7.7 Checkpoint / replay flow

- **First run**: each executed task checkpoints under its `DAG_NODE_T_{name}` ID via its handler; the DAG container checkpoints as a `CONTEXT`/`DAG` node whose payload is the serialized `DagResult`.
- **Interrupted mid-DAG** (some tasks checkpointed): on resume, the DAG container is not `SUCCEEDED`, so `executeChildContext` re-enters and the executor re-runs. Ready tasks that already completed hit their handler fast paths (return cached result / rethrow cached error) without re-executing; not-yet-run tasks execute for the first time. Skip decisions are recomputed deterministically from the rebuilt `results` map.
- **Completed DAG**: the container is `SUCCEEDED` ⇒ `handleCompletedChildContext` returns the deserialized `DagResult` **without** re-running the executor, when the full result was checkpointed (small payload).
- **Completed DAG, large payload (`ReplayChildren`)**: the container is `SUCCEEDED` but its payload is the compact `DagSummary` envelope (§8.1), so the aggregate `DagResult` is rebuilt from **(a)** the SDK-owned fields in that envelope — `totalCount`, the counts, `completionReason`, and `startedTaskNames` (the STARTED-at-early-completion set, which cannot be re-derived because those checkpoints were dropped, §5.7) — and **(b)** the still-checkpointed per-task nodes, re-read for each terminal task's result/status/error. The envelope's `summary` string is **not read**. If the envelope is missing/malformed, reconstruction derives from per-task checkpoints with an empty STARTED set rather than falling back to live execution (never hangs — the batch failure mode in [#751](https://github.com/aws/aws-durable-execution-sdk-js/issues/751) Repro 2). This is why a custom `summaryGenerator` can never diverge or hang DAG replay (§8.1).

---

## 8. Serialization of `DagResult`

Mirror the `BatchResult` machinery in `src/handlers/concurrent-execution-handler/batch-result.ts`:

- `DagResultImpl` implements `DagResult` with methods + a `results: Map`.
- `createDagResultSerdes(): Serdes<DagResult>` serializes to a plain, JSON-safe shape. **Crucially, each task's `result` is tagged with a `resultKind` discriminator** so heterogeneous, method-bearing results survive the round-trip (F5):

  ```ts
  type SerializedResultKind = "plain" | "batch" | "dag";

  interface SerializedTaskExecution {
    name: string;
    status: TaskStatus;
    skipReason?: SkipReason;
    resultKind?: SerializedResultKind; // present only when status === "SUCCEEDED"
    result?: unknown; // shape depends on resultKind (see below)
    error?: ErrorObject;
    startedAt?: string;
    completedAt?: string;
  }
  interface SerializedDagResult {
    tasks: SerializedTaskExecution[];
    completionReason: DagCompletionReason;
  }
  ```

**Why tagging is required (F5).** For `map`/`parallel` tasks the result is a `BatchResult` and for nested `dag` tasks it is a `DagResult` — both are **class instances with methods** (`getResults()`, `throwIfError()`) and internal `Map`s. A generic `JSON.stringify` of such a value loses every method and serializes a `Map` to `{}`. Since the "Completed DAG" replay path (§7.7) returns the **deserialized container** _without_ re-running the executor, a method-less object would violate the `getResult<TResult>(): TResult` contract at runtime. The container serdes therefore serializes and restores each task result **according to its `resultKind`**, recursively:

- **`resultKind` assignment (serialize):** determined from the task's _kind_ recorded on its `TaskDef` (§7.5) — `map`/`parallel` ⇒ `"batch"`, nested `dag` ⇒ `"dag"`, everything else ⇒ `"plain"`. (Deriving from the static task kind is deterministic and avoids brittle `instanceof` probing.)
  - `"batch"` ⇒ serialize the result with the **batch** error-preserving serializer (`createBatchResultSerdes` internals / the `SerializedBatchResult` shape), not raw `JSON.stringify`, so `BatchItem.error` types and counts survive.
  - `"dag"` ⇒ serialize the nested result with `createDagResultSerdes` **recursively** (a nested DAG whose tasks are themselves `map`/`dag` recurses again).
  - `"plain"` ⇒ the task's own operation serdes (or default) produced a JSON-safe value already.
- **restore (`restoreDagResult(plain)`):** rehydrates the top-level `DagResult` methods, then walks `tasks[]` and for each `SUCCEEDED` task **recursively restores the result by `resultKind`**: `"batch"` ⇒ `restoreBatchResult(result)`; `"dag"` ⇒ `restoreDagResult(result)` (recursive); `"plain"` ⇒ used as-is. This guarantees `getResult(mapOrNestedDagHandle)` returns a **fully-methoded** `BatchResult`/`DagResult` on the completed-replay path, satisfying the `getResult<TResult>` type.

Errors serialize via `DurableOperationError.toErrorObject()` and reconstruct via `DurableOperationError.fromErrorObject()` (batch results reuse the batch cause-chain serializer). `TaskHandle._id` (symbol) is **not** serialized — the deserialized `DagResult.getResult(handle)` resolves by `handle.name`.

### 8.1 `DagSummary` (large-payload fallback) — SDK-owned envelope, replay-safe by construction

When the serialized `DagResult` exceeds `CHECKPOINT_SIZE_LIMIT_BYTES`, `executeChildContext` switches to `ReplayChildren` and checkpoints a compact **SDK-owned** record instead of the full result. The design deliberately avoids the `summaryGenerator` replay hazard reported for map/parallel in [aws/aws-durable-execution-sdk-js#751](https://github.com/aws/aws-durable-execution-sdk-js/issues/751) (a customer `summaryGenerator` string is load-bearing for batch replay and can silently diverge or hang it). DAG is greenfield, so it adopts the issue's **Option 1 (SDK envelope)** from v1:

```ts
// SDK-OWNED record. The customer generator CANNOT override or remove any field
// below except `summary`. These fields are authoritative and always present.
interface DagSummary {
  type: "DagResult";
  totalCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  completedCount: number; // success + failure + skipped
  completionReason: DagCompletionReason;
  /** Task NAMES that were STARTED-but-not-terminal at an early completion
   *  (§5.7). Their per-task checkpoints were dropped, so this is the ONLY
   *  faithful record of the STARTED set — the DAG analog of the `startedIndexes`
   *  fix requested in #751, but keyed on stable names (no index fragility). */
  startedTaskNames: string[];
  /** Terminal task names (SUCCEEDED/FAILED/SKIPPED), for diagnostics. Their
   *  results/statuses are re-read from the still-checkpointed per-task nodes. */
  terminalTaskNames: string[];
  /** Free-form OBSERVABILITY-ONLY text from the customer `summaryGenerator`,
   *  quarantined here. NEVER read on replay. Absent if no generator configured. */
  summary?: string;
}
```

**Contract (the #751-avoidance guarantees):**

1. **`summaryGenerator` is observability-only and cannot corrupt replay.** Its signature is `(result: DagResult) => string` (§2.9) and its output is stored **verbatim under `summary`**. It cannot set, override, or remove any of the count/reason/started fields — those are computed by the SDK from the live `DagResult`. Contrast with batch, where the whole record _is_ the generator's opaque string.
2. **Replay never reads `summary`.** On the `ReplayChildren` path, the DAG body is replay-mode-aware (mirroring the batch handler's `executeItems`→`replayItems` split): in `ReplaySucceededContext` it **reconstructs** the aggregate `DagResult` instead of scheduling. Reconstruction re-runs the _deterministic_ parts — `register` (to rebuild the graph) and the skip/trigger-rule recomputation (§9.5, pure functions of upstream terminal statuses) — but **executes no task bodies and starts no new work**. It sources: individual results/statuses from the still-checkpointed per-task nodes; and `totalCount`, the counts, `completionReason`, and the STARTED set from the SDK-owned envelope fields (the STARTED set cannot be re-derived — those checkpoints were dropped at early completion, §5.7). The customer's `summary` text is inert on replay, so no generator output can change the replayed result or send replay down a non-terminating path.
3. **Malformed/missing record ⇒ derive, never hang.** `restoreDagResult` validates the record (`type === "DagResult"`, non-negative-integer counts). If it is missing or malformed, reconstruction derives what it can from the per-task checkpoints and treats the STARTED set as empty — it does **not** fall back to live execution under `ReplaySucceededContext` (the batch hang in #751 Repro 2). A hang is never a correct outcome.

`defaultDagSummaryGenerator(result: DagResult): string` produces a short human string (e.g. `"12/15 succeeded, 1 failed, 2 skipped (COMPLETED_WITH_FAILURES)"`); the SDK wraps it into the envelope above. It parallels `createMapSummaryGenerator` in `src/utils/summary-generators/summary-generators.ts` **but** — unlike the batch generator — its output is genuinely never load-bearing.

[CODE NOTE — divergence from batch, motivated by #751] For map/parallel the checkpointed summary string is itself parsed on replay (only `totalCount` is read; everything else re-derived), which is the root of #751. The DAG separates the two concerns: SDK-owned structural fields (read on replay) vs. customer observability text (never read). If the batch handler later adopts the same envelope (issue Option 1), the DAG and batch summary shapes converge; until then they differ intentionally.

---

## 9. Edge cases

### 9.1 Nested DAGs

A nested `dagCtx.dag(name, deps, register, config)` is a task whose `executor` calls `runDagWithExplicitId(name, register, config)` → another `createDagHandler` invocation wrapped in a child context under `…-DAG_NODE_T_{name}`. Its result is a `DagResult`, consumed by downstream tasks via `deps`. Scope is isolated (§10.1); IDs recurse as `…-DAG_NODE_T_{parent}-DAG_NODE_T_{child}` (§4.2).

### 9.2 `maxConcurrency` for nested DAGs

Parent `maxConcurrency` limits **only top-level** tasks; each nested DAG has its own scope/limit. (Recommendation adopted from open questions; documented behavior.)

### 9.3 Interruption mid-DAG

Covered in §7.7. Key invariant: skip decisions and `DepsMap` are recomputed each run from checkpointed task results, so partial progress resumes deterministically. Tasks that were `STARTED` but not checkpointed at interruption simply re-execute (at-least-once), identical to a standalone step interrupted mid-flight.

### 9.4 Termination-manager interaction

Two distinct failure channels, matching exactly what the corresponding batch code does. **Both guards are re-implemented in the DAG handler (F12)** — the DAG uses its own `dag-executor.ts`/`createDagHandler`, _not_ `concurrent-execution-handler.ts`, so it cannot inherit these guards and must reproduce them. Their **ordering** in `createDagHandler` (§7.4): both fire **before** the child context is entered and **before** `register`, because both depend only on `config`:

- **`maxConcurrency <= 0` → THROWS a plain `Error`** (async, surfaced when the `dag()` promise is awaited). This mirrors `concurrent-execution-handler.ts`, which does `throw new Error("Invalid maxConcurrency: … Must be a positive number …")` — it does **not** terminate the execution. The DAG reuses this exact guard shape at the top of `createDagHandler`.
- **Mutually-exclusive `completionConfig` → TERMINATES** via a DAG-local `validateDagCompletionConfig` that calls `terminationManager.terminate({ reason: TerminationReason.CONFIG_VALIDATION_ERROR, … })` and returns a never-resolving promise, mirroring `validateCompletionConfig` in `concurrent-execution-handler.ts` (a non-retryable config error is terminated, not thrown, so the durable runtime does not treat it as a retryable customer error). Runs immediately after the `maxConcurrency` guard, still before `register`.
- **Registration/graph validation errors (§6)** — cycle, bad name (incl. the reserved-`DAG_NODE_T_` rule, §6.1), duplicate, missing dep — are deterministic (same graph every replay). They run **after** `register` (they need the assembled task set) and are surfaced by **throwing** the corresponding `Dag*Error` from within the DAG child-context body. Because §7.4 wires `errorMapper: (e) => e` (F4), the raw `Dag*Error` propagates **unwrapped** to the `dag()` caller (rather than being re-wrapped as `ChildContextError` by `executeChildContext`). Because they are deterministic they reproduce identically on replay. (Rationale: these are graph-shape errors thrown from customer-visible registration calls, analogous to the plain-`Error` throws the batch handler uses for "requires an array of items"/"requires an executor function"/invalid `maxConcurrency`. Only the _config-union_ violation follows the `terminate` path, matching `validateCompletionConfig`.)
- `NonDeterministicExecutionError` from `validateReplayConsistency` on a task ID terminates the whole execution (unrecoverable), same as any other operation.
- A task's normal failure is **not** a termination — it is a terminal task state (§5.8).

[CODE NOTE — CORRECTION vs. previous draft] The earlier draft claimed invalid `maxConcurrency` routes through `terminationManager.terminate`. That is wrong: `concurrent-execution-handler.ts` **throws** for `maxConcurrency <= 0` and only **terminates** for the mutually-exclusive-`completionConfig` case. §2.9 ("`maxConcurrency <= 0` throws") is the correct statement; this section is now aligned with it. Note that neither guard is inherited — both are re-implemented in `createDagHandler` (F12).

### 9.5 What SKIPPED tasks checkpoint

**Nothing.** A skip is a pure function of upstream terminal statuses + a deterministic `runIf`, so it is recomputed identically each run and needs no entity ID / checkpoint. This keeps skips free and replay-safe. Skips are recorded only in the in-memory `DagResult` and, transitively, in the container's serialized payload / `DagSummary`.

[CODE NOTE] Alternative (checkpoint a skip marker for AWS-console visibility) is deferred — see open question §11.2. v1 favors zero-cost skips.

### 9.6 `getResult` for failed / skipped / not-run tasks

- `SUCCEEDED` ⇒ returns the (deserialized) result.
- `FAILED` ⇒ returns `undefined` (inspect `results.get(name).error` or `failed()`).
- `SKIPPED` ⇒ returns `undefined` (`skipReason` on the `TaskExecution`).
- **In-flight at early completion** (started but the DAG resolved first, §5.7) ⇒ `getResult` returns `undefined`; `getStatus` returns `"STARTED"`.
- **Never started** (early completion stopped the scheduler before this task ran) ⇒ the task is **absent** from `results`: `getResult` returns `undefined` and **`getStatus` returns `undefined`** (it is never labeled `"STARTED"`). This matches `CompletionItemStatus.status === undefined` for not-yet-started batch items.

### 9.7 Serdes for heterogeneous tasks

There are **two independent serialization layers**, and the earlier "the container's serdes only serializes the aggregated `DagResult` shell" statement was wrong — it contradicted §8 and is corrected here (F5):

1. **Per-task operation checkpoint.** Each task checkpoints its own result under its `DAG_NODE_T_{name}` ID using **its own** operation serdes (per-task `options.serdes`, else `DagContext` default, else `defaultSerdes`) — unchanged from standalone operations.
2. **Aggregated `DagResult` container payload.** The container (`DagConfig.serdes` / `createDagResultSerdes`) serializes the **full** `DagResult`, which **embeds a copy of every task's result** (`SerializedDagResult.tasks[].result`, §8). This embedding is **necessary**, not redundant: the "Completed DAG" replay path (§7.7) returns the deserialized container _without_ re-running the executor, so it cannot re-read the individual per-task checkpoints — the results must live in the container payload. For `map`/`parallel` (result = `BatchResult`) and nested `dag` (result = `DagResult`) tasks, the embedded result is serialized/restored **recursively by `resultKind`** (§8), so methods and `Map`s survive.

(If the aggregated payload exceeds `CHECKPOINT_SIZE_LIMIT_BYTES`, the `ReplayChildren` path applies (§8.1, §12.3): the DAG body is **replay-mode-aware** — in `ReplaySucceededContext` it **reconstructs** the `DagResult` from the SDK-owned `DagSummary` envelope (authoritative counts / `completionReason` / `startedTaskNames`) plus the still-checkpointed per-task results, **without re-scheduling** and **without reading the customer `summary` text**. This mirrors how the batch handler's `replayItems` reconstructs rather than re-running items live — and is the reconstruction path that relies on layer 1. Deriving the aggregate this way, rather than re-running the scheduler, is what keeps the STARTED-at-early-completion set and `completionReason` faithful on replay, avoiding the #751-class divergence.)

### 9.8 `map`/`parallel` task early-completion inside a DAG

A `map`/`parallel` task's own `completionConfig` governs it internally and it returns a `BatchResult` (one task node). The DAG-level `completionConfig` governs the DAG. The two are independent.

---

## 10. Scoping & determinism rules

### 10.1 Name uniqueness scope

Names must be unique **within the immediate `DagContext`**. Nested DAGs open a fresh scope. A dep handle must belong to the same scope (§6.3).

### 10.2 Registration determinism

The `register` callback must be deterministic on replay (same task names, deps, trigger rules). It may be `async` (§11.1) but must not perform non-deterministic IO. Non-deterministic registration produces a different graph on replay and will surface as `validateReplayConsistency` failures on task IDs.

---

## 11. Open questions & recommendations

1. **`DepsMap` typing under non-`ALL_SUCCESS` rules** (§2.5). _Recommendation:_ keep results strongly typed for the common `ALL_SUCCESS` path; document that values may be `undefined` under other rules. Revisit a `DepsMap` variant that unions `undefined` if customer friction appears.
2. **Observability of SKIPPED tasks** (§9.5). _Recommendation:_ v1 checkpoints nothing for skips (zero cost). If console visibility is required, add an opt-in `checkpointSkips` flag in v2 that writes a lightweight `SKIPPED` context node.
3. **Async registration callback** (§10.2). _Recommendation:_ allow `async` for ergonomics (`for (const x of await cfg())`), but document the determinism requirement strongly and lint against IO.
4. **`signal()` from within a DAG task.** _Recommendation:_ out of scope for the DAG spec; if/when the separately-proposed `signal()` lands, DAG tasks inherit it with the same "stop starting new tasks; in-flight finish" semantics as `completionConfig` early completion (§5.7).
5. **Very large graphs (memory).** _Recommendation:_ document a recommended ceiling (e.g. low thousands of tasks); defer hard limits/warnings to v2.
6. **`OperationSubType.DAG`** vs reusing `RUN_IN_CHILD_CONTEXT`. _Recommendation:_ add `DAG = "Dag"` for observability; low-risk additive enum change.

---

## 12. Testing strategy

### 12.1 Unit tests

- **`dag-validator.test.ts`**: cycle detection (self-loop, 2-cycle, deep cycle, diamond=no-cycle), invalid names (empty, >100, bad chars, valid dashes), duplicates (same name across different op kinds), missing/foreign-scope deps.
- **`trigger-rules.test.ts`**: full truth table (§5.3) for all six rules × {all-succ, all-fail, mixed, includes-skip}.
- **`task-handle.test.ts`**: `.after()`/`.triggerRule()` chaining mutates `TaskDef`; `DepsMap` type-level tests (via `tsd`/`expectType`) for empty vs non-empty deps and name-keyed result typing.
- **`dag-executor.test.ts`** (mock context): readiness/topological order, `maxConcurrency` throttling, skip propagation, `runIf` skip, `completionConfig` threshold + custom paths, fail-fast vs compensation.
- **`dag-result.test.ts`**: `getResult`/`getStatus` for succeeded/failed/skipped/not-run; `throwIfError`; `createDagResultSerdes` round-trip incl. error reconstruction; `restoreDagResult`; `DagSummary` shape.
- **Entity-ID tests**: `createTaskId` output for prefixed/unprefixed contexts; nested recursion `…-DAG_NODE_T_a-DAG_NODE_T_b`; no collision with counter IDs.

### 12.2 `LocalDurableTestRunner` integration (`@aws/durable-execution-sdk-js-testing`)

Follow the existing `*.composed.test.ts` / replay-test patterns:

- Diamond `A → {B,C} → D`: assert `getOperation("A"|"B"|"C"|"D")` all `SUCCEEDED`, `D` result merges `B`,`C`; assert B,C ran concurrently (invocation/operation counts).
- Mixed op types (step/invoke/callback/wait/child/map/parallel) as tasks — each appears as its native operation subtype in history under a `DAG_NODE_T_`-derived id.
- Compensation: `charge` fails ⇒ `refund` (`ALL_FAILED`) runs, `fulfill` (`ALL_SUCCESS`) skips, `audit` (`ALL_DONE`) runs.
- `runIf` branching (Example 7): exactly one of publish/review/blocked runs; others `SKIPPED` with `RUN_IF_PREDICATE`.
- Nested DAG: sub-DAG result consumed downstream; scope isolation.
- `completionConfig.shouldComplete` early completion (rules engine, Example 6).

### 12.3 Replay tests (parallels `concurrent-execution-handler.replay.test.ts`)

- **Order-independence**: force B-before-C on run 1 and C-before-B on replay (via controllable async in the mock/serdes); assert identical `DagResult` and no `NonDeterministicExecutionError` (proves name-based IDs, §4.4).
- **Interruption/resume**: interrupt after a subset of tasks checkpoint; resume; assert completed tasks hit fast paths (not re-executed — count side effects) and remaining tasks run once.
- **Skip determinism**: a `runIf`-skipped task stays skipped across replay without a checkpoint.
- **Large payload**: force `DagResult` over `CHECKPOINT_SIZE_LIMIT_BYTES`; assert the `ReplayChildren` path **reconstructs** an equal `DagResult` from the `DagSummary` envelope + checkpointed per-task nodes (no live re-scheduling). Include an early-completion variant (STARTED tasks present) and assert `startedTaskNames`/`completionReason`/counts survive identically; and a **custom-`summaryGenerator` variant** asserting a free-form (or deliberately malformed) `summary` string neither changes the replayed `DagResult` nor hangs replay (the #751 regression guard).

### 12.4 Verification bar

New code must build (`tsc`) and pass `eslint` + the package test suite. Type-level tests guard `DepsMap`/conditional-fn inference. Add ESLint-plugin rules (in `@aws/durable-execution-sdk-js-eslint-plugin`) for DAG footguns (non-deterministic `register`, async `runIf`) as a follow-up.

---

## 13. Worked examples

### 13.1 Diamond

```ts
const result = await context.dag("etl", async (d) => {
  const fetch = d.step("fetch", [], async () => fetchSource());
  const a = d.step("ta", [fetch], async (deps) => transformA(deps.fetch));
  const b = d.step("tb", [fetch], async (deps) => transformB(deps.fetch));
  d.step("merge", [a, b], async (deps) => merge(deps.ta, deps.tb));
});
result.throwIfError();
console.log(result.getResult("merge"));
```

### 13.2 Compensation with trigger rules

```ts
await context.dag("payment", async (d) => {
  const charge = d.step("charge", [], async () => chargeCard(event));
  d.step("fulfill", [charge], async (deps) => fulfill(deps.charge)); // ALL_SUCCESS
  d.step("refund", [], async () => refundCard(event))
    .after(charge)
    .triggerRule("ALL_FAILED");
  d.step("notify", [], async () => notifyCustomer(event))
    .after(charge)
    .triggerRule("ALL_DONE");
});
```

### 13.3 runIf branching

```ts
await context.dag("moderation", async (d) => {
  const fetch = d.step("fetch", [], async () => fetchContent(event));
  const classify = d.step("classify", [fetch], async (deps) =>
    classify(deps.fetch),
  ); // "safe"|"review"|"block"
  d.step("publish", [classify], async (deps) => publish(deps.classify), {
    runIf: (deps) => deps.classify === "safe",
  });
  d.step("review", [classify], async (deps) => review(deps.classify), {
    runIf: (deps) => deps.classify === "review",
  });
  d.step("blocked", [classify], async (deps) => block(deps.classify), {
    runIf: (deps) => deps.classify === "block",
  });
  d.step("audit", [], async () => audit(event))
    .after(classify)
    .triggerRule("ALL_DONE");
});
```

### 13.4 Rules engine with custom completion

Short-circuit the moment **any** rule returns a `REJECT` verdict — the motivating result-based completion (§1.1). This is expressible because `DagCompletionStatus` exposes per-task **results** (§2.9, §5.7), which the batch `CompletionStatus` does not:

```ts
await context.dag(
  "rules",
  async (d) => {
    rules.forEach((r) => d.step(`rule_${r.id}`, [], async () => evaluate(r))); // => { verdict: "ACCEPT" | "REJECT" }
    //                          ^ interpolated `r.id` must satisfy the name rules (§6.1): no dash, no `DAG_NODE_T_`
  },
  {
    maxConcurrency: 5,
    completionConfig: {
      // status: DagCompletionStatus — items[].result / results carry each task's value.
      shouldComplete: (status) =>
        status.items.some(
          (i) =>
            i.status === "SUCCEEDED" &&
            (i.result as { verdict: string })?.verdict === "REJECT",
        )
          ? completeBatch(CompletionOutcome.FAILED) // a rule rejected => fail the whole DAG early
          : continueBatch(),
    },
  },
);
```

Because `DagCompletionItemStatus.result` is populated for `SUCCEEDED` tasks, the predicate can inspect the actual verdict rather than merely "some task succeeded." (Equivalently, `status.results.get("rule_42")?.result`.) When it returns `completeBatch(CompletionOutcome.FAILED)`, `completionReason` becomes `CUSTOM_COMPLETION_FAILED` and `throwIfError()` throws.

---

## 14. Backward compatibility

Pure addition. `DurableContext` gains one method (`dag`); no existing type or method changes. `DagContext`/`TaskHandle`/`DagResult` are new. Existing applications are unaffected; `dag()` is strictly opt-in.

---

## Appendix A. Review resolutions (loop iteration 1)

Each numbered reviewer finding and how this revision addresses it. All fixes were re-grounded by reading the cited source files in this pass.

### A.1 (Blocking) Callback-handler wiring defect + wrong file citation

**Was:** §7.3 claimed _every_ handler exposes an identical `createStepId: () => string` injection and cited `callback.ts:37/58`.
**Verified in code:** `createWaitForCallbackHandler(context, peekStepId, runInChildContext, getDefaultCallbackDeserializer?)` (`wait-for-callback-handler.ts:20-24`) takes **`peekStepId` + `runInChildContext`, no `createStepId`** — it wraps the submitter in a child context. The low-level `createCallback` factory (`callback.ts`) _does_ take `createStepId` (3rd param) but also has extra params (`checkAndUpdateReplayMode`, `getDefaultCallbackDeserializer`) so its signature is not uniform with the step handler.
**Fix:** §7.3 now splits handlers into **Family A** (take `createStepId` — step/invoke/wait/waitForCondition/runInChildContext/low-level callback, with corrected line citations `step-handler.ts:44/55`, `invoke-handler.ts:32/78`, `run-in-child-context-handler.ts:75/103`) and **Family B** (`waitForCallback`, wired via `runInChildContextWithExplicitId` → new §7.3.2 `runCallbackTaskWithExplicitId`). Added an explicit CORRECTION note. §2.8 error-type note and §7.5 callback closure updated accordingly.

### A.2 (Blocking) `TASK_FAILED` contradicts batch `CompletionReason` union & fail-fast code

**Was:** `DagCompletionReason` invented `"TASK_FAILED"` while also claiming to "reuse the `CompletionReason` vocabulary"; §5.8 claimed default fail-fast sets `TASK_FAILED`.
**Verified in code:** `CompletionReason` (`types/batch.ts`) = `ALL_COMPLETED | MIN_SUCCESSFUL_REACHED | FAILURE_TOLERANCE_EXCEEDED | CUSTOM_COMPLETION_SUCCEEDED | CUSTOM_COMPLETION_FAILED` — **no `TASK_FAILED`**. `concurrent-execution-handler.ts` default (no `completionConfig`) is fail-fast (`shouldContinue` returns `failureCount === 0`) and reports `FAILURE_TOLERANCE_EXCEEDED`.
**Fix:** §2.8 makes `DagCompletionReason = CompletionReason` (alias, no new members). §5.8 rewritten: a failed task is a terminal state; the DAG **drains the reachable graph** by default (so trigger-rule compensation works) → `completionReason = ALL_COMPLETED`, and `throwIfError()` keys off `failureCount`. Added an explicit **[CODE NOTE — DELIBERATE DIVERGENCE]** explaining that the DAG scheduler is a separate component from `ConcurrencyController` and intentionally does not adopt batch fail-fast as its default (opt in via `completionConfig`). This also removes the internal contradiction with the compensation example (§13.2).

### A.3 (Blocking) Unproven mode-management reuse for name-based IDs

**Was:** §7.3 wrapped the explicit-ID variants in `this.withDurableModeManagement(...)`.
**Verified in code:** `withDurableModeManagement` → `captureExecutionState` / `checkAndUpdateReplayMode` / `checkForNonResolvingPromise`, all of which call `peekStepId()` = **counter-based** (`_stepCounter + 1`). DAG tasks checkpoint under `…-DAG_NODE_T_{name}`, never under the counter, so the wrapper would mis-drive context mode.
**Fix:** New §7.3.1 documents the coupling and proves the resolution: explicit-ID variants **do not** use `withDurableModeManagement` and pass a **no-op `checkAndUpdateReplayMode`**; task replay correctness comes solely from counter-independent machinery — handler fast paths keyed on the explicit ID (`step-handler.ts` SUCCEEDED/FAILED branch; equivalents in every handler) and `validateReplayConsistency(stepId, …)` (inspects only Type/Name/SubType). The container-level replay decision stays with the parent's `runInChildContext` wrapper (a real counter slot). Worst-case effect of the no-op is cosmetic log-mode only; nested child-context tasks recompute their own mode via `determineChildReplayMode`.

### A.4 (Moderate) `maxConcurrency` throw-vs-terminate contradiction

**Was:** §2.9 said `maxConcurrency <= 0` throws; §9.4 said it terminates.
**Verified in code:** `concurrent-execution-handler.ts` **throws** `new Error("Invalid maxConcurrency…")` for `<= 0`; only the mutually-exclusive `completionConfig` case calls `terminationManager.terminate` (`validateCompletionConfig`).
**Fix:** §9.4 rewritten into two explicit channels — `maxConcurrency <= 0` **throws** (aligned with §2.9), `completionConfig` union violation **terminates**. Added a CORRECTION note.

### A.5 (Moderate) deps/ctx argument-order inconsistency + never-started status labeling

**Was:** `StepTaskFn` used `(deps, ctx)` while `ChildTaskFn` used `(ctx, deps)`; `CheckTaskFn`/`SubmitterTaskFn` placed `deps` in the middle. §9.6 labeled never-started tasks `"STARTED"`.
**Fix:** §2.3 now states a single **deps-first rule** and applies it uniformly (`ChildTaskFn` → `(deps, ctx)`; `CheckTaskFn` → `(deps, state, ctx)`; `SubmitterTaskFn` → `(deps, callbackId, ctx)`); §7.5 closures updated to match. §2.8 + §9.6 clarify `STARTED` = in-flight-at-early-completion only; a **never-started task is absent from `results`**, so `getStatus` returns `undefined` (matching `CompletionItemStatus.status === undefined`).

---

## Appendix B. Review resolutions (loop iteration 2)

### B.1 (Required) `checkAndUpdateReplayMode` handler list in §7.3.1 wrongly included `waitForCondition`

**Was:** §7.3.1 said to pass a no-op `checkAndUpdateReplayMode` to `invoke`, `wait`, **`waitForCondition`**, and `createCallback`.
**Verified in code (two ways):** (a) `createWaitForConditionHandler(context, checkpoint, createStepId, logger, parentId, getDefaultSerdes?, plugin?)` (`wait-for-condition-handler.ts:45-52`) has **no** `checkAndUpdateReplayMode` parameter — its 4th positional is `logger`; (b) `durable-context.ts::waitForCondition()` passes no mode callback. The handlers that actually accept `checkAndUpdateReplayMode` are **only** `createInvokeHandler` (5th positional, `invoke-handler.ts:29-36`), `createWaitHandler` (5th positional, `wait-handler.ts:24-29`), and the low-level `createCallback` (4th positional). `createStepHandler` (5th positional is `logger`, `step-handler.ts:52-60`), `createWaitForConditionHandler`, and `createRunInChildContextHandler` do **not**.
**Fix:** (1) §7.3 Family A now carries an authoritative **sub-split** listing exactly which handlers take `checkAndUpdateReplayMode` and which do not, with verified positional citations. (2) §7.3.1 resolution rewritten: no-op passed to **only** `invoke`/`wait`/`createCallback`; `createStepHandler`/`createWaitForConditionHandler`/`createRunInChildContextHandler` explicitly stated to take no such parameter, with a note that injecting `() => {}` into their `logger`/factory slot would be a positional-argument bug (the exact failure the reviewer flagged). (3) §7.3.2 comment reconciled: `runWaitForConditionWithExplicitId` documented as Family A **without** a mode param (swaps `createStepId` only, identical to `runStepWithExplicitId`); `runWaitWithExplicitId`/`runCreateCallbackWithExplicitId` documented as passing `NOOP_REPLAY_MODE` at their verified positions.

### B.2 (Required) Register-callback throw semantics were unspecified

**Was:** the spec did not state what happens when the `register` callback itself throws a non-`Dag*Error`.
**Fix:** added a **"Register-callback throws"** note to §5.10. It specifies that an arbitrary error thrown by `register` (which runs first in the DAG child-context body, before validation and before any task, per §7.4) is not caught by the DAG machinery: it propagates out and **rejects the `dag()` promise before any task runs / any task ID is minted**, surfacing as a `ChildContextError` at the parent boundary (§2.8). Replay behavior is tied to §10.2 determinism: a deterministic throw reproduces identically every replay; a non-deterministic throw is a §10.2 determinism violation (surfaces as `NonDeterministicExecutionError` / inconsistent container outcome). The note reiterates that `register` MUST be deterministic and non-deterministic work belongs inside a task.

---

## Appendix C. Design revision — completion-reason superset on a shared core base

**Change (supersedes A.2's alias decision).** A.2 resolved the invalid `TASK_FAILED` by making `DagCompletionReason` a plain alias of the batch `CompletionReason`. Review finding F13 then noted the residual footgun: under the default drain, `ALL_COMPLETED` could not distinguish a clean run from a drained-with-failures run. This revision adopts **Option B (superset on a shared core base)**:

1. **Extract a neutral base.** The 5-member `CompletionReason` moves from `src/types/batch.ts` to `src/types/core.ts` as the shared vocabulary (§7.2). Both features import it from `core`.
2. **Map/parallel unchanged.** `BatchResult.completionReason` remains exactly the core `CompletionReason` (batch imports the base from `core`; no behavior change).
3. **DAG is a superset of the base, not of batch.** `DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES"` (§2.8). The DAG has **no dependency** on the batch completion type — satisfying the requested dependency direction (both build on the core base; DAG does not build on map/parallel).
4. **Semantics.** Under the default (no `completionConfig`) drain: all-succeeded/skipped ⇒ `ALL_COMPLETED`; ≥1 failure ⇒ `COMPLETED_WITH_FAILURES`. Threshold/custom paths keep their existing core reasons. `throwIfError()` still keys off `failureCount` (unchanged).

**Why superset, not a fresh enum.** The DAG custom-completion path legitimately produces `CUSTOM_COMPLETION_SUCCEEDED`/`CUSTOM_COMPLETION_FAILED` via the reused `CompletionDecision`/`completeBatch` factories, so a fully separate enum would duplicate members and risk drift. A one-member superset adds the missing signal at zero maintenance cost.

**Sections touched:** §2.8 (type def, `DagResult` note, `[CODE NOTE — completion reason]`), §5.8 (default failure model), §7.2 (core extraction + `batch.ts`/`durable-error.ts` import updates). No change to the custom-path example §13.4 (it already uses `CUSTOM_COMPLETION_FAILED`).

---

## Appendix D. Design revision — longer reserved delimiter token (`DAG_NODE_T_`)

**Change.** The task-ID delimiter token was lengthened from a bare `T_` to `DAG_NODE_T_`; entity IDs are now `{parentId}-DAG_NODE_T_{name}` and task names may not contain the substring `DAG_NODE_T_` (§4.2, §6.1).

**Why.** The injectivity guarantee only requires _some_ reserved token forbidden in names (F1). A bare `T_` is injective but common in real identifiers, so the forbidden-substring rule would occasionally trip legitimate names (`T_shirt`, `GET_T_oken`, …). Lengthening the token makes accidental collisions astronomically unlikely, so ordinary names — including ones containing plain `T_` — are now accepted; only the full `DAG_NODE_T_` is reserved.

**Why it's free.** Entity IDs are hashed to a fixed 16-char MD5 prefix before storage (`checkpoint-manager.ts:396-403` sets `Id: hashId(stepId)` and hashes `ParentId`), so the token never appears in persisted checkpoint data or the console, and token length has no effect on stored size. The only place a raw entity ID appears is transient debug logging, where a longer token is still perfectly readable. The injectivity proof (§4.2) is unchanged — it holds for any reserved token forbidden in names.

**Sections touched:** §1 (intro ID format), §4.1–§4.4 (ID scheme, injectivity proof, rejected-alternatives note, self-describing claim), §6.1 (name rule + examples), and all `…-DAG_NODE_T_{name}` references throughout §7–§12.

---

## Appendix E. Design revision — dash (`-`) forbidden in task names

**Change.** Task-name charset narrowed from `^[a-zA-Z0-9_-]+$` to `^[a-zA-Z0-9_]+$` — `-` is no longer allowed in DAG task names (§6.1). Example names updated accordingly (`fetch-data`→`fetch_data`, `rule-a`→`rule_a`, `rule-${r.id}`→`rule_${r.id}`).

**Why.** `-` is the structural join character in entity IDs (counter joins like `1-2`, and the `-DAG_NODE_T_` delimiter). Reserving it as structural-only:

- **Strengthens injectivity (§4.2).** Because the delimiter begins with `-` and no name can contain `-`, a name can never forge the delimiter's leading `-`. This becomes the _primary_ injectivity guarantee — it holds even without the `DAG_NODE_T_`-substring rule (now demoted to defense-in-depth). The prior collision example (`x-DAG_NODE_T_y`) can no longer even be expressed as a legal name.
- **Is future-proof.** A charset can be **loosened** in a later release without breaking any in-flight execution, but never **tightened**. With zero users today, being strict now preserves the option to permit `-` later.
- **Keeps the ID grammar clean** for any future `-`-based diagnostics/parsing (names occupy dash-free leaf segments).

**Cost.** Minor ergonomic constraint — developers use `_` or camelCase (`fetch_data`, `ruleA`) instead of `fetch-data`. Interpolated names (`rule_${r.id}`) must ensure the dynamic part also conforms; a non-conforming name throws `DagInvalidTaskNameError` at registration.

**Sections touched:** §4.1 (ID example), §4.2 (injectivity proof rewritten around the no-dash guarantee + future-proofing note), §6.1 (charset + rejected-example list), §13.4 (example name + interpolation caveat).

---

## Appendix F. Design decision — `summaryGenerator` is observability-only (informed by #751)

**Context.** [aws/aws-durable-execution-sdk-js#751](https://github.com/aws/aws-durable-execution-sdk-js/issues/751) reports that for map/parallel the large-payload `summaryGenerator(result)` string is **load-bearing for replay** (replay parses it for `totalCount` and re-derives the rest) yet is typed `(result) => string` and documented "observability only." Consequences: replay diverges (STARTED items dropped, counts/`completionReason` differ) and a custom generator that isn't JSON-with-numeric-`totalCount` can make replay **hang** — both silent.

**Decision for DAG (greenfield ⇒ adopt the issue's Option 1 / SDK-envelope from v1).**

- The large-payload checkpoint is an **SDK-owned `DagSummary` envelope** (§8.1) whose structural fields — `totalCount`, `successCount`, `failureCount`, `skippedCount`, `completedCount`, `completionReason`, and `startedTaskNames` — are computed by the SDK from the live `DagResult`. The custom `summaryGenerator` **cannot override or remove them**; its output is stored verbatim under `summary` and is **observability-only**.
- **Replay never reads `summary`.** Reconstruction re-runs only the deterministic graph logic (`register` + skip/trigger recomputation), reads per-task results from checkpoints, and reads the authoritative aggregate fields (incl. the STARTED set, which is otherwise unrecoverable after early completion) from the envelope. So no generator output can diverge or hang replay — #751 cannot occur.
- **Never hang:** a missing/malformed envelope ⇒ derive from checkpoints with an empty STARTED set, never fall back to live execution under `ReplaySucceededContext`.
- `startedTaskNames` (names, not indexes) is the DAG analog of the issue's proposed `startedIndexes` — strictly better because DAG IDs/names are stable.

This answers the direct question "should DAG prevent `summaryGenerator` from overriding the count fields like the batch fix is considering?" — **yes**, and DAG goes all the way to the non-load-bearing envelope because it has no backward-compat constraint.

**Reconstruction approach (confirmed: design B — reconstruct, do not re-schedule).** On the large-payload completed-replay path the DAG body is **replay-mode-aware** (reads `parentCtx.durableExecutionMode`, mirroring the batch `executeOperation`→`replayItems` split) and calls `reconstructDagResult` instead of running `DagExecutor` — re-running only the deterministic `register` + skip/trigger recomputation, sourcing per-task results from checkpoints and the aggregate fields (incl. the STARTED set) from the envelope. The alternative — re-running the scheduler live — was rejected because, after early completion, the in-flight set is timing-dependent and cannot be reproduced faithfully (the same divergence class as #751 Repro 1). New helpers: `buildDagSummaryEnvelope` / `readDagSummaryEnvelope` (dag-result.ts) and `reconstructDagResult` (dag-executor.ts); the `summaryGenerator` wired into `runInChildContext` is the SDK envelope builder, never the raw customer generator.

**Sections touched:** §2.9 (`summaryGenerator` doc), §7.1 (file structure: reconstruction + envelope helpers), §7.4 (replay-mode branch + SDK envelope builder in `createDagHandler`), §7.7 (large-payload replay reconstruction), §8.1 (`DagSummary` envelope rewrite), §9.7 (layer-2 large-payload note), §12.3 (large-payload + custom-generator regression tests).

> **Cross-reference for maintainers.** If the batch handler adopts Option 1 (envelope) to fix #751, fold the shared structure into a common summary-envelope helper so DAG and batch converge. Until then the DAG summary is intentionally SDK-owned while the batch summary remains the customer string.
