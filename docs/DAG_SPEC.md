# DAG Support (`context.dag()`) — Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature.** The entire surface described in this document — `context.dag()`, `DagContext`, `TaskHandle`, `DepsMap`, `DagResult`, `DagConfig`, `TriggerRule`, `runIf`, the `DagResultEnvelope` container payload, and all associated types and errors — is **experimental and may be changed or removed in future releases** without a major-version bump. Do not depend on it in production until it is promoted to stable.
>
> **Required API annotation.** Every exported DAG symbol carries the repo's standard TSDoc experimental tag:
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

Status: Implementation-ready · **Stability: Experimental** · Target: `@aws/durable-execution-sdk-js` v1 · Scope: core package `packages/aws-durable-execution-sdk-js`

This is the deeper internal design document for the DAG feature; the customer-facing reference lives at [`sdk-reference/operations/dag.md`](../../aws-durable-execution-docs/docs/sdk-reference/operations/dag.md). This spec is the **canonical source of the DAG design**; the language-agnostic normative core and the per-language divergences are catalogued in [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md).

---

## 1. Overview

`context.dag()` adds a first-class primitive for declaring a **directed acyclic graph of tasks** with dependencies. Customers describe the graph once in a declarative _registration phase_; the runtime then schedules tasks topologically, runs independent chains concurrently, evaluates per-task trigger rules and `runIf` predicates, and aggregates results into a `DagResult`.

