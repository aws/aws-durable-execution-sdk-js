# DAG Support — Design Alternatives Considered

This document captures the design alternatives evaluated during the early
investigation of DAG support, including options that were rejected. It serves
as a record of the decision process for future reference.

For the current proposed design, see `dag-feature-spec.md`.

---

## 1. How to address the rules-engine short-circuit problem

The customer's original ask (Jamie's rules engine) needed a way to stop a
parallel batch when any rule produced a definitive verdict.

### Options considered

#### Option A: `Promise.race()` semantics (interpreted, rejected)

The team's first interpretation was that the customer wanted "first to
complete wins." The customer clarified this was not their need — they
wanted "stop everything when a definitive _business_ answer arrives,"
regardless of whether it was first.

**Rejected:** misunderstood the customer's intent.

#### Option B: `toleratedFailureCount: 0` with thrown exceptions (workaround)

Customer's existing workaround:

```typescript
context.parallel(
  rules.map((rule) => async (ctx) => {
    const verdict = await ctx.step("eval", () => evaluate(rule));
    if (verdict === "REJECT") throw new Error("REJECTED");
    return verdict;
  }),
  { completionConfig: { toleratedFailureCount: 0 } },
);
```

**Rejected:** conflates business rejection with execution failure. Pollutes
metrics, breaks error handling, and loses structured rejection context.

#### Option C: External state polling

Each rule writes its outcome to DynamoDB; parent polls the store.

**Rejected:** requires external infrastructure, adds latency, breaks the
durable execution programming model.

#### Option D: `signal()` API on batch child contexts (chosen)