A DAG is implemented as a **child context** (one `runInChildContext` node in the parent's operation tree) whose body runs a **name-based scheduler**. Each task delegates to the **same operation handler** the equivalent `DurableContext` method uses (`createStepHandler`, `createInvokeHandler`, etc.); the only difference is that the task's entity ID is derived from its **name** (`{parentId}-DAG_NODE_T_{name}`) instead of the per-context monotonic counter. This is what makes DAGs replay-safe for arbitrary graph shapes.

### 1.1 Motivation

The SDK assigns each operation an entity ID from a per-context monotonic counter (`DurableContextImpl.createStepId()` in `src/context/durable-context/durable-context.ts`):

```ts
private createStepId(): string {
  this._stepCounter++;
  return this._stepPrefix ? `${this._stepPrefix}-${this._stepCounter}` : `${this._stepCounter}`;
}
```

IDs are assigned at operation **start**. `parallel`/`map` are replay-safe because `ConcurrentExecutionController.executeItemsConcurrently` starts items in **deterministic array order** (`currentIndex++`), so IDs never depend on completion order. In an arbitrary DAG, a downstream task starts when its upstream deps _complete_, and completion order can vary across replays — so counter-based IDs would diverge and `validateReplayConsistency` (`src/utils/replay-validation/replay-validation.ts`) would terminate the execution with a `NonDeterministicExecutionError`. DAG solves this with name-based IDs (§4).

Secondary motivations: declarative typed data-flow, maximum natural parallelism, per-task trigger rules for compensation/fallback, `runIf` conditional skips, heterogeneous task types, nested DAGs, and start-time cycle detection.

### 1.2 Goals

- Declarative task-graph API with typed data-flow (`DepsMap`).
- Replay-safe for **any** graph shape, completion order, or timing.
- Reuse existing checkpoint/replay/retry/serdes machinery unchanged.
- Per-task `triggerRule` and `runIf`.
- Heterogeneous tasks: `step`, `invoke`, `callback`, `wait`, `waitForCondition`, `runInChildContext`, `map`, `parallel`, nested `dag`.
- Pure addition: `DurableContext` gains one method; `DagContext` is a separate type.

### 1.3 Non-Goals (v1)

- Airflow-style dedicated branch operator (covered by `runIf`).
- Dynamic task creation at runtime (tasks spawning tasks).
- Cross-task resource pools / semaphores.
- Pre-built operators, cron scheduling, custom UI.

---

## 2. Public API

All public types live in `src/types/dag.ts` and are re-exported from `src/index.ts` and `src/types/index.ts`.

### 2.1 Entry point (added to `DurableContext`)

```ts
// Addition to interface DurableContext<TLogger> in src/types/durable-context.ts
dag(
  name: string,
  register: (dagCtx: DagContext<TLogger>) => void | Promise<void>,
  config?: DagConfig,
): DurablePromise<DagResult>;
```

- `register` is a **registration-only** callback: tasks are _declared_ but do not execute until it returns. It may be synchronous or `async`.
- Returns a `DurablePromise<DagResult>` — consistent with every other `DurableContext` operation (see `src/types/durable-promise.ts`). It resolves after the scheduler finishes.

The top-level `dag()` call carries no `TName` generic: the top-level DAG result is not a dependency of anything, so there is nothing to key. Nested `dag()` on `DagContext` _does_ carry `TName`, because it returns a `TaskHandle`.

### 2.2 `DagContext`

A separate type (it does **not** extend `DurableContext`) so only declarative task methods are visible inside `register`. Each method registers exactly one task and returns a `TaskHandle`. `deps` is always an explicit argument, never inferred; pass `[]` for a task with no dependencies.

```ts
export interface DagContext<TLogger extends DurableLogger = DurableLogger> {
  step<TName extends string, TResult>(
    name: TName,
    deps: readonly [],
    fn: (ctx: StepContext<TLogger>) => Promise<TResult>,
    config?: StepConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;
  step<TName extends string, TDeps extends readonly AnyTaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepTaskFn<TDeps, TResult, TLogger>,
    config?: StepConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  invoke<TName extends string, TIn, TOut>(
    name: TName,
    funcId: string,
    deps: readonly [],
    payloadFn: () => TIn | Promise<TIn>,
    config?: InvokeConfig<TIn, TOut> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TOut>;
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

  callback<TName extends string, TResult = string>(
    name: TName,
    deps: readonly [],
    submitter: (
      callbackId: string,
      ctx: WaitForCallbackContext<TLogger>,
    ) => Promise<void>,
    config?: WaitForCallbackConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;
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

  waitForCondition<TName extends string, TState>(
    name: TName,
    deps: readonly [],
    check: (
      state: TState,
      ctx: WaitForConditionContext<TLogger>,
    ) => Promise<TState>,
    config: WaitForConditionConfig<TState> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TState>;
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

  runInChildContext<TName extends string, TResult>(
    name: TName,
    deps: readonly [],
    fn: (ctx: DurableContext<TLogger>) => Promise<TResult>,
    config?: ChildConfig<TResult> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, TResult>;
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

  map<TName extends string, TIn, TOut>(
    name: TName,
    deps: readonly [],
    items: TIn[] | (() => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<readonly []>,
  ): TaskHandle<TName, BatchResult<TOut>>;
  map<TName extends string, TDeps extends readonly AnyTaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    mapFunc: MapFunc<TIn, TOut, TLogger>,
    config?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TOut>(
    name: TName,
    deps: readonly [],
    branches: (
      | ParallelFunc<TOut, TLogger>
      | NamedParallelBranch<TOut, TLogger>
    )[],
    config?: ParallelConfig<TOut> & ConditionalConfig<readonly []>,
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

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `ChildConfig`, `MapConfig`, `ParallelConfig`, `MapFunc`, `ParallelFunc`, `NamedParallelBranch`, `Duration`, `BatchResult` are the **existing** SDK types, reused verbatim so per-task retry/serdes/semantics/completion behavior is identical to the standalone operations.

**Why each task kind carries a no-deps overload.** The generic form derives the callback shape from `TDeps` through a conditional type (`StepTaskFn` and friends, §2.3). But a call site passing a bare `[]` does **not** infer `TDeps` as the empty tuple — TypeScript widens the literal to an array type, whose `length` is `number` — so the conditional always selects the deps-bearing branch. Writing the check as `TDeps["length"] extends 0` does not help, for the same reason. Every task kind whose callback has a native shape therefore carries an explicit **`deps: readonly []` overload** ahead of its generic signature (both on the `DagContext` interface and on `DagContextImpl`, since a class method with only one overload declaration hides its implementation signature from callers). Overload resolution matches on the parameter type instead of relying on inference, so no-deps call sites get the native shape without writing `[] as const` or spelling out every type argument. `dag` and `wait` need no overload: neither takes a deps-position callback.

**Result-type inference limitation.** A conditional-typed callback parameter is not an inference site for the result type, so `TResult`/`TState` widen to `unknown` on deps-bearing calls unless the caller annotates the callback's return type (as the examples and conformance handlers do) or pins the type arguments. The overloads do not change this.

### 2.3 Function-signature types (deps-first, collapsing on empty deps)

**Argument-order rule (uniform across all task kinds):** when `TDeps` is non-empty, `deps: DepsMap<TDeps>` is **always the first parameter**; the operation's native parameters follow in their normal order. When `TDeps` is empty, the deps parameter is omitted entirely and the signature collapses to the underlying SDK function's native shape. This single rule keeps `deps` access uniform while every operation's native arguments keep their usual relative order and meaning.

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

Each task fn preserves its underlying operation's native argument shape: `StepTaskFn` keeps `StepContext<TLogger>` (matching `StepFunc` in `src/types/step.ts`); `SubmitterTaskFn` keeps `(callbackId, ctx)` from `WaitForCallbackSubmitterFunc`; `CheckTaskFn` keeps `(state, ctx)` from `WaitForConditionCheckFunc`; `ChildTaskFn` keeps `(ctx)` from `ChildFunc`. In every non-empty-deps case the deps map is prepended as the first argument.

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
//                                                       ^^^^  ^^^  deps first, then native ctx

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

**Only inline deps populate the map.** Ordering-only deps added via the `.after(...)` builder (§3) gate scheduling but do **not** appear in `DepsMap`, so they never add a parameter:

```ts
// `a` is inline (typed, in deps map); `b` is ordering-only (waits for b, but no deps.b)
const e = dagCtx.step("e", [a], async (deps, ctx) => process(deps.a)).after(b);
//                                       deps === { a: <a's result> }   // no `b` key
```

### 2.4 `TaskHandle`

Registration-time reference + builder. **Never serialized** (`_id` is a `symbol`; it exists only during registration/scheduling in-memory). The deserialized `DagResult` resolves results by `name`.

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

Builder methods mutate the underlying `TaskDef` and return `this` for chaining. `after(...)` de-duplicates by `_id`.

### 2.5 `DepsMap` type machinery

```ts
export type DepsMap<TDeps extends readonly AnyTaskHandle[]> = {
  [K in TDeps[number] as K["name"]]: K extends TaskHandle<string, infer R>
    ? R | undefined
    : never;
};
```

Empty deps ⇒ `TDeps[number]` is `never` ⇒ `DepsMap<[]>` is `{}`, so `StepTaskFn<[], ...>` collapses to the no-deps form.

Each value is `R | undefined`: a dependency's result is only present when that upstream task `SUCCEEDED`. Under a non-`ALL_SUCCESS` trigger rule (`ALL_DONE`, `ANY_FAILED`, `NONE_FAILED`, `ALL_FAILED`, `ANY_SUCCESS`) a task body can run while an upstream dependency `FAILED` or was `SKIPPED`, in which case that dep's value is `undefined` at runtime — the static type reflects that. This matches exactly what `buildDepsMap` in `dag-executor.ts` produces: it reads each inline dep's `TaskExecution` from the results map and stores `exec.status === "SUCCEEDED" ? exec.result : undefined`.

### 2.6 `ConditionalConfig` (runIf)

```ts
export interface ConditionalConfig<TDeps extends readonly AnyTaskHandle[]> {
  /** Synchronous, deterministic predicate over resolved upstream results.
   *  Returns false => task is SKIPPED with skipReason "RUN_IF_PREDICATE". */
  runIf?: (deps: DepsMap<TDeps>) => boolean;
}
```

Synchronous by design (async predicates invite non-deterministic IO on replay). Evaluated **after** the trigger rule passes and **before** the operation runs. A predicate that **throws** aborts the whole DAG with a typed `DagPredicateError` — it is neither a task failure nor a skip (§5.4).

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

Default is `ALL_SUCCESS` (or `DagConfig.defaultTriggerRule`). For a task with **no** upstream deps the rule is evaluated against an empty set — see the empty-upstream row and `triggerRuleEvaluators` in §5.3 (success/done-family rules run; failure-family rules skip).

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

  /** Throws DagExecutionError if any task FAILED (or a FAILED custom completion). */
  throwIfError(): void;
}
```

**`TaskStatus` semantics.** `SUCCEEDED`/`FAILED`/`SKIPPED` are terminal. `STARTED` means a task began executing but the DAG resolved before it finished — this happens **only** under early completion (`completionConfig`) when in-flight tasks are not awaited (§5.7); it mirrors `BatchItemStatus.STARTED` in `src/types/batch.ts`. A task that **never started** (the scheduler stopped starting new tasks before reaching it) is **not** given a status: it is simply **absent** from `results`, so `getStatus` returns `undefined` (§9.6). This matches `CompletionItemStatus.status?: BatchItemStatus | undefined` for a not-yet-started item.

**Completion reason.** `DagCompletionReason` is a **superset of the shared core `CompletionReason`** (`src/types/core.ts`, §7.2), adding exactly one DAG-specific member:

```ts
import { CompletionReason } from "./core"; // the shared 5-member base
//   "ALL_COMPLETED" | "MIN_SUCCESSFUL_REACHED" | "FAILURE_TOLERANCE_EXCEEDED"
// | "CUSTOM_COMPLETION_SUCCEEDED" | "CUSTOM_COMPLETION_FAILED"

export type DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES";
```

The DAG has **no dependency** on the map/parallel `CompletionReason` — both the batch types and the DAG build on the neutral core base. Under the default (no `completionConfig`) the DAG drains the reachable graph, then reports:

- `"ALL_COMPLETED"` — every reachable task succeeded or was skipped, or
- `"COMPLETED_WITH_FAILURES"` — one or more tasks failed.

So `completionReason` distinguishes a clean run from a drained-with-failures run. `throwIfError()` keys off `failureCount` (not the reason), so it throws in the `"COMPLETED_WITH_FAILURES"` case. The other reasons (`MIN_SUCCESSFUL_REACHED` / `FAILURE_TOLERANCE_EXCEEDED` / `CUSTOM_COMPLETION_*`) appear only when a `completionConfig` is supplied. This is a deliberate divergence from `BatchResult`, whose default is fail-fast (`FAILURE_TOLERANCE_EXCEEDED`); the DAG drains and reports `"COMPLETED_WITH_FAILURES"` instead (§5.8).

**Error type.** `error` is typed `DurableOperationError` (the SDK base in `src/errors/durable-error/durable-error.ts`). A task's error is whatever its underlying handler throws: `StepError`, `InvokeError`, `CallbackError`, `ChildContextError`, `WaitForConditionError`, etc. Tasks routed through a child-context wrapper — `runInChildContext`, `map`, `parallel`, and the submitter-based `callback` (§7.3) — surface a `ChildContextError`, consistent with `BatchItem.error`. A **nested `dag` task** wires the pass-through `errorMapper: (e) => e` on its own container (§7.4), so if the nested DAG fails at registration/validation (a `Dag*Error`) or via a deterministic `register` throw, that error is recorded **unwrapped** as the nested-dag task's `error` — not as a `ChildContextError`. A nested DAG whose _tasks_ fail does not throw at all: it resolves with a `DagResult` whose `failureCount > 0` (§5.8).

### 2.9 `DagConfig` / `NestedDagConfig` / DAG completion

```ts
export interface DagConfig {
  maxConcurrency?: number; // default: 40 (DEFAULT_DAG_MAX_CONCURRENCY); must be > 0
  completionConfig?: DagCompletionConfig; // DAG-specific (see below); NOT batch CompletionConfig
  defaultTriggerRule?: TriggerRule; // default "ALL_SUCCESS"
  serdes?: Serdes<DagResult>; // for the DagResult container payload
  nesting?: NestingType; // NestingType.NESTED (default) | FLAT for task child contexts
}

// A nested DAG task's trigger rule is set only via the builder handle
// (`.triggerRule()`, §2.4), uniformly with every other task kind — there is no
// config-level triggerRule. NestedDagConfig therefore adds nothing beyond
// DagConfig in v1; it is kept as a distinct alias for future divergence.
export type NestedDagConfig = DagConfig;
```

**`maxConcurrency` scope.** The bound applies to the **DAG scheduler only — one level, the top-level tasks of this DAG**. It is **not** inherited by a task's own internal fan-out: a `map` or `parallel` task keeps its own default (unlimited) unless separately configured, and a nested `dag` task gets its **own** independent default of 40. An explicit value always wins, including a value above 40. `maxConcurrency <= 0` throws a plain `Error` (§9.4), mirroring the guard shape in `concurrent-execution-handler.ts`. The DAG owns no customer-facing summary generator: the container payload is the self-describing `DagResultEnvelope` (§8), so `DagConfig` has no summary hook.

**DAG-specific completion (`DagCompletionConfig`).** The DAG does **not** reuse `CompletionConfig`/`CompletionStatus` from `src/types/batch.ts` verbatim, because those types are result-blind and skip-blind: `CompletionItemStatus` is `{ index, name?, status? }` where `status` is `BatchItemStatus | undefined` (`SUCCEEDED | FAILED | STARTED`) — it carries **no result payload** (so a predicate cannot short-circuit on a task's _value_, e.g. `verdict === "REJECT"`) and has **no `SKIPPED`** member (so a skipped task cannot be represented distinctly from not-yet-started). The DAG needs both, so it defines its own completion vocabulary that mirrors the batch shape but adds task results and the `SKIPPED` status:

```ts
// Threshold-based completion is reused from batch unchanged (it is result-blind
// by design and needs no results/skip info): min/tolerated counts over terminal
// task states, where SKIPPED counts toward neither success nor failure.
import { ThresholdCompletionConfig, CompletionDecision } from "./batch";

/** Per-task snapshot passed to a DAG custom completion predicate. */
export interface DagCompletionItemStatus<TResult = unknown> {
  name: string;
  /** Full task status including "SKIPPED"; `undefined` if not yet started. */
  status?: TaskStatus;
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
  /** Live view of terminal task snapshots by name — the results map the batch type lacks. */
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

`ThresholdCompletionConfig`, `CompletionDecision`, `completeBatch`, `continueBatch`, `CompletionOutcome`, `NestingType`, `Serdes`, `RetryStrategy` are existing types (reused unchanged). Only the **custom-predicate status shape** is DAG-specific — the decision type and threshold config are reused verbatim.

Mutual exclusivity of the completion union is enforced at the type level (the `never` fields on `DagCustomCompletionConfig`) and by a runtime guard, `validateDagCompletionConfig`, mirroring `validateCompletionConfig` (§7.4, §9.4).

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

Entity IDs are **never parsed** by the runtime. `getStepData(stepId)` (`ExecutionContext.getStepData`) and `src/utils/step-id-utils/step-id-utils.ts::hashId()` MD5-hash the string ID to a 16-char key before any checkpoint lookup/store. The real `hashId` is a **memoized** function with a bounded (`MAX_HASH_CACHE_SIZE = 10_000`) module-global cache that clears-and-rebuilds when full; the snippet below is functionally equivalent (identical output for a given input) but omits the cache:

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

**Injectivity of the ID scheme.** For the checkpoint keying to be sound, the map `(parentPrefix, taskName) → entityId` — and its transitive composition across nesting — must be **injective**: two structurally distinct (scope, name) positions must never produce the same string. The threat is a task name that _embeds the delimiter_ `-DAG_NODE_T_` and thereby collides with a nested path. If names could contain `-` (parent prefix `P`):

- Sibling task named `x-DAG_NODE_T_y` → `P-DAG_NODE_T_x-DAG_NODE_T_y`.
- Nested-dag task `x` (container `P-DAG_NODE_T_x`) with sub-task `y` → `P-DAG_NODE_T_x-DAG_NODE_T_y`.

These would hash to the identical `hashId` key — silent checkpoint aliasing.

**Two enforced charset rules make the delimiter unforgeable** (§6.1, `DagInvalidTaskNameError`):

1. **No `-` in names** — the name charset is `^[a-zA-Z0-9_]+$` (dash excluded). Since the delimiter `-DAG_NODE_T_` _begins with_ `-`, and `-` appears in an entity ID **only** as a structural join (counter joins like `1-2`, and delimiter prefixes), a name can never contain the delimiter's leading `-`. This alone makes `-DAG_NODE_T_` unforgeable and the encoding injective — the collision above cannot even be _expressed_, because `x-DAG_NODE_T_y` is not a legal name. No-dash is the **load-bearing** guarantee in this SDK (JS composes one raw multi-level pre-image and hashes it once at lookup).
2. **No `DAG_NODE_T_` substring in names** — defense-in-depth (and to reserve the token cleanly). The token is long deliberately: entity IDs are **hashed** before storage (§4.1), so the token never appears in persisted data or the console; its only job is to be an internal marker that an ordinary name is astronomically unlikely to contain. Because the ID is hashed to a fixed 16-char key, the token's length has **no** effect on stored size.

Injectivity argument, given rule (1):

1. Every `-` in an entity ID is **structural** — it comes from a counter join (`1-2`) or the leading `-` of a `-DAG_NODE_T_` delimiter. No `-` originates inside a name.
2. Therefore every occurrence of the sequence `-DAG_NODE_T_` in an entity ID is a **real delimiter**: its leading `-` cannot come from a name, and the trailing `DAG_NODE_T_` cannot be forged from the digits-and-`-` counter prefix.
3. Splitting an entity ID on `-DAG_NODE_T_` is thus **unambiguous**: the first segment is the counter prefix and each subsequent segment is exactly one task name (each dash-free). The decomposition into `(prefix, name₁, name₂, …)` is unique, and names are unique within each scope (§10.1) — so the full ID is a bijection with its `(scope-path, name)` position.

This guarantee is **enforced at registration** (not merely asserted), so it cannot be silently violated. Counter-child IDs (`1-2-1`) also remain disjoint from task IDs (`1-2-DAG_NODE_T_…`) — a task ID always contains `DAG_NODE_T_`, a counter ID never does.

**Reserving `-` as structural-only** keeps the ID grammar clean (names occupy the dash-free leaf segments; `-` only ever joins structure) and future-proof: charset restrictions can be **loosened** in a later version without breaking any in-flight execution, but never **tightened**. Developers use `_` or camelCase (`fetch_data`, `ruleA`). Considered and rejected alternatives: allowing `-` and relying solely on the long token (injective, but leaves `-` doing double duty as structural join and name content); escaping names before composition (complicates the round-trip); length-prefixed / per-segment-hashed encoding (fully general but opaque). The chosen scheme — dash-free names + a long reserved token — is trivial to validate, and token length is free because IDs are hashed before storage.

### 4.3 Why name-based (not counter or index)

- **Counter-based** diverges: DAG task _start_ order follows dep _completion_ order, which varies across replays (the core motivation, §1.1).
- **Index-based** (`T0,T1,…` from declaration order) is fragile to reordering/insertion and hostile to future dynamic tasks.
- **Name-based** is stable across reordering, insertion, and (future) dynamic tasks, and is self-describing in **debug logs** (the SDK logs the raw `entityId`, e.g. `1-2-DAG_NODE_T_fetch`). The _persisted_ history identifies a task by its `Name` field (all schemes set `Name` equally); the entity ID itself is hashed before storage (§4.1), so the readability benefit is a debug-log convenience, not a stored-data property.

### 4.4 Replay-correctness argument (grounded)

The scheduler's _traversal order_ may differ run-to-run, but correctness depends only on (a) stable IDs and (b) topological ordering — **not** on traversal order:

1. Each task's ID is a pure function of its name and the DAG context prefix (§4.2) — identical every run.
2. When the scheduler runs task `X`, it invokes `X`'s underlying handler with `createStepId: () => idOf(X)`. If `X` already completed in a prior invocation, `step-handler.ts` hits its **fast path**: `stepData?.Status === SUCCEEDED` ⇒ it `safeDeserialize`s and returns the checkpointed result _without re-executing_ (`FAILED` ⇒ rethrows the checkpointed error). Same fast paths exist in every handler (`run-in-child-context-handler.ts::handleCompletedChildContext`, etc.).
3. `validateReplayConsistency(idOf(X), {type, name, subType}, checkpointData, context)` compares `Type`/`Name`/`SubType` against the checkpoint. Because the same task name always maps to the same operation type/subtype, this passes. It does **not** inspect ID format, so `DAG_NODE_T_`-prefixed IDs are transparent to it.
4. The scheduler rebuilds its in-memory `results` map each run by reading each completed task's result via the fast path. `DepsMap` is therefore reconstructed identically, and topological order guarantees a task's deps are already in `results` before it runs.

Thus the only new requirement over `map`/`parallel` is the ID derivation; everything downstream (checkpoint, retry, serdes, replay validation, termination) is the existing machinery.

---

## 5. Scheduler semantics (`dag-executor.ts`)

`DagExecutor` is a topological scheduler over the registered `TaskDef[]`. It maintains `results: Map<string, TaskExecution>` (in-memory), `inFlight: Set<string>`, a `finished` flag, and the resolve/reject handles of the `run()` promise. `run()` returns immediately with an empty `DagResult` (`totalCount: 0`, `completionReason: "ALL_COMPLETED"`) when there are zero tasks; otherwise it drives the scheduler to completion and builds a `DagResultImpl` from the results map, the final `completionReason`, and `tasks.length` as `totalCount`.

### 5.1 Readiness

A task is **ready** (`isReady`) when every dep (inline + builder — i.e. `allDeps`) is present in `results`, having reached a terminal state (`SUCCEEDED`/`FAILED`/`SKIPPED`). Root tasks (no deps) are ready immediately.

### 5.2 Concurrency

`tryStartNext()` runs a fixpoint loop over the task list, starting ready tasks while `inFlight.size < (config.maxConcurrency ?? DEFAULT_DAG_MAX_CONCURRENCY)` — **40** when unset (§2.9). Because each operation handler kicks off its work **eagerly** when invoked (e.g. `step-handler.ts` builds `phase1Promise` immediately and attaches `.catch(()=>{})`), the scheduler controls concurrency by _deferring the handler call itself_ until the task is both ready and under the concurrency cap. Skips and trigger-rule evaluation are not subject to the cap — only the actual dispatch of a task that must run is.

### 5.3 Trigger-rule evaluation

When a ready task is dequeued, its `triggerRule` (resolved as `task.triggerRule ?? config.defaultTriggerRule ?? "ALL_SUCCESS"`) is evaluated against the **statuses** of its deps (`allDeps`), per this table:

| Upstream states     | ALL_SUCCESS | ALL_FAILED | ALL_DONE |    ANY_SUCCESS     |   ANY_FAILED    |  NONE_FAILED   |
| ------------------- | :---------: | :--------: | :------: | :----------------: | :-------------: | :------------: |
| **Empty (no deps)** |   **Run**   |  **Skip**  | **Run**  |      **Skip**      |    **Skip**     |    **Run**     |
| All succeeded       |     Run     |    Skip    |   Run    |        Run         |      Skip       |      Run       |
| All failed          |    Skip     |    Run     |   Run    |        Skip        |       Run       |      Skip      |
| Mixed succ/fail     |    Skip     |    Skip    |   Run    |        Run         |       Run       |      Skip      |
| Includes SKIPPED    |    Skip     |    Skip    |   Run    | Run if any success | Run if any fail | Run if no fail |

`SKIPPED` counts as "not success" and "not failure". If the rule is **not** satisfied ⇒ record `{status:"SKIPPED", skipReason:"TRIGGER_RULE"}`, do not run, propagate downstream.

**Empty upstream set.** A task with **no** deps evaluates its trigger rule against an empty status array. `triggerRuleEvaluators` (`trigger-rules.ts`) are defined so the empty case is well-typed:

```ts
export const triggerRuleEvaluators: Record<
  TriggerRule,
  (s: TaskStatus[]) => boolean
> = {
  ALL_SUCCESS: (s) => s.every((x) => x === "SUCCEEDED"), // [] => true  => Run
  ALL_FAILED: (s) => s.length > 0 && s.every((x) => x === "FAILED"), // [] => false => Skip
  ALL_DONE: () => true, // [] => true  => Run
  ANY_SUCCESS: (s) => s.some((x) => x === "SUCCEEDED"), // [] => false => Skip
  ANY_FAILED: (s) => s.some((x) => x === "FAILED"), // [] => false => Skip
  NONE_FAILED: (s) => s.every((x) => x !== "FAILED"), // [] => true  => Run
};
```

The explicit `s.length > 0` guard on `ALL_FAILED` prevents a vacuous `every` from running a depless task on `ALL_FAILED` (there is no failure upstream). The failure-family rules (`ALL_FAILED`, `ANY_FAILED`) therefore require at least one actual upstream failure; the success/done-family rules (`ALL_SUCCESS`, `ALL_DONE`, `NONE_FAILED`) are vacuously satisfied, so a root task with the default `ALL_SUCCESS` runs. A non-default trigger rule on a depless task is **allowed** (not a validation error) and follows this table; keeping the default on roots is recommended, since a non-default rule on a root is usually a modeling mistake.

### 5.4 `runIf` evaluation

If the trigger rule passed, the scheduler builds the `DepsMap` from `results` (via `buildDepsMap`, which uses a null-prototype object keyed by task name as defense-in-depth against prototype-pollution names, alongside the registration-time name blocklist) and evaluates `runIf(deps)` synchronously. `false` ⇒ record `{status:"SKIPPED", skipReason:"RUN_IF_PREDICATE"}`, do not run, propagate downstream. `true`/absent ⇒ run.

**A throwing predicate aborts the DAG.** `runIf` is a pure, deterministic predicate, so a throw is a **defect**, not an outcome. The scheduler records **no terminal state** for the offending task, starts no further tasks, and calls `abort(new DagPredicateError(task.name, undefined, cause))` — which rejects the `run()` promise so the `dag()` operation fails and the DAG container checkpoints the failure. It is _not_ recorded as a task `FAILED` and _not_ coerced to `false` ⇒ `SKIPPED`. Recording it as a task failure would silently rewrite the graph's meaning: every downstream `ALL_FAILED` / `ANY_FAILED` / `ALL_DONE` task would fire, so a null-pointer bug in a predicate would issue a refund. Contrast §5.5, where a rejecting task **body** is a normal `FAILED`. The abort propagates immediately with no draining; `finished` is set so any later task settlement is a no-op, but there is no cancellation — work an in-flight task already checkpointed stays checkpointed for a later invocation to replay, it just can no longer override the abort.

Error fidelity across the container boundary is not uniform across SDKs: the typed identity and the task-naming message always survive; in TypeScript the structured task-name field reconstructs as `""` and the cause chain is not preserved (its type + message are baked into the message), because the DAG container's child-context boundary reconstructs the error from serialized type + message (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3). This is the same erasure the whole `Dag*Error` family has.

### 5.5 Running a task

`startTask` marks the task in-flight, records `startedAt`, builds the deps map, and invokes `taskDef.executor(ctx, depsMap)` — which delegates to the operation's explicit-ID handler variant (§7). On resolve ⇒ `onSettled` records `{status:"SUCCEEDED", result, completedAt}`; on reject ⇒ `{status:"FAILED", error, completedAt}` (the error coerced to a `DurableOperationError` via `toDurableError`, wrapping non-`DurableOperationError` throws in a `StepError`). Then `onSettled` clears the in-flight flag, evaluates any `completionConfig`, and re-enters `tryStartNext`.

Tasks are driven on a **detached** promise chain: nothing awaits the promise `.then()` produces. The container body awaits a _different_ chain — the `run()` promise, rejected via `rejectRun` inside `abort()`. A non-root task's `runIf` is evaluated inside the settlement continuation, so a throw there would reject the detached promise, which has no handler, and escape as an unhandled rejection to the Lambda runtime (`Runtime.UnhandledPromiseRejection`) — Lambda would retry the invocation and the container would never be marked failed. Two guards prevent this: the per-call-site `try/catch` around `runIf` converts that known throw into a typed `abort`, and — as the **structural** guarantee — a terminal `.catch` on the dispatch chain funnels any scheduling-time throw into `abort()`, which rejects the `run()` promise the container body awaits, so the container is deterministically failed instead of the error escaping. This is scoped to the scheduler's own promise; it is **not** a process-global `unhandledRejection` handler.

### 5.6 Skip propagation

Skipping a task is a terminal transition, so its downstream becomes eligible and evaluates _its own_ trigger rule against the skip (§5.3). Skips cascade naturally: an `ALL_SUCCESS` chain downstream of a skip will itself skip; an `ALL_DONE` sink still runs.

### 5.7 `completionConfig` interaction

Uses `DagCompletionConfig` (`ThresholdCompletionConfig | DagCustomCompletionConfig`, §2.9) — **not** the batch `CompletionConfig`. After each task settles, `evaluateCompletion` maps DAG progress into a **`DagCompletionStatus`** (via `buildCompletionStatus`) and applies the policy:

- Counts (`successCount`/`failureCount`/`skippedCount`) are over terminal task states; `completedCount = successCount + failureCount + skippedCount` (SKIPPED counts toward `completedCount`, but toward neither success nor failure). `totalCount` = number of registered tasks.
- `items: DagCompletionItemStatus[]` = one entry per task **ordered by registration order**, `{ name, status, result?, skipReason? }`. A skipped task appears explicitly as `status: "SKIPPED"` with its `skipReason`; a not-yet-started task is `status: undefined`. Each `SUCCEEDED` item carries its `result`, and `results` is a `ReadonlyMap<string, DagCompletionItemStatus>` of terminal tasks by name — the results view the batch `CompletionStatus` lacks, and what makes result-based short-circuit (§13.4) implementable.
- **Threshold path**: `toleratedFailureCount`/`toleratedFailurePercentage` exceeded ⇒ finish with reason `FAILURE_TOLERANCE_EXCEEDED`; `minSuccessful` reached ⇒ reason `MIN_SUCCESSFUL_REACHED`. (Threshold config is the batch `ThresholdCompletionConfig`, reused unchanged; it ignores results by design.)
- **Custom path**: `shouldComplete(status)` returning `completeBatch(outcome)` ⇒ finish; reason `CUSTOM_COMPLETION_FAILED` when `outcome === CompletionOutcome.FAILED`, else `CUSTOM_COMPLETION_SUCCEEDED`. The predicate may inspect `status.results`/`items[].result` for value-based completion.

When early completion fires (`finish(reason)`), **in-flight tasks are not cancelled** — the execution model has no cancellation. Any still-running task is recorded `STARTED` in `results`, and its checkpoint is dropped via the existing `checkpoint.markAncestorFinished`/`hasFinishedAncestor` mechanism (the DAG child context is marked finished, so descendant checkpoints are ignored). This mirrors `minSuccessful` behavior in `map`/`parallel`. Tasks the scheduler never started are absent (`getStatus` ⇒ `undefined`, §9.6).

### 5.8 Failure semantics of the DAG promise

A **failed task is a normal terminal state**, not an abort signal. This is the pivot that makes trigger rules work: compensation/fallback tasks (`ALL_FAILED`, `ALL_DONE`, `ANY_FAILED`, `NONE_FAILED`) downstream of a failure must still be scheduled and evaluated.

- **No `completionConfig` (default)**: the scheduler **drains the reachable graph** — `tryStartNext` keeps starting ready tasks until no task is startable, letting downstream trigger rules react to each failure. When the graph drains (`checkDone` observes `inFlight.size === 0`), `finish` records `completionReason` as `"ALL_COMPLETED"` if `failureCount === 0`, else `"COMPLETED_WITH_FAILURES"` — so the reason itself distinguishes a clean run from a drained-with-failures run. **The `dag()` promise itself does not reject** — it resolves with a `DagResult`; callers opt into throwing via `result.throwIfError()`. This mirrors `BatchResult` (a failed batch still resolves; `throwIfError()` throws).

  This is a **deliberate divergence from `ConcurrentExecutionController`**, whose default (no `completionConfig`) is **fail-fast**: `executeItemsConcurrently.shouldContinue()` returns `failureCount === 0`, so it stops starting new items after the first failure and reports `"FAILURE_TOLERANCE_EXCEEDED"`. The DAG does not adopt this default, because fail-fast would prevent compensation tasks (the whole point of `ALL_FAILED`/`ALL_DONE` trigger rules, §13.2) from ever running. The DAG's own scheduler treats a failure as a terminal task state and continues; a customer who _wants_ batch-style fail-fast opts in with `completionConfig`. Because the DAG scheduler is a **separate** component from `ConcurrencyController`, this divergence is a local design choice, not a change to any shared code.

- **With `completionConfig`**: the thresholds/predicate apply and can stop the graph early (§5.7); `completionReason` is one of `FAILURE_TOLERANCE_EXCEEDED` / `MIN_SUCCESSFUL_REACHED` / `CUSTOM_COMPLETION_SUCCEEDED` / `CUSTOM_COMPLETION_FAILED`. In-flight tasks are not cancelled (§5.7); not-yet-started tasks are left absent from `results` (§9.6).

- **`DagResult.throwIfError()`** throws `DagExecutionError` (wrapping the first failed task's `error` as `cause`) when `failureCount > 0` **or** `completionReason === "CUSTOM_COMPLETION_FAILED"`. Under the default (no `completionConfig`) a graph with failures reports `completionReason === "COMPLETED_WITH_FAILURES"`, but `throwIfError` keys off `failureCount`, so its behavior is unchanged either way.

### 5.9 Empty DAG

Zero registered tasks ⇒ `run()` resolves immediately with an empty `DagResult` (`totalCount: 0`, `completionReason: "ALL_COMPLETED"`).

### 5.10 Error types

DAG errors extend `DurableOperationError` and are declared in `durable-error.ts` (co-located with the other registered error subclasses so `DurableOperationError.fromErrorObject` can reconstruct them without a circular import); `src/errors/dag-errors/dag-errors.ts` re-exports them as the canonical DAG error surface:

- `DagCyclicDependencyError` — cycle detected at registration; lists the cyclic task names.
- `DagInvalidTaskNameError` — bad task name at registration.
- `DagDuplicateTaskError` — duplicate name at registration.
- `DagInvalidDependencyError` — dep handle not registered in this DAG's scope.
- `DagPredicateError` — a `runIf` predicate threw at scheduling time (§5.4); carries the offending task name and the original error as its cause. Raised **during** execution and aborts the DAG.
- `DagExecutionError` (`errorType = "DagExecutionError"`) — thrown by `throwIfError()`; carries the first failed task's error as `cause`.

Registration/validation errors (§6) are **registration-time** and deterministic (the same graph is registered every replay, per §10.2), so they reproduce identically on replay. They are surfaced by **throwing** the corresponding `Dag*Error` from within the DAG child-context body, and the `dag()` promise **rejects with the raw `Dag*Error` unwrapped**. This unwrapping is **not automatic**: `executeChildContext`/`handleCompletedChildContext` (in `run-in-child-context-handler.ts`) rewrap a thrown error as `new ChildContextError(msg, cause)` _unless an `errorMapper` is supplied_. §7.4 wires `errorMapper: (e) => e` (pass-through) into the container's options, which is what makes the raw `Dag*Error` reach the caller. This is deliberate: graph-shape errors are customer programming errors raised from customer-visible registration calls, so a catchable throw is the right ergonomics — analogous to the plain-`Error` throws the batch handler uses for "requires an array of items" / invalid `maxConcurrency`. The mutually-exclusive-`completionConfig` case instead follows the `terminationManager.terminate` path (matching `validateCompletionConfig`). See §7.4 and §9.4.

**Register-callback throws (arbitrary customer errors).** The `register` callback runs first inside the DAG child-context body (§7.4), _before_ validation and _before_ any task executes. If `register` throws a **non-`Dag*Error`** (any arbitrary customer `Error` — a bug in the registration logic, or a thrown value from an `await`ed expression in an async `register`), that error is **not caught** by the DAG machinery: it propagates out of the `runInChildContext` body and **rejects the `dag()` promise before any task runs**. No tasks are scheduled, no task IDs are minted, and the container node fails as a whole. Because §7.4 supplies the pass-through `errorMapper: (e) => e`, the thrown error surfaces **unwrapped** (as the raw customer `Error`), consistent with how the `Dag*Error`s surface. Replay behavior follows determinism (§10.2): a **deterministic** throw reproduces identically on every replay, so the DAG deterministically fails the same way; a **non-deterministic** throw (e.g. based on `Date.now()` or a network read done directly in `register`) is a §10.2 determinism violation and surfaces as a `NonDeterministicExecutionError` on the first task whose replayed operation shape diverges, or as an inconsistent container outcome across invocations. `register` must be kept deterministic (§10.2); any non-deterministic work belongs inside a task.

---

## 6. Validation (`dag-validator.ts`)

Two guards run eagerly during registration (`validateTaskName` and duplicate detection, inside each `DagContext` method); the remaining structural checks run once in `validateDag`, **after** `register` returns and **before** the executor starts.

### 6.1 Task name rules (`DagInvalidTaskNameError`)

`validateTaskName` rejects a name that is not a non-empty string, exceeds 100 chars, fails the pattern `^[a-zA-Z0-9_]+$`, contains the reserved substring `DAG_NODE_T_`, or is one of the prototype-pollution reserved names:

- **Charset `^[a-zA-Z0-9_]+$`** — alphanumerics and underscore only. **`-` (dash) is not allowed**: it is reserved as a structural-only character in entity IDs (counter joins and the `-DAG_NODE_T_` delimiter). Use `_` or camelCase instead. Rationale and injectivity in §4.2.
- **No `DAG_NODE_T_` substring** (case-sensitive) — defense-in-depth for delimiter injectivity (§4.2; the no-dash rule already suffices, but the token is reserved cleanly). The token is deliberately long so it (almost) never collides with a real name: `myTask`, `a_b`, `T_shirt`, `GET_T_oken`, `count_T` are all accepted. Rejected: any name containing a dash (`fetch-data`, `rule-a`, `T-1`) → dash rule; embedding the token (`DAG_NODE_T_root`, `myDAG_NODE_T_x`) → token rule.
- **No prototype-pollution names** — `__proto__`, `constructor`, `prototype` are rejected. All three match `^[a-zA-Z0-9_]+$`, so the charset check alone would let them through; as customer-chosen task names they would key plain objects downstream (e.g. the per-task deps map), where assigning `map["__proto__"] = value` hits the prototype setter instead of creating an own property. This mirrors the `DANGEROUS_KEYS` guard in `utils/serdes/preview.ts`; the scheduler's null-prototype deps map (§5.4) is the paired defense-in-depth.

Validated eagerly in each `DagContext` method as the task is registered (fail fast, before graph assembly), and re-checked in `validateDag`.

### 6.2 Duplicates (`DagDuplicateTaskError`)

Each `DagContext` method inserts into a `Map<string, TaskDef>` keyed by name; a second registration under the same name (regardless of operation kind) throws immediately. `validateDag` re-checks with a `Set`.

### 6.3 Missing dependencies (`DagInvalidDependencyError`)

Every dep `TaskHandle` in `allDeps` (inline or builder) must have its `_id` present in the registry's id set. A handle from a different (e.g. parent) DAG scope fails this check — enforcing scope isolation (§10.1).

### 6.4 Cycle detection (`DagCyclicDependencyError`)

Kahn's algorithm over `allDeps` (inline ∪ builder edges), `O(V+E)`, once:

```ts
export function detectCycle(tasks: TaskDef[]): string[] | null {
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
  dag-handler.ts        # createDagHandler: config guards + child-context wrapper; replay-mode branch
  dag-context.ts        # DagContextImpl: registers TaskDefs, returns TaskHandles
  task-handle.ts        # TaskDef, TaskKind, TaskHandleImpl (reference + builder)
  dag-executor.ts       # DagExecutor (topological scheduler); DEFAULT_DAG_MAX_CONCURRENCY; reconstructDagResult
  dag-validator.ts      # validateTaskName / detectCycle / validateDag
  dag-result.ts         # DagResultImpl, createDagResultSerdes, restoreDagResult,
                        #   buildDagOffloadPayload, readDagEnvelope
  trigger-rules.ts      # triggerRuleEvaluators: Record<TriggerRule, (statuses)=>boolean>
src/types/dag.ts        # public types (§2) + wire types (DagResultEnvelope, SerializedDagTask)
src/errors/dag-errors/dag-errors.ts   # re-export of the Dag*Error classes (declared in durable-error.ts)
```

### 7.2 Changes to existing files

- `src/types/durable-context.ts` — add the `dag(...)` method to `DurableContext<TLogger>` (§2.1).
- `src/context/durable-context/durable-context.ts` — implement `dag()` and add the internal explicit-ID variants + `createTaskId` (§7.3).
- `src/types/index.ts`, `src/index.ts` — re-export the new public types/errors.
- `src/types/durable-execution.ts` (`OperationSubType`) — add `DAG = "Dag"` for the DAG container subtype. Task subtypes stay native (`STEP`, `CHAINED_INVOKE`, `RUN_IN_CHILD_CONTEXT`, `MAP`, `PARALLEL`, …).
- `src/errors/durable-error/durable-error.ts` — declare the `Dag*Error` classes and register `"DagExecutionError"` in `DurableOperationError.fromErrorObject` so a nested-DAG failure reconstructs correctly across `runInChildContext` boundaries. Its `CompletionReason` import comes `from "../../types/core"` (the core extraction below).
- **`src/types/core.ts`** — hosts the shared base `CompletionReason` (the 5 members) as the neutral vocabulary that BOTH map/parallel and DAG build on, so the DAG does not depend on the batch type. `Duration` and `ExecutionContext` also live here.
- `src/types/batch.ts` — imports `CompletionReason` from `./core` for its own use (e.g. `BatchResult.completionReason`, `BatchResultImpl`) and does **not** re-declare or re-export it (the `src/types/index.ts` barrel surfaces it via `export * from "./core"`, which precedes `export * from "./batch"`; re-exporting from both would be a duplicate-export error). Map/parallel semantics are unchanged — `BatchResult.completionReason` stays exactly the 5-member core type.

**No changes** to `step-handler.ts`, `invoke-handler.ts`, `callback.ts`, `wait-handler.ts`, `wait-for-condition-handler.ts`, `run-in-child-context-handler.ts`, or `concurrent-execution-handler.ts`.

> **Completion-reason layering (no DAG → batch dependency).**
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

The DAG runs each task under a **name-based** entity ID (`DAG_NODE_T_{name}`, §4.2) instead of the per-context monotonic counter. Two facts from the code govern how, and they split the handlers into **two families**.

**Family A — handlers that take `createStepId: () => string` directly.** `createStepHandler`, `createInvokeHandler`, `createWaitHandler`, `createWaitForConditionHandler`, `createRunInChildContextHandler`, and the low-level `createCallback` factory all accept a `createStepId` injection point. For these, the explicit-ID variant is the existing public-method body with `this.createStepId.bind(this)` replaced by `() => this.createTaskId(name)`.

**Sub-split of Family A by `checkAndUpdateReplayMode`.** Taking `createStepId` is _not_ the same as taking a `checkAndUpdateReplayMode?: () => void` callback. Only three Family A handlers additionally accept one:

- `createInvokeHandler` — `checkAndUpdateReplayMode` is the 5th positional parameter.
- `createWaitHandler` — 5th positional.
- the low-level `createCallback` factory — 4th positional.

The remaining Family A handlers take **no** `checkAndUpdateReplayMode` parameter and must not be passed one:

- `createStepHandler` — 4th positional is `createStepId`, **5th is `logger`**.
- `createWaitForConditionHandler` — **4th positional is `logger`**.
- `createRunInChildContextHandler` — takes `getParentLogger`/`createChildContext`, no mode callback.

Injecting a `() => {}` no-op into a `logger`/factory slot would corrupt that argument (a positional-argument bug), not disable mode management — so the sub-split is authoritative for §7.3.1 and §7.3.2.

**Family B — `waitForCallback`, which does not take `createStepId`.** `createWaitForCallbackHandler(context, peekStepId, runInChildContext, getDefaultCallbackDeserializer?)` is built **on top of** `runInChildContext` (it wraps the submitter in a child context) and consults `peekStepId` for mode decisions — it never mints an ID via `createStepId`. Therefore the DAG `callback` task (submitter-based) **cannot** be handled by swapping `createStepId`. It is instead run **inside** `runInChildContextWithExplicitId(name, …)`: the `DAG_NODE_T_{name}` ID is the wrapping child context, and `waitForCallback`'s own internal child uses a counter ID _within that container's context_ (`DAG_NODE_T_{name}-1`) in deterministic order — replay-safe exactly like `map`/`parallel`/nested `dag`. The low-level `createCallback` factory (which _does_ take `createStepId`) has no corresponding `DagContext` method, so no `createCallback` explicit-ID variant is built in v1; it is listed above only to document why `callback` is not a plain Family-A swap.

The resulting on-the-wire shape for a `callback` task is a two-level context (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5): a container with SubType `Callback` carrying the task's name-based ID, whose body runs the native `WaitForCallback` operation (which in turn emits `CallbackStarted` and the submitter `Step`). A standalone wait-for-callback emits only the `WaitForCallback` level; the outer `Callback` container is DAG-specific and exists to carry the name-based task ID.

#### 7.3.1 Why explicit-ID variants bypass `withDurableModeManagement`

Every public `DurableContext` method wraps its body in `this.withDurableModeManagement(() => …)`. **But `withDurableModeManagement` is coupled to the monotonic counter**: it calls `captureExecutionState()`, `checkAndUpdateReplayMode()`, and `checkForNonResolvingPromise()`, and all three consult `peekStepId()`:

```ts
private peekStepId(): string {
  const nextCounter = this._stepCounter + 1;       // COUNTER-based
  return this._stepPrefix ? `${this._stepPrefix}-${nextCounter}` : `${nextCounter}`;
}
```

A DAG task checkpoints under `…-DAG_NODE_T_{name}`, **never** under `…-{counter}`. If an explicit-ID variant were wrapped in `withDurableModeManagement`, the mode machinery would `peekStepId()` → a counter ID like `1-2-1` that has **no** checkpoint data, and would then wrongly flip the context mode to `ExecutionMode` (in `checkAndUpdateReplayMode`) or mis-handle `ReplaySucceededContext` (in `checkForNonResolvingPromise`). Reusing `withDurableModeManagement` for name-keyed tasks is therefore incorrect.

**Resolution:** the explicit-ID variants **do not** call `withDurableModeManagement`, and pass a **no-op `checkAndUpdateReplayMode` (`() => {}`)** to the handlers that accept such a parameter (per the sub-split): `createInvokeHandler` (5th positional) and `createWaitHandler` (5th positional). `createStepHandler`, `createWaitForConditionHandler`, and `createRunInChildContextHandler` take no such parameter and their variants simply omit it, swapping only `createStepId`. Task-level replay correctness is provided **entirely by counter-independent machinery**:

1. **Handler fast paths keyed on the explicit ID.** e.g. `step-handler.ts` checks `context.getStepData(stepId)` and returns/rethrows when `stepData?.Status === SUCCEEDED`/`FAILED` — keyed on `stepId = createStepId()` (the `DAG_NODE_T_{name}` string), not on the counter. Every handler has the equivalent fast path.
2. **`validateReplayConsistency(stepId, …)`** is keyed on the explicit `stepId` and inspects only `Type`/`Name`/`SubType` — it never reads the counter or `peekStepId`.

Neither touches `_stepCounter` or `peekStepId`, so name-based IDs are transparent to them. The **context-level** replay decision (run the executor vs. reconstruct the checkpointed `DagResult`) is made **once, at the DAG container boundary** by the parent's `runInChildContext` wrapper (which _does_ use counter-based mode management correctly, because the container node _is_ a counter slot in the parent) — see §7.7. Within the DAG body the counter is never advanced (the body contains only `register()` and explicit-ID task calls), so leaving it untouched cannot desynchronize anything. The worst-case effect of the no-op is cosmetic (a task's first-run logs may be treated as replay logs); it cannot affect checkpoint reads/writes, which are driven solely by explicit-ID `getStepData`. Nested `map`/`parallel`/`dag`/`callback` tasks are unaffected because they run through `runInChildContextWithExplicitId`, and each such child context computes its **own** mode via `determineChildReplayMode` in `run-in-child-context-handler.ts`.

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
//   `logger`, so the variant ONLY swaps createStepId (identical shape to runStepWithExplicitId); do NOT pass a no-op.

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
 * Batch variant. Does NOT reuse `_executeConcurrently`. Two concrete changes from the
 * standalone path:
 *   1. NO `withDurableModeManagement` wrapper (§7.3.1 — mode mgmt is counter-coupled).
 *   2. The CONTAINER's `runInChildContext` binding injected into
 *      `createConcurrentExecutionHandler` is the EXPLICIT-ID variant, so the batch
 *      container node gets `DAG_NODE_T_{name}` instead of a counter ID `P-{n}`.
 * The per-item children are created INTERNALLY by the handler via
 * `parentContext.runInChildContext(...)` (the container child context's OWN counter-based
 * binding) => `DAG_NODE_T_{name}-1`, `DAG_NODE_T_{name}-2`, … in deterministic array order.
 */
private _executeConcurrentlyWithExplicitId<TItem, TResult>(...args): DurablePromise<BatchResult<TResult>> {
  const handler = createConcurrentExecutionHandler(
    this._executionContext,
    this.runInChildContextWithExplicitId.bind(this),  // <-- CONTAINER binding = explicit-ID
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
  // Nested DAG: the nested container must get DAG_NODE_T_{name}, so createDagHandler is
  // wired with the EXPLICIT-ID child-context binding for ITS container.
  return createDagHandler(
    this.runInChildContextWithExplicitId.bind(this),   // <-- nested container gets DAG_NODE_T_{name}
    this._executionContext,                            // for the pre-body config guards (§7.4)
  )(name, register, config);
}
```

**How the batch/nested-dag container IDs are wired.** The standalone `_executeConcurrently` does two things that make it unusable as-is for a DAG task: it wraps in `this.withDurableModeManagement(...)` (counter-coupled, wrong for name-keyed tasks), and it injects `this.runInChildContext.bind(this)` (counter-based) as the **container's** `runInChildContext`, so the batch container node would get a _counter_ ID `P-{n}` — precisely the non-determinism DAG exists to prevent. The fix is a **two-level binding**:

- **Container level** — the `runInChildContext` argument passed into `createConcurrentExecutionHandler`/`createDagHandler` is the **explicit-ID** variant, so the container gets `DAG_NODE_T_{name}`.
- **Per-item level** — _unchanged_. `createConcurrentExecutionHandler` internally calls `parentContext.runInChildContext(...)` where `parentContext` is the container's own child context, yielding `DAG_NODE_T_{name}-1`, `DAG_NODE_T_{name}-2`, … in deterministic array order — replay-safe exactly as `map`/`parallel` are today.

So `concurrent-execution-handler.ts` needs **no change**; the only new code is the thin `_executeConcurrentlyWithExplicitId`/`runMapWithExplicitId`/`runParallelWithExplicitId`/`runDagWithExplicitId` wrappers that (1) skip `withDurableModeManagement` and (2) supply the explicit-ID container binding. These variants are `@internal`, not on the public `DurableContext` interface — the public surface gains only `dag()` (§2.1).

### 7.4 `createDagHandler` (high-level flow)

`createDagHandler` takes the container's `runInChildContext` binding and the `ExecutionContext`, and returns the `(name, register, config)` operation. It runs two pure config guards **before** entering the child context, then registers, validates, and either runs the scheduler or reconstructs the result:

```ts
export const createDagHandler =
  <Logger extends DurableLogger>(
    runInChildContext: DurableContext<Logger>["runInChildContext"], // explicit-ID binding for nested dags; else this.runInChildContext for top-level
    executionContext: ExecutionContext,
  ) =>
  (name, register, config?): DurablePromise<DagResult> =>
    new DurablePromise<DagResult>(async () => {
      // ── Config guards (pure functions of `config`) run BEFORE the child context.
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
      //    never-resolving promise. DAG-local copy of validateCompletionConfig. §9.4
      if (
        !validateDagCompletionConfig(
          config?.completionConfig,
          executionContext.terminationManager,
        )
      ) {
        return new Promise<DagResult>(() => {});
      }

      const childOptions: ChildConfig<DagResult> = {
        subType: OperationSubType.DAG,
        serdes: config?.serdes ?? createDagResultSerdes(),
        // Large-payload offload seam (SDK-internal ChildConfig hook): executeChildContext
        // checkpoints exactly the string this returns on the large-payload path, so it must
        // be the FULL DagResultEnvelope with `tasks` dropped (the offload signal). There is
        // NO customer summary generator — the whole envelope is self-describing. §8.
        summaryGenerator: (result: DagResult) => buildDagOffloadPayload(result),
        // errorMapper PASS-THROUGH: without it, executeChildContext/handleCompletedChildContext
        // rewrap any thrown error as new ChildContextError(...). The pass-through makes
        // graph-shape Dag*Errors (and deterministic register throws) surface UNWRAPPED. §5.10
        errorMapper: (e) => e,
      };

      return runInChildContext(
        name,
        async (parentCtx): Promise<DagResult> => {
          const dagCtx = new DagContextImpl<Logger>(config);
          await register(dagCtx); // registration phase (may be async)
          const tasks = dagCtx.getTasks();
          validateDag(tasks); // §6 — throws Dag*Error inside this body

          // Replay-mode branch (reconstruct, don't re-schedule). The child context carries the
          // mode set by determineChildReplayMode. In the large-payload completed-replay mode
          // (ReplaySucceededContext) reconstruct from the offloaded envelope + per-task checkpoints.
          const modeHost = parentCtx as unknown as {
            durableExecutionMode: DurableExecutionMode;
            _stepPrefix?: string;
          };
          if (
            modeHost.durableExecutionMode ===
            DurableExecutionMode.ReplaySucceededContext
          ) {
            const envelope = readDagEnvelope(
              executionContext,
              modeHost._stepPrefix,
            ); // validates; null if missing/malformed
            return reconstructDagResult(
              executorCtx,
              tasks,
              envelope,
              executionContext,
            );
          }

          // Normal execution / ordinary replay: run the scheduler. Completed tasks hit their
          // name-based checkpoint fast paths; skips are recomputed deterministically.
          return new DagExecutor(executorCtx, tasks, config).run();
        },
        childOptions,
      );
    });
```

Note there is **only one** offload/envelope seam: the child context's SDK-internal large-payload hook is wired to `buildDagOffloadPayload`, which returns the same `DagResultEnvelope` the inline serdes emits, only with `tasks` dropped. There is no customer-facing generator and nothing customer-supplied is ever written into the payload the SDK parses back on replay (§8).

**Guard ordering.** The two config guards run **first**, before the child context is entered and before `register`, because they are pure functions of `config`. `validateDagCompletionConfig` is the DAG's own copy of `validateCompletionConfig` (the DAG does not route through `concurrent-execution-handler.ts`); it terminates with `TerminationReason.CONFIG_VALIDATION_ERROR` and the handler returns a never-resolving promise so nothing else runs. Graph-shape validation (`validateDag`, §6) runs **after** `register` (it needs the assembled task set) and **inside** the child-context body.

**Replay-mode branch (reconstruct, don't re-schedule).** The DAG body reads `parentCtx.durableExecutionMode` (set by `determineChildReplayMode` in `runInChildContext`), mirroring the batch handler's `executeOperation`→`replayItems` split. In `ReplaySucceededContext` — the large-payload completed-replay mode — it calls `reconstructDagResult` (which re-runs only the deterministic `register` graph + skip/trigger recomputation, reads per-task results from checkpoints, and takes `totalCount`/counts/`completionReason`/`startedTaskNames` from the offloaded `DagResultEnvelope`) instead of running `DagExecutor`. In every other mode the scheduler runs normally. A `null`/malformed envelope ⇒ `reconstructDagResult` derives from checkpoints with an empty STARTED set (never hangs, §8).

**errorMapper pass-through.** Because the DAG body runs inside `runInChildContext`, and `executeChildContext`'s catch rewraps _any_ thrown error as `new ChildContextError(message, cause)` unless an `errorMapper` is supplied, §7.4 supplies `errorMapper: (e) => e`. This lets a thrown `DagCyclicDependencyError`/`DagDuplicateTaskError`/`DagInvalidTaskNameError`/`DagInvalidDependencyError` reach the caller **unwrapped** (as §5.10 requires), and makes a deterministic arbitrary `register` throw surface as its raw error. For a **nested `dag` task**, the same pass-through applies at that nested container, so a nested DAG's validation error surfaces to the parent DAG's executor as the raw `Dag*Error`, recorded in the parent's `TaskExecution.error` (the one exception to the §2.8 "child-context-wrapped tasks surface `ChildContextError`" note).

`context.dag()` on `DurableContextImpl` wires `createDagHandler` with `this.runInChildContext.bind(this)` (the top-level DAG container is a real counter slot in the parent). A **nested** `dag` task instead wires it with `this.runInChildContextWithExplicitId.bind(this)` so the nested container gets `DAG_NODE_T_{name}` (§7.3.2 `runDagWithExplicitId`).

### 7.5 `DagContextImpl` (registration)

Each method: validate name (§6.1) → assert-not-duplicate (§6.2) → build a `TaskDef` → store → return `new TaskHandleImpl(name, id, def)`. Registration applies `DagConfig.defaultTriggerRule` to a task whose `triggerRule` is unset, and `DagConfig.nesting` to `map`/`parallel` task configs that do not declare their own `nesting`. The `executor` closure binds the operation kind and applies the **deps-first argument rule** (§2.3), extracting `runIf` out of the config first (`extractConditional`) so it is stored on the `TaskDef`, not passed to the handler.

**`TaskDef` carries two distinct dep sets.** The inline `deps` array (typed, in `DepsMap`) and the builder `.after(...)` edges (ordering-only, **not** in `DepsMap`) have different consumers, so `TaskDef` stores them separately:

```ts
export interface TaskDef {
  name: string;
  id: symbol; // in-memory identity shared with the returned TaskHandleImpl
  kind: TaskKind; // "step" | "invoke" | "callback" | "wait" | "waitForCondition"
  //             | "runInChildContext" | "map" | "parallel" | "dag"
  /** Inline deps only (from the `deps` argument). Drives DepsMap construction. */
  inlineDeps: readonly AnyTaskHandle[];
  /** inlineDeps ∪ builder .after(...) edges, de-duplicated. Drives scheduling,
   *  readiness, trigger-rule evaluation, cycle detection, and missing-dep checks. */
  allDeps: AnyTaskHandle[];
  triggerRule?: TriggerRule;
  runIf?: (deps: Record<string, unknown>) => boolean;
  options?: unknown;
  /** Runs the underlying operation via an explicit-ID variant. */
  executor: (
    ctx: DurableContextImpl<DurableLogger>,
    depsMap: Record<string, unknown>,
  ) => Promise<unknown>;
  /** For a nested `dag` task ONLY: the register callback + config, retained so the
   *  offloaded-replay reconstruct path can re-run the inner register to recover the inner
   *  graph and recurse into the inner container's own child checkpoints (§8, §9.1). */
  nestedDagRegister?: (
    dagCtx: DagContext<DurableLogger>,
  ) => void | Promise<void>;
  nestedDagConfig?: NestedDagConfig;
}
```

Which surface consumes which set:

| Consumer                                                    | Uses         | Section    |
| ----------------------------------------------------------- | ------------ | ---------- |
| `DepsMap` construction (typed result access in the fn body) | `inlineDeps` | §2.5, §7.6 |
| Readiness (`isReady`)                                       | `allDeps`    | §5.1       |
| Trigger-rule status set                                     | `allDeps`    | §5.3       |
| Missing-dep validation                                      | `allDeps`    | §6.3       |
| Cycle detection (`detectCycle`)                             | `allDeps`    | §6.4       |

`.after(...)` on the builder appends to `allDeps` only (de-duplicated by `_id`); the inline `deps` argument populates **both** `inlineDeps` and `allDeps`. This prevents builder deps from leaking into the typed `DepsMap` (the scheduler's `buildDepsMap` iterates `inlineDeps`, not the union) while still letting them gate scheduling/trigger/cycle.

The `executor` closure (deps-first rule, §2.3) — step shown, others analogous:

```ts
const def = this.makeDef(name, "step", deps, runIf, rest, (ctx, depsMap) =>
  ctx.runStepWithExplicitId(
    name,
    deps.length === 0
      ? (stepCtx) => (fn as StepFn<[]>)(stepCtx) // native (ctx)
      : (stepCtx) => (fn as any)(depsMap, stepCtx), // (deps, ctx)
    rest as StepConfig<TResult> | undefined,
  ),
);
```

- `invoke`: resolve `payload = await payloadFn(depsMap)` (or `payloadFn()` when no deps) first, then `runInvokeWithExplicitId(name, funcId, payload, options)`.
- `callback`: `runCallbackTaskWithExplicitId(name, wrappedSubmitter, options)` where `wrappedSubmitter` is `(callbackId, cbCtx) => submitter(depsMap, callbackId, cbCtx)` for non-empty deps, else the native `(callbackId, cbCtx) => submitter(callbackId, cbCtx)` (Family B).
- `waitForCondition`: `runWaitForConditionWithExplicitId(name, (state, wcCtx) => check(depsMap, state, wcCtx), config)` — deps prepended.
- `runInChildContext`: `runInChildContextWithExplicitId(name, (childCtx) => fn(depsMap, childCtx), options)` — deps prepended.
- `wait`: `runWaitWithExplicitId(name, duration)` — no deps-position callback.
- `map`/`parallel`/nested `dag`: resolve any deps-derived inputs (e.g. `items(depsMap)`) first, then delegate to the corresponding explicit-ID child-context variant. The nested `dag` task additionally retains `nestedDagRegister`/`nestedDagConfig` on its `TaskDef` for the offloaded-reconstruct path.

`runIf` and `triggerRule` are stored on the `TaskDef` (evaluated by the scheduler, §5.3–§5.4), not passed to the handler.

### 7.6 In-memory deps flow (concrete `s1 → s2`)

```ts
const s1 = dagCtx.step("s1", [], async () => fetchData());
const s2 = dagCtx.step("s2", [s1], async (deps) => process(deps.s1));
```

1. Registration stores `s1`,`s2` `TaskDef`s; executors not called.
2. `s1` ready ⇒ scheduler calls `s1.executor(ctx, {})` ⇒ `runStepWithExplicitId("s1", () => fetchData())` ⇒ handler checkpoints at `…-DAG_NODE_T_s1`, returns result.
3. Scheduler stores `results.set("s1", {status:"SUCCEEDED", result})`.
4. `s2` ready ⇒ `depsMap = { s1: <result> }` (from `results`) ⇒ `s2.executor(ctx, {s1})` ⇒ `runStepWithExplicitId("s2", () => fn({s1}))` ⇒ checkpoints at `…-DAG_NODE_T_s2`.

The handlers never see `deps`; the DAG resolves them purely in memory.

### 7.7 Checkpoint / replay flow

- **First run**: each executed task checkpoints under its `DAG_NODE_T_{name}` ID via its handler; the DAG container checkpoints as a `CONTEXT` node with SubType `DAG` whose payload is the serialized `DagResultEnvelope` (§8).
- **Interrupted mid-DAG**: on resume the container is not `SUCCEEDED`, so `executeChildContext` re-enters and the executor re-runs. Ready tasks that already completed hit their handler fast paths (return cached result / rethrow cached error) without re-executing; not-yet-run tasks execute for the first time. Skip decisions are recomputed deterministically from the rebuilt `results` map.
- **Completed DAG, inline payload**: the container is `SUCCEEDED` and its payload carries the full `tasks` array ⇒ `handleCompletedChildContext` returns the deserialized `DagResult` (via `createDagResultSerdes`) **without** re-running the executor.
- **Completed DAG, large payload (offloaded)**: the container is `SUCCEEDED` but its payload is the `tasks`-less `DagResultEnvelope` (§8), so the mode is `ReplaySucceededContext` and the body calls `reconstructDagResult`: the aggregate is rebuilt from **(a)** the SDK-owned envelope fields — `totalCount`, the counts, `completionReason`, and `startedTaskNames` (the STARTED-at-early-completion set, which cannot be re-derived because those checkpoints were dropped, §5.7) — and **(b)** the still-checkpointed per-task nodes, re-read for each terminal task's result/status/error. No task body re-executes. A missing/malformed envelope ⇒ reconstruction derives from per-task checkpoints with an empty STARTED set rather than falling back to live execution (never hangs).

---

## 8. Serialization of `DagResult` — the converged container envelope

The DAG container's checkpoint payload is a single **`DagResultEnvelope`**, written identically in both the inline and the offloaded case. This payload is returned by `GetExecutionHistory` and rendered in the AWS console, so it is a customer-facing contract; it is pinned by the cross-language conformance suite (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4). The two cases differ only in whether the `tasks` array is present.

### 8.1 Wire shape

```ts
export interface SerializedDagTask {
  name: string;
  status: TaskStatus;
  /** TRIGGER_RULE | RUN_IF_PREDICATE; null unless status === "SKIPPED". */
  skipReason: SkipReason | null;
  /** "plain" | "batch" | "dag" (lowercase); null unless status === "SUCCEEDED". */
  resultKind: "plain" | "batch" | "dag" | null;
  /** The task result; null unless status === "SUCCEEDED". */
  result: unknown | null;
  /** Canonical PascalCase error object; null unless status === "FAILED". */
  error: ErrorObject | null;
  startedAt: string | null; // ISO 8601, UTC, ms precision, "Z" suffix; null when unknown
  completedAt: string | null;
}

export interface DagResultEnvelope {
  type: "DagResult";
  totalCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  completionReason: DagCompletionReason;
  /** Task names STARTED-but-not-terminal at early completion (§5.7). Bounded by
   *  maxConcurrency (default 40), so it survives every degradation step. */
  startedTaskNames: string[];
  /** Task names that FAILED, for diagnostics. null when dropped at the final degradation
   *  step; not read on replay (failed tasks are recovered from their child checkpoints). */
  failedTaskNames: string[] | null;
  /** Per-task detail. ABSENT (not null) when offloaded — its absence is the signal to
   *  reconstruct from the retained child operations. */
  tasks?: SerializedDagTask[];
}
```

### 8.2 Normative contract

1. **Every field except `tasks` is always present**, with explicit `null`s rather than omissions, so the inline and offloaded cases share one shape and a console reader sees the same fields either way.
2. **The absence of `tasks` is the offload signal** — it means the per-task detail exceeded the checkpoint limit and now lives in the retained child operations (`ReplayChildren` is set on the container). Readers treat absence as the signal and must not infer an empty task set.
3. **Ordered degradation ladder** (`buildDagOffloadPayload`): (i) full envelope with `tasks`; (ii) drop `tasks`, set `ReplayChildren`; (iii) if the tasks-less envelope is still over `CHECKPOINT_SIZE_LIMIT_BYTES`, drop `failedTaskNames` (set to `null`). The four counts, `completionReason`, and `startedTaskNames` **never** drop. `startedTaskNames` is bounded by `maxConcurrency`, so **a DAG can never fail to checkpoint because its own summary did not fit.**
4. **No `schemaVersion`.** Evolution is additive only: readers ignore unknown fields and treat a missing field as absent.
5. **Canonical error keys.** A failed task's error object carries `ErrorType`, `ErrorMessage`, and `StackTrace`, always present and `null` when unset, while preserving extra platform fields such as `ErrorData`. This normalization (`canonicalTaskError`) is scoped to the DAG envelope and does not change global error serialization. It is needed because `toErrorObject()` leaves `StackTrace`/`ErrorData` `undefined` when stack-trace capture is disabled (the default), and `JSON.stringify` drops `undefined` keys — which would silently omit them where the other SDKs emit explicit nulls.

The DAG owns no customer-facing summary generator. The envelope is self-describing, so no customer-supplied string is ever written into a payload the SDK parses back on replay — the corruption/hang vector that afflicts a load-bearing customer summary string cannot arise. The container's SDK-internal large-payload offload hook (a `ChildConfig` option) is wired to `buildDagOffloadPayload` (§7.4); that hook is SDK-owned, not a `DagConfig` field.

### 8.3 Serialization layers and `resultKind` tagging

There are **two independent serialization layers**:

1. **Per-task operation checkpoint.** Each task checkpoints its own result under its `DAG_NODE_T_{name}` ID using **its own** operation serdes (per-task `options.serdes`, else `DagContext` default, else `defaultSerdes`) — unchanged from standalone operations.
2. **Aggregated `DagResultEnvelope` container payload.** `createDagResultSerdes` serializes the full `DagResult`, embedding a copy of every task's result under `tasks[].result`. This embedding is **necessary**, not redundant: the inline completed-replay path returns the deserialized container _without_ re-running the executor, so it cannot re-read the individual per-task checkpoints.

**Why `resultKind` tagging is required.** For `map`/`parallel` tasks the result is a `BatchResult` and for nested `dag` tasks it is a `DagResult` — both are class instances with methods (`getResults()`, `throwIfError()`) and internal `Map`s. A generic `JSON.stringify` of such a value loses every method and serializes a `Map` to `{}`. Because the inline completed-replay path returns a method-bearing object, a method-less result would violate the `getResult<TResult>(): TResult` contract. The container serdes therefore tags and restores each task result according to its `resultKind`, recursively:

- **`resultKind` assignment (serialize, `serializeTask`):** determined by `instanceof` on the live result — `DagResultImpl` ⇒ `"dag"`, `BatchResultImpl` ⇒ `"batch"`, everything else ⇒ `"plain"`.
  - `"batch"` ⇒ serialize with the batch error-preserving serializer (`createBatchResultSerdes`), so `BatchItem.error` types and counts survive; the serialized string is re-parsed into the embedded JSON.
  - `"dag"` ⇒ serialize the nested result with the DAG envelope serializer **recursively** (a nested DAG whose tasks are themselves `map`/`dag` recurses again).
  - `"plain"` ⇒ the task's own operation serdes already produced a JSON-safe value.
- **restore (`restoreDagResult`):** rehydrates the top-level `DagResult` methods, then walks `tasks[]` and for each `SUCCEEDED` task recursively restores the result by `resultKind`: `"batch"` ⇒ `restoreBatchResult(result)`; `"dag"` ⇒ `restoreDagResult(result)` (recursive); `"plain"` ⇒ used as-is. This guarantees `getResult(mapOrNestedDagHandle)` returns a fully-methoded `BatchResult`/`DagResult` on the inline completed-replay path.

Errors serialize via `DurableOperationError.toErrorObject()` (normalized by `canonicalTaskError`) and reconstruct via `DurableOperationError.fromErrorObject()`. `TaskHandle._id` (symbol) is **not** serialized — the deserialized `DagResult.getResult(handle)` resolves by `handle.name`.

### 8.4 Reconstruct on the offloaded path (`reconstructDagResult`)

On the offloaded (`tasks`-absent) completed-replay path the DAG **reconstructs** the aggregate rather than re-scheduling (`reconstructDagResult` in `dag-executor.ts`). It re-runs only the deterministic parts — rebuild the registration graph by re-running `register`, recompute skip/trigger decisions (pure functions of upstream terminal statuses) — and reads each task's result from **its own child checkpoint**; no task body re-executes. It sources `totalCount`, the three counts, `completionReason`, and the `startedTaskNames` set from the **envelope** (authoritative — under early completion they can legitimately differ from a recompute over the reconstructed map, and `DagResultImpl` accepts them as `authoritativeCounts`).

Per-task handling on this pass:

- A task in `startedTaskNames` reconstructs as `STARTED` even if its underlying op happened to checkpoint `SUCCEEDED`/`FAILED` before the invocation unwound — the envelope is authoritative, so consulting the checkpoint status first would make `results` disagree with the envelope-sourced counts and make `getStatus` differ live-vs-replay.
- A checkpoint with `Status === "SUCCEEDED"`/`"FAILED"` reconstructs to that terminal state, reading the result via `readResult` (which dispatches on `task.kind`: `map`/`parallel` ⇒ `restoreBatchResult`, `dag` ⇒ `reconstructNestedDag`, else the parsed JSON).
- No checkpoint and not in the STARTED set: the task was either SKIPPED live (a skip checkpoints nothing, §9.5) or never started because early completion halted the scheduler. These are disambiguated by a single greedy skip recompute against the deterministic register graph: recompute the trigger-rule/`runIf` decision and, if it resolves to a skip, materialize `SKIPPED`; otherwise leave the task absent (never started). A task downstream of a `STARTED` (non-terminal) dep is left absent — it was never evaluated live, so a skip recomputed against that non-terminal status would diverge. Counts and `completionReason` remain sourced from the envelope, so the aggregate stays authoritative even when the greedy recompute materializes a skip the live run left absent under early completion.
- A `runIf` throw on this reconstruct pass is impossible in a faithful replay (a live throw would have aborted the DAG and the container would have checkpointed a failure, never reaching this success-replay path), so a throw here signals a non-deterministic predicate and surfaces as the same typed `DagPredicateError`, staying loud rather than being masked as `SKIPPED` or never-started.

**Nested offload** (`reconstructNestedDag`): a nested `dag` task is both a task of this DAG and its own child container; its per-task detail is checkpointed under `${entityId}-DAG_NODE_T_<innerName>`. If the inner container's aggregate also exceeded the limit, its envelope is offloaded too (no `tasks`), so `restoreDagResult` alone would yield honest aggregates but an empty per-task map. Reconstruction recovers the inner detail by recursing into the inner container's own child checkpoints via `reconstructDagResult`, reusing the retained `nestedDagRegister`/`nestedDagConfig` to rebuild the inner graph. Recurses to arbitrary depth.

`readDagEnvelope` reads the offloaded envelope from the container's `ContextDetails.Result`, validates it (`type === "DagResult"`, four non-negative-integer counts, `startedTaskNames` an array), ignores unknown fields, and returns `null` if missing or malformed. `restoreDagResult` also handles the tasks-less shape directly: it must preserve `totalCount`, the counts, and `completionReason` from the envelope rather than fabricating `new DagResultImpl(new Map(), "ALL_COMPLETED", 0)` — a nested DAG that failed tasks must never be reported to a caller as an empty `ALL_COMPLETED` success.

---

## 9. Edge cases

### 9.1 Nested DAGs

A nested `dagCtx.dag(name, deps, register, config)` is a task whose `executor` calls `runDagWithExplicitId(name, register, config)` → another `createDagHandler` invocation wrapped in a child context under `…-DAG_NODE_T_{name}` with SubType `DAG`. Its result is a `DagResult`, consumed by downstream tasks via `deps`. Scope is isolated (§10.1); IDs recurse as `…-DAG_NODE_T_{parent}-DAG_NODE_T_{child}` (§4.2). The task's `TaskDef` retains `nestedDagRegister`/`nestedDagConfig` so the offloaded-reconstruct path can recover the inner graph (§8.4).

### 9.2 `maxConcurrency` for nested DAGs

Parent `maxConcurrency` limits **only the top-level** tasks of that DAG; each nested DAG has its own scope and its own independent default of 40 (§2.9). A `map`/`parallel` task's internal fan-out likewise keeps its own concurrency setting.

### 9.3 Interruption mid-DAG

Covered in §7.7. Key invariant: skip decisions and `DepsMap` are recomputed each run from checkpointed task results, so partial progress resumes deterministically. Tasks that were `STARTED` but not checkpointed at interruption simply re-execute (at-least-once), identical to a standalone step interrupted mid-flight.

### 9.4 Termination-manager interaction

Two distinct config-failure channels, both **re-implemented in the DAG handler** (the DAG uses its own `dag-executor.ts`/`createDagHandler`, not `concurrent-execution-handler.ts`, so it cannot inherit these guards). Both fire **before** the child context is entered and before `register`, because both depend only on `config`:

- **`maxConcurrency <= 0` → throws a plain `Error`** (async, surfaced when the `dag()` promise is awaited). This mirrors `concurrent-execution-handler.ts`, which throws (does not terminate) for invalid `maxConcurrency`. The DAG reuses this exact guard shape at the top of `createDagHandler`.
- **Mutually-exclusive `completionConfig` → terminates** via `validateDagCompletionConfig`, which calls `terminationManager.terminate({ reason: TerminationReason.CONFIG_VALIDATION_ERROR, … })` and causes the handler to return a never-resolving promise, mirroring `validateCompletionConfig` (a non-retryable config error is terminated, not thrown, so the durable runtime does not treat it as a retryable customer error). It fires when `shouldComplete` is combined with any of `minSuccessful`/`toleratedFailureCount`/`toleratedFailurePercentage`.
- **Registration/graph validation errors (§6)** — cycle, bad name (incl. the reserved-`DAG_NODE_T_` and dangerous-name rules), duplicate, missing dep — are deterministic and surfaced by **throwing** the corresponding `Dag*Error` from within the DAG child-context body. Because §7.4 wires `errorMapper: (e) => e`, the raw `Dag*Error` propagates **unwrapped** to the caller. These are graph-shape errors thrown from customer-visible registration calls, analogous to the plain-`Error` throws the batch handler uses for "requires an array of items". Only the config-union violation follows the `terminate` path.
- `NonDeterministicExecutionError` from `validateReplayConsistency` on a task ID terminates the whole execution (unrecoverable), same as any other operation.
- A task's normal failure is **not** a termination — it is a terminal task state (§5.8).

### 9.5 What SKIPPED tasks checkpoint

**Nothing.** A skip is a pure function of upstream terminal statuses + a deterministic `runIf`, so it is recomputed identically each run and needs no entity ID / checkpoint. This keeps skips free and replay-safe. Skips are recorded only in the in-memory `DagResult` and, transitively, in the container's serialized `tasks` array (when inline).

### 9.6 `getResult` for failed / skipped / not-run tasks

- `SUCCEEDED` ⇒ returns the (deserialized) result.
- `FAILED` ⇒ returns `undefined` (inspect `results.get(name).error` or `failed()`).
- `SKIPPED` ⇒ returns `undefined` (`skipReason` on the `TaskExecution`).
- **In-flight at early completion** (started but the DAG resolved first, §5.7) ⇒ `getResult` returns `undefined`; `getStatus` returns `"STARTED"`.
- **Never started** (early completion stopped the scheduler before this task ran) ⇒ the task is **absent** from `results`: `getResult` returns `undefined` and **`getStatus` returns `undefined`** (never `"STARTED"`). This matches `CompletionItemStatus.status === undefined` for not-yet-started batch items.

### 9.7 Serdes for heterogeneous tasks

Covered by the two layers in §8.3. The per-task checkpoint uses each operation's own serdes; the aggregated `DagResultEnvelope` embeds every task result, tagged by `resultKind` so `map`/`parallel` (`BatchResult`) and nested `dag` (`DagResult`) results round-trip with their methods and `Map`s intact. On the offloaded path the aggregate is reconstructed from the envelope + per-task checkpoints (§8.4), not re-scheduled.

### 9.8 `map`/`parallel` task early-completion inside a DAG

A `map`/`parallel` task's own `completionConfig` governs it internally and it returns a `BatchResult` (one task node). The DAG-level `completionConfig` governs the DAG. The two are independent.

---

## 10. Scoping & determinism rules

### 10.1 Name uniqueness scope

Names must be unique **within the immediate `DagContext`**. Nested DAGs open a fresh scope. A dep handle must belong to the same scope (§6.3).

### 10.2 Registration determinism

The `register` callback must be deterministic on replay (same task names, deps, trigger rules, `runIf`). It may be `async` for ergonomics but must not perform non-deterministic IO. Non-deterministic registration produces a different graph on replay and surfaces as `validateReplayConsistency` failures on task IDs (§5.10).

---

## 11. Open questions & recommendations

1. **Observability of SKIPPED tasks** (§9.5). v1 checkpoints nothing for skips (zero cost). If AWS-console visibility is required, a later version could add an opt-in flag that writes a lightweight `SKIPPED` context node.
2. **`signal()` from within a DAG task.** Out of scope for the DAG spec; if/when the separately-proposed `signal()` lands, DAG tasks inherit it with the same "stop starting new tasks; in-flight finish" semantics as `completionConfig` early completion (§5.7).
3. **Very large graphs (memory).** Document a recommended ceiling (low thousands of tasks); defer hard limits/warnings to a later version.
4. **Custom result-based completion cross-language.** TypeScript ships the `shouldComplete` predicate in v1 (§13.4). Where a base predicate hook is missing (Python, Java, Go), it is deferred; see `DAG_SPEC_CROSS_LANGUAGE.md` §4.

---

## 12. Testing strategy

### 12.1 Unit tests

- **`dag-validator.test.ts`**: cycle detection (self-loop, 2-cycle, deep cycle, diamond=no-cycle), invalid names (empty, >100, bad chars, dash, embedded token, dangerous names), duplicates (same name across different op kinds), missing/foreign-scope deps.
- **`trigger-rules.test.ts`**: full truth table (§5.3) for all six rules × {empty, all-succ, all-fail, mixed, includes-skip}.
- **`task-handle.test.ts`**: `.after()`/`.triggerRule()` chaining mutates `TaskDef`; `DepsMap` type-level tests (via `tsd`/`expectType`) for empty vs non-empty deps, `R | undefined` values, and name-keyed result typing.
- **`dag-executor.test.ts`** (mock context): readiness/topological order, `maxConcurrency` throttling, skip propagation, `runIf` skip, `runIf` throw ⇒ `DagPredicateError` abort, `completionConfig` threshold + custom paths, drain-vs-early-completion.
- **`dag-result.test.ts`**: `getResult`/`getStatus` for succeeded/failed/skipped/not-run; `throwIfError`; `createDagResultSerdes` round-trip incl. error reconstruction and recursive `resultKind` restore; `buildDagOffloadPayload` degradation ladder; `readDagEnvelope` validation.
- **Entity-ID tests**: `createTaskId` output for prefixed/unprefixed contexts; nested recursion `…-DAG_NODE_T_a-DAG_NODE_T_b`; no collision with counter IDs.

### 12.2 `LocalDurableTestRunner` integration (`@aws/durable-execution-sdk-js-testing`)

Follow the existing `*.composed.test.ts` / replay-test patterns:

- Diamond `A → {B,C} → D`: assert all `SUCCEEDED`, `D` merges `B`,`C`; assert B,C ran concurrently.
- Mixed op types (step/invoke/callback/wait/child/map/parallel) as tasks — each appears as its native operation subtype in history under a `DAG_NODE_T_`-derived id; the `callback` task appears as the two-level `Callback`→`WaitForCallback` shape (§7.3).
- Compensation: `charge` fails ⇒ `refund` (`ALL_FAILED`) runs, `fulfill` (`ALL_SUCCESS`) skips, `audit` (`ALL_DONE`) runs.
- `runIf` branching: exactly one of publish/review/blocked runs; others `SKIPPED` with `RUN_IF_PREDICATE`.
- Nested DAG: sub-DAG result consumed downstream; scope isolation; nested `Dag` SubType.
- `completionConfig.shouldComplete` early completion (rules engine, §13.4).

### 12.3 Replay tests (parallels `concurrent-execution-handler.replay.test.ts`)

- **Order-independence**: force B-before-C on run 1 and C-before-B on replay; assert identical `DagResult` and no `NonDeterministicExecutionError` (proves name-based IDs, §4.4).
- **Interruption/resume**: interrupt after a subset of tasks checkpoint; resume; assert completed tasks hit fast paths (not re-executed — count side effects) and remaining tasks run once.
- **Skip determinism**: a `runIf`-skipped task stays skipped across replay without a checkpoint.
- **Large payload / offload**: force the `DagResultEnvelope` over `CHECKPOINT_SIZE_LIMIT_BYTES`; assert the offloaded (`tasks`-absent) path **reconstructs** an equal `DagResult` from the envelope + checkpointed per-task nodes (no live re-scheduling). Include an early-completion variant (STARTED tasks present) asserting `startedTaskNames`/`completionReason`/counts survive identically; a degradation-ladder variant asserting counts/`completionReason`/`startedTaskNames` are never dropped; and a nested-offload variant (`reconstructNestedDag`) asserting inner counts/reason are preserved (never fabricated as empty `ALL_COMPLETED`).

### 12.4 Verification bar

New code must build (`tsc`) and pass `eslint` + the package test suite. Type-level tests guard `DepsMap`/conditional-fn inference. ESLint-plugin rules for DAG footguns (non-deterministic `register`, async `runIf`) are a follow-up.

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

Pure addition. `DurableContext` gains one method (`dag`); no existing type or method changes semantically. `DagContext`/`TaskHandle`/`DagResult` are new. The `CompletionReason` base moves to `src/types/core.ts`, but `BatchResult.completionReason` keeps exactly its 5-member type and map/parallel semantics are unchanged. Existing applications are unaffected; `dag()` is strictly opt-in.