Children can call `ctx.signal(reason)` to stop the batch with a recorded
reason. See [next decision](#2-signal-api-shape) for sub-decisions.

---

## 2. `signal()` API shape

How should `signal()` be exposed to children inside `map`/`parallel`?

### Options considered

#### Option A: Pass `BatchSignal` as extra positional argument

```typescript
context.parallel([
  async (ctx, batchControl) => {
    if (verdict === "REJECT") batchControl.signal({ reason: verdict });
    return verdict;
  },
]);
```

**Rejected:** verbose; every callback must accept (or ignore) the second
parameter; less discoverable than a method on `ctx`.

#### Option B: Add `signal()` to `DurableContext` (no-op outside batch)

Add `signal?` directly to `DurableContext`. Outside `map`/`parallel`, it's
either a no-op or throws.

**Rejected:** API surface bleed — developers see `signal` everywhere in
autocomplete and might call it from contexts where it does nothing.

#### Option C: New type `BatchChildContext extends DurableContext` (chosen)

```typescript
interface BatchChildContext<TLogger> extends DurableContext<TLogger> {
  signal(reason?: unknown): void;
}
```

**Chosen.** TypeScript prevents misuse — `signal` only autocompletes inside
`map`/`parallel` callbacks. Backward compatible because subtype includes
all existing methods.

---

## 3. In-flight cancellation when `signal()` fires

When a child signals, what happens to other in-flight branches?

### Options considered

#### Option A: True cancellation via `AbortSignal`

Plumb an `AbortController` through every operation. In-flight steps and
child contexts honor cancellation.

**Rejected:** significantly more complex — every step's user code would
need to honor cancellation. Out of scope for v1.

#### Option B: Drop in-flight checkpoints (chosen)

In-flight branches keep running but their checkpoints are dropped via the
existing `hasFinishedAncestor` mechanism. Same behavior as today's
`completionConfig.minSuccessful`.

**Chosen.** Reuses existing machinery. In-flight items finish naturally;
their results just aren't recorded. Total time is bounded by the slowest
in-flight branch at the moment of signal.

---

## 4. `shouldComplete` predicate vs predefined criteria

Should `shouldComplete` coexist with `minSuccessful`/`toleratedFailureCount`?

### Options considered

#### Option A: Allow both, document precedence

If both are present, define which one wins.

**Rejected:** ambiguous semantics, easy to misconfigure.

#### Option B: Type-level mutual exclusion via discriminated union (chosen)

```typescript
type CompletionConfig<TResult> =
  | { shouldComplete: ... }
  | { minSuccessful?: number; toleratedFailureCount?: number; ... };
```

**Chosen.** TypeScript catches the mistake at compile time — clearer than a
runtime exception.

#### Option C: Runtime validation

Accept flat shape, throw if both are present.

**Rejected:** runtime error instead of compile-time, easier to miss.

---

## 5. DAG entry point: container vs direct method

Should DAG features live on `DurableContext` directly, or inside a
container?

### Options considered

#### Option A: `context.task(name, deps, fn)` directly on DurableContext

Add `task()` as a sibling of `step()`/`invoke()`/etc.

**Rejected:** DAG features (deps, trigger rules, scheduler) only make
sense within a graph. Putting them on global `DurableContext` would
expose them everywhere but only work inside an implicit DAG.

#### Option B: `context.dag(name, registerCallback)` container (chosen)

DAG features are exposed via a `DagContext` passed to a registration
callback. Outside the callback, no DAG-specific methods exist.

**Chosen.** Mirrors existing `runInChildContext` pattern. Cleanly scopes
DAG capabilities. Allows `DagContext` to have its own type contract.

---

## 6. `DagContext` extends `DurableContext`?

Should DAG tasks be able to call `step`, `wait`, etc. directly on
`DagContext` (i.e., extend `DurableContext`)?

### Options considered

#### Option A: `DagContext extends DurableContext`

Inside the registration callback, developers can mix declarative task
declarations with imperative steps.

**Rejected:** mixes declarative graph definition with imperative side
effects. Tasks would not all be discoverable by the scheduler.

#### Option B: `DagContext` is a separate type (chosen)

`DagContext` only has DAG-specific methods (`step`, `invoke`, etc., all
returning `TaskHandle`). The registration callback is purely declarative.

**Chosen.** Forces clean separation between graph declaration and task
execution. Inside each task's function, a regular `DurableContext` is
provided for imperative work.

---

## 7. DAG task type system

How to expose operation types inside a DAG?

### Options considered

#### Option A: Single generic `task()` method

```typescript
dagCtx.task("name", deps, async (ctx, deps) => {
  return ctx.step("inner", () => doWork());
});
```

Every task is a child context wrapping arbitrary code.

**Rejected:** every step task is double-wrapped (CONTEXT + STEP), doubling
checkpoint cost. API is verbose for the common case.

#### Option B: Operation-flavored methods (chosen)

```typescript
dagCtx.step("name", deps, fn);
dagCtx.invoke("name", "fn:prod", deps, payloadFn);
dagCtx.callback("name", deps, submitter);
// ... and so on
```

**Chosen.** Each task is exactly one operation — no double wrapping.
Larger API surface but better ergonomics and ~50% lower checkpoint cost
for common cases.

#### Option C: Generic `task()` AND operation-flavored methods

Provide both — `task()` for complex multi-operation logic, plus
operation-flavored shorthand for common cases.

**Initially considered, then rejected.** The `task()` method turned out
to be exactly equivalent to `runInChildContext()` (both wrap arbitrary
code in a child context). Keeping both was redundant.

---

## 8. Entity ID generation strategy

How should DAG tasks generate entity IDs that work with the existing
checkpoint/replay machinery?

### Background

The SDK uses a per-context monotonic counter to generate entity IDs
(`createStepId()`). This works for `parallel`/`map` because items always
start in array order, but breaks for DAGs where start order depends on
upstream completion order.

### Options considered

#### Option A: Use the existing counter (no change)

Hope that scheduler always starts tasks in a deterministic order.

**Rejected:** scheduler order depends on completion order of dependencies,
which varies across replays. IDs would diverge, breaking replay.

#### Option B: Index-based IDs (`T0`, `T1`, `T2` from declaration order)

Each task gets an ID based on its position in the registration callback.

**Rejected for these reasons:**

- **Fragile to source code reordering** — moving a task declaration shifts
  all subsequent IDs, breaking in-flight replay during deployment
- **Adding a task in the middle** shifts all subsequent IDs
- **Future dynamic tasks (v2)** — index depends on iteration order, fragile
  to filtering/sorting changes
- **Poor debuggability** — `T5` doesn't tell you which task in execution
  history

#### Option C: Name-based IDs (`{parentId}-T_{taskName}`) (chosen)

Each task's entity ID is derived directly from its name.

**Chosen.** Stable across reorderings, additions, and dynamic task
creation. Self-describing in execution history. Forward-compatible with
v2 dynamic tasks.

The `T_` prefix reserves the namespace and prevents collision with
counter-based IDs.

---

## 9. How tasks access upstream results

How should a task's function receive the results of its dependencies?

### Options considered

#### Path 1: `.deps()` builder method only (ordering-only)

```typescript
dagCtx.step("c", async () => sendNotification()).deps(a, b);
```

Function gets no access to a's or b's results.

**Rejected:** loses type-safe access to upstream results, which is needed
for data-flow workflows. Forces all data flow through external state.

#### Path 2: Curried builder pattern

```typescript
dagCtx
  .step("c")
  .deps(a, b)
  .run(async (deps) => process(deps.a, deps.b));
```

`.deps()` returns a typed builder; `.run()` types the function.

**Rejected:** verbose — must call methods in specific order. Awkward when
you want shorthand for simple tasks.

#### Path 3: Hybrid — inline deps + `.deps()` builder (chosen)

```typescript
// Typed access via inline deps
dagCtx.step("c", [a, b], async (deps) => process(deps.a, deps.b));

// Ordering-only via .deps() builder
dagCtx.step("d", [], async () => sendEmail()).deps(a);
```

**Chosen.** Inline deps for typed-access cases; `.deps()` for ordering-only.
Both compose: a task can have typed inline deps PLUS additional
ordering-only deps.

#### Path 4: TaskHandle as awaitable

```typescript
const c = dagCtx
  .step("c", async () => {
    const aResult = await a.result; // awaitable handle
    return process(aResult);
  })
  .deps(a);
```

**Rejected:** awkward await dance. No compile-time check that the awaited
handles match the declared deps. Risk of deadlock if developer awaits
`.result` without declaring the dependency.

---

## 10. Two overloads vs single mandatory-deps signature

For each operation, should there be separate signatures with/without deps?

### Options considered

#### Option A: Two overloads per operation

```typescript
step(name, fn, options?);              // no deps
step(name, deps, fn, options?);        // typed deps
```

**Initially chosen, then revised.** Cleaner for the no-deps case (no
empty array boilerplate). But required overload parsing in implementation
and conditional type resolution.

#### Option B: Mandatory deps with empty-array support (chosen)

```typescript
step(name, deps, fn, options?);  // deps is `[]` or `[a, b, ...]`
```

TypeScript narrows fn parameter via conditional type:

- `TDeps extends readonly []` → fn takes no parameter
- Otherwise → fn parameter is `DepsMap<TDeps>`

**Chosen.** Single signature per operation — simpler to document, type,
and learn. Implementation has no overload parsing. Cost is minor
verbosity (`[]` for root tasks).

---

## 11. Cycle detection in v1

Should v1 validate the DAG for cycles?

### Options considered

#### Option A: Defer to v2

Don't detect cycles in v1; rely on developers to write correct DAGs.

**Rejected** despite initial preference. A cycle would cause the executor
to hang silently until Lambda timeout — terrible UX. Adding detection
later is backward compatible API-wise but the v1 UX cost is too high.

#### Option B: Kahn's algorithm at registration (chosen)

Run cycle detection after the registration callback returns, before
execution begins. Cost: O(V + E), runs once.

**Chosen.** Cheap, prevents footguns, dramatically improves dev
experience. Throws `DagCyclicDependencyError` listing the tasks in the
cycle.

---

## 12. Task ID format: name validation

If using name-based IDs, how to handle name characters?

### Options considered

#### Option A: Disallow `-` (and other separators) in names

Restrictive but unambiguous parsing.

**Rejected:** unnatural — names like `rule-a` are common.

#### Option B: Use length-prefixed encoding

`T7_rule-a` (prefix + length + name).

**Rejected:** opaque, not human-readable.

#### Option C: Just use names as-is, validate the character set (chosen)

Allow `[a-zA-Z0-9_-]+`, ≤100 chars, non-empty. The SDK doesn't actually
parse entity IDs (they're opaque keys), so dashes in names are fine.

**Chosen.** Throws `DagInvalidTaskNameError` at registration if invalid.

---

## 13. Conditional execution (Airflow's branching)

How should the DAG support value-based conditional execution?

### Options considered

#### Option A: Defer to v2

Rely on `signal()` from the separate proposal for short-circuit cases;
defer general conditional execution.

**Rejected:** `signal()` stops the entire DAG, not just downstream of a
specific task. Real customer use cases (content moderation, validation
pipelines) need per-task skip predicates.

#### Option B: `runIf` predicate via task options (chosen)

Every operation accepts an optional `runIf` predicate that's evaluated
against typed deps. If false, the task is SKIPPED.

```typescript
dagCtx.step("publish", [classify], async (deps) => doPublish(deps.classify), {
  runIf: (deps) => deps.classify === "safe",
});
```

**Chosen.** Per-task scope, type-safe (predicate sees same deps as fn),
covers Airflow's `BranchPythonOperator` and `ShortCircuitOperator` use
cases. Composes naturally with existing trigger rules.

#### Option C: Dedicated `branch` operation

A specialized task type that returns names of downstream tasks to run.

**Deferred to v2.** `runIf` covers the common cases. A dedicated
`branch` operation is syntactic sugar that adds DAG visualization
benefits but isn't strictly needed.

---

## 14. `runIf` placement

Where should `runIf` live on the API surface?

### Options considered

#### Option A: As a builder method `.runIf(predicate)`

```typescript
dagCtx.step("name", deps, fn).runIf((d) => d.x === "y");
```

**Rejected:** TaskHandle doesn't track the deps type after creation
(only the result type). The predicate's deps parameter would be
`unknown`, losing type safety.

#### Option B: In the operation's options (chosen)

```typescript
dagCtx.step("name", deps, fn, { runIf: (d) => d.x === "y" });
```

**Chosen.** Co-located with deps declaration, so TypeScript can type the
predicate using the same `DepsMap<TDeps>`. Single source of truth for
typed predicates.

---

## 15. `runIf` sync vs async

Should `runIf` predicates be allowed to be async?

### Options considered

#### Option A: Async allowed

```typescript
runIf?: (deps) => boolean | Promise<boolean>;
```

**Rejected:** async predicates encourage doing IO inside the predicate.
That breaks replay determinism (predicate would re-fetch on every
replay, potentially returning different values).

#### Option B: Sync only (chosen)

```typescript
runIf?: (deps) => boolean;
```

**Chosen.** Forces the predicate to be cheap and deterministic. If
external state is needed for the decision, fetch it in a step and use
the step's result in the predicate.

---

## 16. Sub-DAG grouping mechanism

How to express logical task groups for organization and reuse?

### Options considered

#### Option A: Dedicated `dagCtx.group(name, fn)` operation

A separate grouping primitive distinct from sub-DAGs.

**Rejected:** redundant — sub-DAGs already provide grouping naturally.

#### Option B: `dagCtx.dag(name, register)` for nested DAGs (chosen)

A sub-DAG IS a group. From the parent's perspective, it's a single task
node whose result is a `DagResult`. Inside the sub-DAG, tasks are scoped
independently.

**Chosen.** Composes naturally with the existing primitives. Nested
DAGs work for both grouping and reuse without a new concept.

---

## 17. Map/Parallel inside a DAG

Should `map` and `parallel` be available inside `DagContext`?

### Options considered

#### Option A: Not supported

Force users to express batch operations as multiple individual tasks.

**Rejected:** loses the batch operation primitives' value (concurrency
control, completion config, etc.).

#### Option B: Supported with same semantics as DurableContext (chosen)

`dagCtx.map(...)` and `dagCtx.parallel(...)` register a single task that
runs as a batch operation, returning a `BatchResult` to downstream tasks.

**Chosen.** Reuses all existing batch infrastructure. Each batch is one
node in the DAG (not flattened into individual tasks).

---

## Decision metadata

This document was assembled during early investigation conversations.
Decisions reflect the state of thinking at the time and may be revisited
as implementation reveals new constraints.
