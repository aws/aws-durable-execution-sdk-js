# DAG Support for durable executions - Early investigation 01

The current SDK supports two parallel execution primitives:

- `context.parallel(branches)` — homogeneous, independent branches
- `context.map(items, func)` — same function applied across an array

Neither expresses arbitrary dependencies between operations. Today, developers
who need cross-step dependencies might attempt to orchestrate them manually
using promise combinators:

```typescript
// Naive attempt at a diamond pattern: A → {B, C} → D
const aPromise = context.step("a", () => fetchA());
const [bPromise, cPromise] = [
  context.step("b", () => transformB(aPromise)),
  context.step("c", () => transformC(aPromise)),
];
const d = await context.step("d", async () => {
  const [b, c] = await Promise.all([bPromise, cPromise]);
  return merge(b, c);
});
```

### The hidden problem: this approach is not replay-safe

This pattern works for **simple fan-out then fan-in** because operations
start in deterministic source order. But for **arbitrary DAGs where downstream
tasks start based on upstream completion order**, the SDK's entity ID
generation breaks replay correctness.

#### Why: counter-based entity IDs

The SDK assigns each operation a unique entity ID using a per-context
monotonic counter, incremented when the operation starts:

```typescript
// src/context/durable-context/durable-context.ts
private createStepId(): string {
  this._stepCounter++;
  return this._stepPrefix
    ? `${this._stepPrefix}-${this._stepCounter}`
    : `${this._stepCounter}`;
}
```

Entity IDs are the **lookup keys for replay** — the SDK fetches checkpointed
results via `context.getStepData(entityId)`. For replay to succeed, the same
operation must produce the same entity ID across runs.

This works fine for `parallel`/`map` because they iterate items in
**deterministic array order**, assigning IDs at start time regardless of
completion order. But for a DAG where C depends on A and D depends on B,
the start order of C and D depends on whether A or B finishes first:

```
Tasks: A, B (no deps), C (depends on A), D (depends on B)

Run 1:  Start A,B  →  A finishes first  →  start C  →  B finishes  →  start D
        IDs:  A=1, B=2, C=3, D=4

Run 2 (replay):
        Start A,B  →  B finishes first  →  start D  →  A finishes  →  start C
        IDs:  A=1, B=2, D=3, C=4
                            ^^^^ DIFFERENT — replay validation fails
```

The replay validator looks up `getStepData(entityId)` and finds the wrong
operation type/name at that ID, causing replay divergence.

#### What manual orchestration cannot solve

This means today:

- **Diamond patterns** (A → {B, C} → D) — the await order at D forces
  serialization of B and C completions through Promise.all, so it happens
  to work, but only by accident
- **Multiple convergence points** (multiple independent diamonds) — each
  Promise.all introduces a serialization barrier; loses parallelism opportunities
- **Conditional branches based on upstream outcome** (e.g. compensation paths
  triggered only on failure) — selecting which downstream to run requires
  examining results, which forces deterministic ordering through awaits
- **Resource coordination** — limiting concurrency across an entire workflow
- **Reusable subgraphs** — composing pipelines of tasks

The user can encode any DAG by carefully sequencing `Promise.all` barriers,
but this:

- Loses parallelism opportunities the graph would naturally allow
- Makes the dependency graph implicit in code structure rather than declared
- Provides no trigger rule semantics (success/failure-conditional execution)
- Does not solve the entity ID problem if **any** downstream task's start
  is conditional on completion order

A first-class DAG primitive solves all of these by:

1. **Declaring the dependency graph upfront** in a registration phase
2. **Assigning stable entity IDs based on task names**, not execution order
   (see [Entity ID Strategy](#entity-id-strategy-critical))
3. **Scheduling tasks topologically** with maximum allowed parallelism
4. **Supporting trigger rules** for conditional downstream execution

---

## Customer Context

DAG support has been a recurring customer request, surfacing through multiple
channels:

### Direct asks for DAG support

Customers building workflow orchestration systems have repeatedly asked for
a declarative way to express task graphs with dependencies. These requests
range from simple fan-out/fan-in patterns to complex multi-stage pipelines
with conditional branching.

### Indirect asks via workaround friction

A larger group of customers has surfaced the same need by reporting friction
when attempting to build DAGs using the existing primitives:

- **Promise combinator approaches** — customers chaining `Promise.all` over
  step results encounter awkward code structure for non-trivial graphs, plus
  the entity ID determinism problem described in the
  [Motivation](#motivation) section
- **`map`/`parallel` workarounds** — customers attempt to express
  heterogeneous dependent tasks using `parallel` (which only supports
  independent branches), or use multiple `runInChildContext` blocks to force
  sequencing, losing parallelism along the way
- **Short-circuit and trigger-rule asks** — customers building rules engines,
  validation pipelines, and approval workflows ask for "stop early when X
  happens" or "run task Y only if upstream failed" — both naturally expressed
  through DAG trigger rules

The recent customer thread for the rules engine use case illustrates this
pattern. Within that thread, the SDK team confirmed DAG plans are on the
roadmap — specifically, an easier way to define steps with multiple
dependencies that start only after all dependent operations finish.

### Cross-product signal: AWS Step Functions

Comparable demand exists in the AWS Step Functions product community.
Customers have repeatedly asked for richer DAG semantics in Step Functions
state machines — including conditional task execution based on upstream
outcome, easier expression of fan-out/fan-in with heterogeneous tasks, and
better tooling for declaring dependencies. While Step Functions and durable
functions are different products, the underlying customer need is the same:
**a declarative way to express task graphs with dependencies, with
the orchestration runtime handling scheduling, parallelism, and conditional
execution**.

### Customer use case: rules engine

A representative use case from the recent customer thread:

- Validation rules organized as a DAG
- Rules at the same level evaluate in parallel
- Dependent rules wait for upstream rules to finish
- Some rules are terminal (a rejection means stop everything)
- Rules are IO-bound (querying knowledge bases) and may be slow

This use case combines **all** the major DAG features: dependencies,
parallelism, trigger rules (compensation paths on failure), and short-circuit
behavior (paired with the separately-proposed `signal()` API). A first-class
DAG primitive directly addresses this pattern.

---

## Goals and Non-Goals

### Goals

- Provide a declarative API for defining task graphs with dependencies
- Support both reference-based and builder-style dependency declaration
- Type-safe dependency results (downstream tasks receive correctly-typed inputs from upstream)
- Trigger rules for conditional execution paths (compensation, fallback, etc.)
- Reuse existing checkpointing/replay machinery
- Backward compatible — pure addition, no existing API changes
- Composable — DAGs can be nested for grouping and reusable subgraphs

### Non-Goals (v1)

- Branch tasks (Airflow `BranchPythonOperator`-style — task returns names of downstream to run/skip)
- Dynamic task creation at runtime (tasks that spawn more tasks)
- Pre-built operators (S3, DynamoDB, Bedrock, etc.)
- Cron-style scheduling (out of scope; use EventBridge Scheduler)
- Custom UI (use AWS Console execution history)

---

## Current State

### Existing primitives

| Primitive                                 | Purpose                                  |
| ----------------------------------------- | ---------------------------------------- |
| `context.step`                            | Atomic unit of work with checkpointing   |
| `context.parallel`                        | Homogeneous independent branches         |
| `context.map`                             | Same function across array               |
| `context.runInChildContext`               | Logical grouping with own step namespace |
| `context.promise.all/allSettled/any/race` | Standard promise combinators             |

### What's missing

There is no primitive that lets you express:

- "Task C runs after Tasks A and B"
- "Task D runs only if Task C failed"
- "Group these tasks as a unit; downstream depends on the group"

These currently require manual promise orchestration with no built-in support
for trigger rules, validation, or graph-aware scheduling.

---

## Proposed API

### Design principle

`DagContext` is a **separate type** from `DurableContext`. It defines its own
operation methods (`step`, `invoke`, `callback`, `wait`, `runInChildContext`,
`map`, `parallel`, `dag`) with signatures tailored to DAG semantics:

- **Mandatory `name`** — required for entity ID generation (see
  [Entity ID Strategy](#entity-id-strategy-critical))
- **Optional dependency declaration** — inline for typed access to upstream
  results, or via `.deps()` builder for ordering-only
- **Returns `TaskHandle` instead of `DurablePromise`** — operations register
  tasks; the topological scheduler executes them later

Internally, each DagContext operation is a thin wrapper that **delegates to
the same underlying handler as the corresponding DurableContext operation**.
The only differences are entity ID generation (name-based instead of
counter-based) and execution timing (deferred via the scheduler).

### Top-level entry point

```typescript
context.dag<TName extends string>(
  name: TName,
  register: (dagCtx: DagContext) => void | Promise<void>,
  config?: DagConfig,
): DurablePromise<DagResult>;
```

The `register` callback is a **registration phase only**. Tasks are declared
inside it but do not execute until the callback returns. After registration
completes, the SDK validates the graph and begins execution.

### `DagContext`

```typescript
interface DagContext {
  // ─── STEP ─────────────────────────────────────────────────────────────
  step<TName extends string, TDeps extends readonly TaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    fn: StepFn<TDeps, TResult>,
    options?: StepOptions & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  // ─── INVOKE ───────────────────────────────────────────────────────────
  invoke<
    TName extends string,
    TDeps extends readonly TaskHandle[],
    TPayload,
    TResponse,
  >(
    name: TName,
    functionName: string,
    deps: TDeps,
    payloadFn: PayloadFn<TDeps, TPayload>,
    options?: InvokeOptions & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResponse>;

  // ─── CALLBACK ─────────────────────────────────────────────────────────
  callback<TName extends string, TDeps extends readonly TaskHandle[], TResult>(
    name: TName,
    deps: TDeps,
    submitter: SubmitterFn<TDeps>,
    options?: WaitForCallbackOptions & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  // ─── WAIT ─────────────────────────────────────────────────────────────
  wait<TName extends string, TDeps extends readonly TaskHandle[]>(
    name: TName,
    deps: TDeps,
    duration: Duration,
    options?: ConditionalConfig<TDeps>,
  ): TaskHandle<TName, void>;

  waitForCondition<
    TName extends string,
    TDeps extends readonly TaskHandle[],
    TState,
  >(
    name: TName,
    deps: TDeps,
    check: CheckFn<TDeps, TState>,
    options: WaitForConditionOptions<TState> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TState>;

  // ─── CHILD CONTEXT (multi-operation logic) ────────────────────────────
  runInChildContext<
    TName extends string,
    TDeps extends readonly TaskHandle[],
    TResult,
  >(
    name: TName,
    deps: TDeps,
    fn: ChildContextFn<TDeps, TResult>,
    options?: ChildConfig<TResult> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, TResult>;

  // ─── BATCH OPERATIONS ─────────────────────────────────────────────────
  map<TName extends string, TDeps extends readonly TaskHandle[], TIn, TOut>(
    name: TName,
    deps: TDeps,
    items: TIn[] | ((deps: DepsMap<TDeps>) => TIn[]),
    fn: MapFunc<TIn, TOut, DurableLogger>,
    options?: MapConfig<TIn, TOut> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<TOut>>;

  parallel<TName extends string, TDeps extends readonly TaskHandle[], T>(
    name: TName,
    deps: TDeps,
    branches: ParallelFunc<T, DurableLogger>[],
    options?: ParallelConfig<T> & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, BatchResult<T>>;

  // ─── NESTED DAG ───────────────────────────────────────────────────────
  dag<TName extends string, TDeps extends readonly TaskHandle[]>(
    name: TName,
    deps: TDeps,
    register: (subDagCtx: DagContext) => void | Promise<void>,
    config?: NestedDagConfig & ConditionalConfig<TDeps>,
  ): TaskHandle<TName, DagResult>;
}
```

#### Function-signature types

Each operation's function signature is conditional on whether deps is empty.
TypeScript narrows the function parameters automatically based on the
declared deps tuple:

```typescript
/** Step: fn takes deps if non-empty, otherwise no parameter. */
type StepFn<
  TDeps extends readonly TaskHandle[],
  TResult,
> = TDeps extends readonly []
  ? () => Promise<TResult>
  : (deps: DepsMap<TDeps>) => Promise<TResult>;

/** Invoke: payload function returns the payload, takes deps if non-empty. */
type PayloadFn<
  TDeps extends readonly TaskHandle[],
  TPayload,
> = TDeps extends readonly []
  ? () => TPayload | Promise<TPayload>
  : (deps: DepsMap<TDeps>) => TPayload | Promise<TPayload>;

/** Callback: submitter takes callbackId always, deps if non-empty. */
type SubmitterFn<TDeps extends readonly TaskHandle[]> =
  TDeps extends readonly []
    ? (callbackId: string) => Promise<void>
    : (callbackId: string, deps: DepsMap<TDeps>) => Promise<void>;

/** Child context: fn takes ctx always, deps if non-empty. */
type ChildContextFn<
  TDeps extends readonly TaskHandle[],
  TResult,
> = TDeps extends readonly []
  ? (ctx: DurableContext) => Promise<TResult>
  : (ctx: DurableContext, deps: DepsMap<TDeps>) => Promise<TResult>;

/** Wait for condition: same shape as step. */
type CheckFn<
  TDeps extends readonly TaskHandle[],
  TState,
> = TDeps extends readonly []
  ? (state: TState) => Promise<TState>
  : (state: TState, deps: DepsMap<TDeps>) => Promise<TState>;
```

When deps is `[]`, the function takes no deps parameter. When deps has
elements, the function gets a typed deps map.

#### Conditional execution: `runIf` predicate

Every operation accepts an optional `runIf` predicate via its options. The
predicate is evaluated **before the task runs**, against the resolved deps
map. If it returns `false`, the task is **SKIPPED** without executing.

```typescript
/**
 * Conditional execution config available on every operation's options.
 */
interface ConditionalConfig<TDeps extends readonly TaskHandle[]> {
  /**
   * Predicate evaluated against upstream task results.
   * - Returns `true` (or omitted): task runs normally
   * - Returns `false`: task is SKIPPED
   *
   * Must be deterministic on replay. Must be synchronous to prevent
   * accidental IO in predicates (predicates should be cheap pure logic).
   */
  runIf?: (deps: DepsMap<TDeps>) => boolean;
}
```

The predicate has the **same typed deps map** as the operation's main
function — it sees results from upstream tasks declared in the `deps`
array (not ordering-only deps from `.deps()` builder).

##### Example: value-based branching

```typescript
const classify = dagCtx.step("classify", [fetch], async (deps) =>
  classifyContent(deps.fetch),
);

const publish = dagCtx.step(
  "publish",
  [classify],
  async (deps) => doPublish(deps.classify),
  { runIf: (deps) => deps.classify === "safe" },
);

const review = dagCtx.step(
  "review",
  [classify],
  async (deps) => sendForReview(deps.classify),
  { runIf: (deps) => deps.classify === "review" },
);

const blocked = dagCtx.step(
  "blocked",
  [classify],
  async (deps) => logBlocked(deps.classify),
  { runIf: (deps) => deps.classify === "block" },
);
```

Exactly one of `publish`, `review`, or `blocked` runs based on `classify`'s
result. The other two are SKIPPED.

##### Interaction with trigger rules

A task can be SKIPPED for two reasons:

1. **Trigger rule unsatisfied** — upstream states didn't match the rule
2. **`runIf` returned false** — predicate rejected the task

Both produce identical SKIPPED status. Downstream tasks see SKIPPED
upstream and apply their own trigger rules normally:

| Downstream trigger rule | Behavior with skipped upstream               |
| ----------------------- | -------------------------------------------- |
| `ALL_SUCCESS`           | Skipped (skip is not success)                |
| `ALL_FAILED`            | Skipped (skip is not failure)                |
| `ALL_DONE`              | Runs (skip counts as done)                   |
| `NONE_FAILED`           | Runs (skip is not a failure)                 |
| `ONE_SUCCESS`           | Runs only if at least one upstream succeeded |
| `ONE_FAILED`            | Runs only if at least one upstream failed    |

The `TaskExecution` records the skip reason for diagnostics:

```typescript
interface TaskExecution<TResult = unknown> {
  // ... existing fields
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";
  skipReason?: "TRIGGER_RULE" | "RUN_IF_PREDICATE";
}
```

##### When NOT to use `runIf`

- **Skipping based on deterministic registration-time values** — if the
  condition is known at registration (not based on upstream results), just
  don't declare the task. `runIf` is for runtime decisions.
- **Skipping based on external state** — predicates must be deterministic.
  Don't read environment variables or do IO inside `runIf`. Use a step to
  fetch external state, then use `runIf` against the step's result.
- **Stopping the entire DAG** — use `signal()` (separate proposal) or
  `completionConfig.shouldComplete` instead.

#### Why mandatory deps

The deps array is required at every operation call (possibly empty). This
gives:

- **Single, uniform signature per operation** — easier to document and learn
- **Forces explicit dependency declaration** — every task states its deps
- **Simpler implementation** — no overload parsing
- **Cleaner type inference** — no conditional overload resolution
- **Eliminates the "no inline deps but wants typed access" gap** — you always
  declare deps inline if you need typed access

The cost is minor verbosity: root tasks (no upstream deps) need an empty
array literal. In practice, a DAG with 10 tasks might have 1–3 root tasks
that carry the `[]` boilerplate.

#### Why mandatory name

Our entity ID strategy is `{parentId}-T_{taskName}`. There's no fallback —
**the name is the identifier**. Without a name:

- We cannot generate a stable entity ID
- Replay cannot find the cached result
- The whole design breaks

This is a key difference from `DurableContext`, where name is optional
because counter-based IDs provide a fallback.

### `TaskHandle`

The return value of every DagContext operation. Serves dual purposes:

1. **Reference** for use as a dependency in other tasks
2. **Builder** for non-deps configuration

```typescript
interface TaskHandle<TName extends string, TResult> {
  // Opaque identifier (used for graph internals)
  readonly _name: TName;
  readonly _id: symbol;

  /**
   * Declare ordering-only dependencies — this task waits for them but
   * does not access their results in its function body.
   * For typed access to upstream results, use the inline-deps overload
   * of the operation method instead.
   */
  deps<TDeps extends readonly TaskHandle[]>(...deps: TDeps): this;

  /** Set the trigger rule (default: ALL_SUCCESS). */
  triggerRule(rule: TriggerRule): this;
}
```

All builder methods return the same handle and can be chained.

### Two ways to declare dependencies

```typescript
// Inline deps (typed access in function body)
const c = dagCtx.step("c", [a, b], async (deps) => process(deps.a, deps.b));

// No upstream data needed — empty array
const a = dagCtx.step("a", [], async () => fetchA());

// Ordering-only deps via .deps() — no result access in function body
const d = dagCtx.step("d", [], async () => sendNotification()).deps(a);

// Mixed: typed deps inline + ordering-only via .deps()
const e = dagCtx.step("e", [a], async (deps) => process(deps.a)).deps(b);
```

**Inline deps** (in the array argument) give the function typed access to
upstream task results. This is the right choice when the task needs to use
upstream values.

**`.deps()` builder** declares dependencies that must complete before this
task runs but whose results aren't consumed by this task's function. Useful
for ordering side effects (e.g., "task d must run after task a finishes,
but doesn't use a's data").

Both can be combined: a task can have typed inline deps AND additional
ordering-only deps via `.deps()`.

---

## Type System

### Capturing task names as literal types

The `<TName extends string>` generic captures the literal string type:

```typescript
const a = dagCtx.step("fetch-data", [], async () => 42);
// type: TaskHandle<"fetch-data", number>
```

### Mapping dependency tuples to typed result objects

```typescript
type DepsMap<Deps extends readonly TaskHandle<string, unknown>[]> = {
  [K in Deps[number] as K["_name"]]: K extends TaskHandle<string, infer R>
    ? R
    : never;
};
```

When `Deps` is empty (`readonly []`), `Deps[number]` is `never`, so
`DepsMap<[]>` evaluates to `{}`. This is why empty-deps signatures don't
expose a deps parameter.

Example:

```typescript
const a = dagCtx.step("a", [], async () => 42); // TaskHandle<"a", number>
const b = dagCtx.step("b", [], async () => "hello"); // TaskHandle<"b", string>

const c = dagCtx.step("c", [a, b], async (deps) => {
  // deps is typed as { a: number; b: string }
  return deps.a + deps.b.length;
});
```

### Type inference flowchart

```
dagCtx.step("name", deps, fn)
  └─ TName captured as literal "name"
  └─ TDeps captured as readonly tuple of TaskHandles (possibly empty)
       └─ DepsMap<TDeps> derives object shape ({}for empty deps)
            └─ StepFn<TDeps, TResult> conditionally types fn parameter
                 ├─ if TDeps is []: fn has no parameter
                 └─ else: fn parameter is DepsMap<TDeps>
  └─ TResult inferred from fn return type
       └─ TaskHandle<"name", TResult> returned
```

---

## Trigger Rules

Each task can specify a trigger rule that determines when (or whether) it runs
based on the state of its upstream dependencies.

```typescript
type TriggerRule =
  | "ALL_SUCCESS" // (default) all upstream succeeded
  | "ALL_FAILED" // all upstream failed
  | "ALL_DONE" // all upstream done (regardless of outcome)
  | "ONE_SUCCESS" // at least one upstream succeeded
  | "ONE_FAILED" // at least one upstream failed
  | "NONE_FAILED"; // no upstream failures (success or skipped)
```

When a task's trigger rule is **not satisfied**, the task is **SKIPPED** (a
status specific to DAGs). Tasks can also be skipped by their `runIf`
predicate (see [Conditional execution](#conditional-execution-runif-predicate)).
Both produce the same SKIPPED status. Skipped tasks count as `NONE_FAILED`
for downstream trigger rule evaluation.

### Trigger rule evaluation table

| Upstream states  | `ALL_SUCCESS` | `ALL_FAILED` | `ALL_DONE` | `ONE_SUCCESS`      | `ONE_FAILED`    | `NONE_FAILED`  |
| ---------------- | ------------- | ------------ | ---------- | ------------------ | --------------- | -------------- |
| All succeeded    | Run           | Skip         | Run        | Run                | Skip            | Run            |
| All failed       | Skip          | Run          | Run        | Skip               | Run             | Skip           |
| Mixed            | Skip          | Skip         | Run        | Run                | Run             | Skip           |
| Includes skipped | Skip          | Skip         | Run        | Run if any success | Run if any fail | Run if no fail |

---

## Result API

```typescript
interface DagResult {
  /** Get a task's result by handle (type-safe) or name (unknown). */
  getResult<TResult>(handle: TaskHandle<string, TResult>): TResult | undefined;
  getResult(name: string): unknown;

  /** Get a task's status. */
  getStatus(
    taskNameOrHandle: string | TaskHandle<string, unknown>,
  ): "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";

  /** Aggregate views. */
  succeeded(): TaskExecution[];
  failed(): TaskExecution[];
  skipped(): TaskExecution[];

  /** Map view of all task executions. */
  results: ReadonlyMap<string, TaskExecution>;

  /** Overall counts. */
  successCount: number;
  failureCount: number;
  skippedCount: number;
  totalCount: number;

  /** Why the DAG completed. */
  completionReason:
    | "ALL_COMPLETED"
    | "TASK_FAILED"
    | "SIGNALED" // if signal() called
    | string; // custom reason from shouldComplete predicate

  /** Throws if any task failed. */
  throwIfError(): void;
}

interface TaskExecution<TResult = unknown> {
  name: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED";
  /** Reason a task was SKIPPED. Only present when status === "SKIPPED". */
  skipReason?: "TRIGGER_RULE" | "RUN_IF_PREDICATE";
  result?: TResult;
  error?: ChildContextError;
  startedAt?: Date;
  completedAt?: Date;
}
```

---

## Configuration

```typescript
interface DagConfig {
  /** Maximum number of tasks running concurrently (default: unlimited). */
  maxConcurrency?: number;

  /** Completion behavior — same semantics as parallel/map. */
  completionConfig?: CompletionConfig;

  /** Default retry strategy applied to tasks that don't specify one. */
  defaultRetryStrategy?: RetryStrategy;

  /** Default trigger rule (default: ALL_SUCCESS). */
  defaultTriggerRule?: TriggerRule;

  /** Serdes for the overall DagResult. */
  serdes?: Serdes<DagResult>;

  /** Nesting type for task child contexts. */
  nesting?: NestingType;
}

/**
 * Nested DAG config. Deps are passed as a separate parameter to the dag()
 * method (matching the uniform mandatory-deps signature); only trigger rule
 * is configured here.
 */
interface NestedDagConfig extends DagConfig {
  triggerRule?: TriggerRule;
}
```

---

## Validation

### Cycle detection (v1)

The graph is validated **at the end of the registration phase, before
execution begins**, using Kahn's algorithm:

```typescript
function detectCycle(tasks: TaskDef[]): string[] | null {
  const inDegree = new Map<string, number>();
  tasks.forEach((t) => inDegree.set(t.name, t.deps.length));

  const queue = tasks
    .filter((t) => inDegree.get(t.name) === 0)
    .map((t) => t.name);
  const visited: string[] = [];

  while (queue.length > 0) {
    const name = queue.shift()!;
    visited.push(name);
    tasks
      .filter((t) => t.deps.some((d) => d._name === name))
      .forEach((t) => {
        const newDeg = inDegree.get(t.name)! - 1;
        inDegree.set(t.name, newDeg);
        if (newDeg === 0) queue.push(t.name);
      });
  }

  return visited.length === tasks.length
    ? null
    : tasks.filter((t) => !visited.includes(t.name)).map((t) => t.name);
}
```

If a cycle is detected, throw `DagCyclicDependencyError` listing the tasks
involved in the cycle. Cost: O(V + E), runs once.

### Other validations

- **Missing dependencies** — task references a `TaskHandle` that wasn't declared in this DAG → `DagInvalidDependencyError`
- **Duplicate task names** — operation method called twice with same name (e.g., `dagCtx.step("a", ...)` then `dagCtx.invoke("a", ...)`) → `DagDuplicateTaskError`
- **Invalid task name** — name is empty, exceeds 100 characters, or contains characters outside `[a-zA-Z0-9_-]` → `DagInvalidTaskNameError`
- **Empty DAG** — no tasks declared → return immediately with empty `DagResult`

---

## Implementation Plan

### Architecture summary

The implementation has two distinct parts:

1. **Extending existing operation handlers** with internal explicit-ID
   variants — the _only_ change to existing code, and a small one
2. **New DAG handler** — the registration API, scheduler, and result aggregation

The vast majority of operation logic (checkpointing, retry strategies, serdes,
replay detection, error handling) is **unchanged and reused**. The DAG
context calls existing handlers via the explicit-ID entry points, passing
deps to the user's function via closure.

### File structure

```
src/handlers/dag-handler/
├── dag-handler.ts              # createDagHandler entry point
├── dag-context.ts              # DagContext implementation (registers tasks)
├── task-handle.ts              # TaskHandle (reference + builder)
├── dag-executor.ts             # Topological scheduler
├── dag-validator.ts            # Cycle detection + other validations
├── dag-result.ts               # DagResult implementation
└── trigger-rules.ts            # Trigger rule evaluation logic

src/types/dag.ts                # Public types (DagContext, TaskHandle, DagResult, etc.)
src/errors/dag-errors/
└── dag-errors.ts               # DagCyclicDependencyError, etc.
```

### Required changes to existing files

```
src/context/durable-context/durable-context.ts
└── Add internal explicit-ID variants for each operation:
    - runStepWithExplicitId
    - runInvokeWithExplicitId
    - runCallbackWithExplicitId
    - runWaitWithExplicitId
    - runWaitForConditionWithExplicitId
    - runMapWithExplicitId
    - runParallelWithExplicitId
    - runInChildContextWithExplicitId
    - runDagWithExplicitId
    Each accepts an entityId parameter instead of calling createStepId().

src/handlers/{step,invoke,callback,wait,...}-handler/*.ts
└── Refactor each to support both counter-based and explicit-ID entry
    points. The shared logic (replay detection, child context creation,
    error handling) is extracted; the only difference is whether the
    entity ID comes from createStepId() or is provided externally.
```

### High-level flow

```typescript
// dag-handler.ts
export const createDagHandler = (
  context: ExecutionContext,
  runInChildContext: DurableContext["runInChildContext"],
  ...
) => {
  return <TName extends string>(
    name: TName,
    register: (dagCtx: DagContext) => void | Promise<void>,
    config?: DagConfig,
  ): DurablePromise<DagResult> => {
    return new DurablePromise(async () => {
      // 1. Wrap registration + execution in a child context
      return await runInChildContext(name, async (parentCtx) => {
        // 2. Build DagContext, run registration callback
        const dagCtx = new DagContextImpl();
        await register(dagCtx);

        // 3. Validate graph (cycle detection, name validation, missing deps)
        const tasks = dagCtx.getTasks();
        validateDag(tasks);

        // 4. Execute via topological scheduler
        const executor = new DagExecutor(parentCtx, tasks, config);
        return await executor.run();
      });
    });
  };
};
```

### `DagContext` implementation (registration)

Each operation method on `DagContext` follows the same pattern: validate
inputs, register a `TaskDef`, return a `TaskHandle`. Since deps is mandatory
(possibly empty), there's no overload parsing — the signature is uniform.

```typescript
// dag-context.ts
class DagContextImpl implements DagContext {
  private registry = new Map<string, TaskDef>();

  step<TName, TDeps, TResult>(
    name: TName,
    deps: TDeps,
    fn: StepFn<TDeps, TResult>,
    options?: StepOptions,
  ): TaskHandle<TName, TResult> {
    this.validateName(name);
    this.assertNotDuplicate(name);

    const taskDef: TaskDef = {
      name,
      operationType: "STEP",
      deps,
      executor: (parentContext, parentEntityId, depsResults) => {
        // For empty deps, fn takes no parameter; for non-empty, fn(depsResults)
        const wrappedFn =
          deps.length === 0
            ? () => (fn as () => Promise<TResult>)()
            : () => (fn as (d: any) => Promise<TResult>)(depsResults);

        return parentContext.runStepWithExplicitId(
          `${parentEntityId}-T_${name}`,
          name,
          wrappedFn,
          options,
        );
      },
    };

    this.registry.set(name, taskDef);
    return new TaskHandleImpl(name);
  }

  // Same pattern for invoke, callback, wait, runInChildContext, map,
  // parallel, dag — each constructs a TaskDef whose executor calls the
  // appropriate explicit-ID handler.
}
```

### Topological scheduler (`dag-executor.ts`)

```typescript
class DagExecutor {
  private readyQueue: TaskDef[] = [];
  private inFlight = new Set<string>();
  private results = new Map<string, TaskExecution>();

  constructor(
    private parentContext: DurableContext,
    private parentEntityId: string,
    private tasks: TaskDef[],
    private config: DagConfig,
  ) {}

  async run(): Promise<DagResult> {
    // Initial ready set: tasks with no dependencies
    this.readyQueue = this.tasks.filter((t) => t.deps.length === 0);

    return new Promise((resolve) => {
      const tryStartNext = () => {
        while (
          this.readyQueue.length > 0 &&
          this.inFlight.size < (this.config.maxConcurrency ?? Infinity) &&
          this.shouldContinue()
        ) {
          this.startTask(this.readyQueue.shift()!);
        }
        if (this.isComplete()) resolve(this.buildResult());
      };

      const startTask = async (task: TaskDef) => {
        this.inFlight.add(task.name);

        // Evaluate trigger rule against upstream task states
        if (!this.evaluateTriggerRule(task)) {
          this.results.set(task.name, {
            name: task.name,
            status: "SKIPPED",
            skipReason: "TRIGGER_RULE",
          });
          this.inFlight.delete(task.name);
          this.queueDownstream(task.name);
          tryStartNext();
          return;
        }

        // Build deps map from in-memory results (NOT from checkpoints —
        // the executor tracks completed task results in this.results)
        const depsResults = this.buildDepsMap(task);

        // Evaluate runIf predicate (if present) against upstream results
        if (task.runIf && !task.runIf(depsResults)) {
          this.results.set(task.name, {
            name: task.name,
            status: "SKIPPED",
            skipReason: "RUN_IF_PREDICATE",
          });
          this.inFlight.delete(task.name);
          this.queueDownstream(task.name);
          tryStartNext();
          return;
        }

        // Delegate to the appropriate explicit-ID handler.
        // The TaskDef.executor closure encapsulates the operation type.
        try {
          const result = await task.executor(
            this.parentContext,
            this.parentEntityId,
            depsResults,
          );
          this.onTaskSucceeded(task, result);
        } catch (error) {
          this.onTaskFailed(task, error);
        }
      };

      tryStartNext();
    });
  }

  private buildDepsMap(task: TaskDef): Record<string, unknown> {
    // Read upstream results from in-memory map
    const map: Record<string, unknown> = {};
    for (const dep of task.deps) {
      const exec = this.results.get(dep._name);
      map[dep._name] = exec?.result; // undefined for failed/skipped
    }
    return map;
  }

  private queueDownstream(completedName: string): void {
    // For each task whose deps include completedName,
    // check if all deps are now done. If so, add to readyQueue.
    for (const task of this.tasks) {
      if (this.inFlight.has(task.name)) continue;
      if (this.results.has(task.name)) continue;

      const allDepsDone = task.deps.every((d) => this.results.has(d._name));
      if (allDepsDone && !this.readyQueue.includes(task)) {
        this.readyQueue.push(task);
      }
    }
  }

  private evaluateTriggerRule(task: TaskDef): boolean {
    const upstreamStatuses = task.deps.map(
      (d) => this.results.get(d._name)!.status,
    );
    return triggerRuleEvaluators[task.triggerRule](upstreamStatuses);
  }
}
```

### How upstream results flow to downstream tasks

Concrete example with `s1` → `s2`:

```typescript
const s1 = dagCtx.step("s1", [], async () => fetchData());
const s2 = dagCtx.step("s2", [s1], async (deps) => process(deps.s1));
```

Execution flow:

1. **Registration phase**: both tasks registered in DagContext registry.
   Their `executor` closures are stored but not called.

2. **`s1` becomes ready** (no deps): scheduler calls `s1.executor(...)`.
   Since `s1`'s deps is `[]`, the executor wraps fn as `() => fn()`.
   This invokes `runStepWithExplicitId("...-T_s1", "s1", () => fetchData(), ...)`.
   The existing step handler runs the fn, checkpoints the result at
   `{parentId}-T_s1`. Returns the result.

3. **Scheduler stores `s1`'s result** in `this.results` map:
   `this.results.set("s1", { name: "s1", status: "SUCCEEDED", result: <data> })`.

4. **`s2` becomes ready** (s1 completed): scheduler builds `depsMap` from
   `this.results`: `{ s1: <data> }`. Calls `s2.executor(parentCtx, parentId, { s1: <data> })`.

5. **`s2.executor`** has non-empty deps so wraps fn as `() => fn(depsMap)`.
   Invokes `runStepWithExplicitId("...-T_s2", "s2", () => fn(depsMap), ...)`.
   The user's function is `(deps) => process(deps.s1)`, so it computes
   `process(<data>)`.

6. **The existing step handler** sees an ordinary `() => Promise<T>` function.
   It runs it, checkpoints the result at `{parentId}-T_s2`. Done.

The existing step handler doesn't know or care about deps — it just runs
whatever function it's given. The DAG executor handles deps purely in memory.

### Replay correctness

On replay after an interruption:

1. Scheduler attempts `s1` → existing step handler finds checkpoint at `T_s1`
   → returns cached result immediately
2. Executor stores cached result in `this.results`
3. Scheduler attempts `s2` → step handler finds no checkpoint → executes
   normally with `depsMap` rebuilt from in-memory `this.results`

The `depsMap` is rebuilt fresh each run, but it's always consistent with
checkpointed state because:

- Entity IDs are stable (`T_s1`, `T_s2`)
- The scheduler enforces topological order (s2 only ready after s1 completes)
- s1's result on replay equals s1's result on initial run (it's checkpointed)

---

## Entity ID Strategy (Critical)

**This is a non-trivial design constraint that distinguishes DAG from
`parallel`/`map`.**

### The current SDK ID generation model

The SDK generates entity IDs using a per-context monotonic counter:

```typescript
// src/context/durable-context/durable-context.ts
private createStepId(): string {
  this._stepCounter++;
  return this._stepPrefix
    ? `${this._stepPrefix}-${this._stepCounter}`
    : `${this._stepCounter}`;
}
```

`createStepId()` is called inside `runInChildContext` (and step/wait/etc.)
when the operation **starts**. The resulting ID is used as the lookup key
into the checkpoint store on replay.

### Why this works for `parallel` and `map`

Both `parallel` and `map` iterate items in **deterministic array order**:

```typescript
// concurrent-execution-handler.ts
const tryStartNext = () => {
  while (activeCount < maxConcurrency && currentIndex < items.length) {
    const item = items[currentIndex++];  // deterministic order
    parentContext.runInChildContext(item.name, ...).then(...);
  }
};
```

Items always **start** in array order. Completion order is irrelevant —
IDs were assigned at start time. So even though items run concurrently,
replay sees the same IDs every time.

### Why this breaks for DAGs

In a DAG, **start order depends on completion order of dependencies**,
which varies across replays:

```
Tasks: A, B (no deps), C (depends on A), D (depends on B)

Run 1: Start A, B → A finishes first → start C → B finishes → start D
       IDs: A=1, B=2, C=3, D=4

Run 2 (replay): Start A, B → B finishes first → start D → A finishes → start C
       IDs: A=1, B=2, D=3, C=4
                          ^^^^ DIFFERENT — replay validation fails
```

The replay validator does `context.getStepData(entityId)` to fetch cached
results. If task C had ID `3` in the original run but `4` on replay, the
lookup fails and replay diverges.

### Solution: name-based semantic IDs

Each task is assigned an entity ID based on its **task name**, which is
deterministic and stable across replays. The IDs are stable regardless of
execution order, declaration order, or runtime conditions.

```
Parent DAG context ID:  1-2

Task IDs (named):
  task("fetch-data", ...)        →  1-2-T_fetch-data
  task("validate-content", ...)  →  1-2-T_validate-content
  task("publish-result", ...)    →  1-2-T_publish-result
```

The `T_` prefix is a reserved marker that:

- **Distinguishes DAG tasks from counter-based child operations**:
  `1-2-T_foo` vs `1-2-3` — no possible collision
- **Reserves the namespace** — no other SDK feature can produce IDs starting
  with `T_`
- **Is parseable enough for diagnostics** if needed

#### Why name-based instead of index-based

We considered using `T0`, `T1`, `T2` (registration-order indices) but rejected
this in favor of names because:

| Concern                                | Index-based (`T0`, `T1`)             | Name-based (`T_foo`)           |
| -------------------------------------- | ------------------------------------ | ------------------------------ |
| Reordering tasks in source code        | ❌ Shifts all subsequent IDs         | ✅ No effect                   |
| Adding a task in the middle            | ❌ Shifts all subsequent IDs         | ✅ Only new task gets new ID   |
| Forward-compat with dynamic tasks (v2) | ❌ Index depends on iteration order  | ✅ Name binds to data identity |
| Debuggability                          | ❌ Opaque (`T5` vs which task?)      | ✅ Self-describing             |
| In-flight execution during deploy      | ❌ Code changes break replay broadly | ✅ Only changed tasks affected |

The dynamic-task case is particularly important. In v2, code like:

```typescript
// v2 (hypothetical)
items.forEach((item) => {
  dagCtx.step(`process-${item.id}`, [], async () => process(item));
});
```

With index-based IDs, any filtering/sorting change in `items` shifts all
subsequent task indices, breaking replay broadly. With name-based IDs, the
ID binds to `item.id` — only added/removed items have ID changes.

#### Task name validation

To make names safe for use in entity IDs, we enforce:

- **Unique within the DAG scope** (already required by our type system)
- **Non-empty**
- **Maximum 100 characters** (keep IDs manageable)
- **Pattern**: `[a-zA-Z0-9_-]+` — alphanumeric, underscore, dash only
  - No spaces, no control characters
  - No `:` or other reserved separator characters that future features might use
  - The dash (`-`) is allowed in names since the SDK does not parse IDs;
    they are opaque keys used for checkpoint lookup

Validation runs at registration time. Invalid names throw
`DagInvalidTaskNameError` immediately.

#### Nested DAGs

The recursion works naturally — sub-DAGs are tasks in the parent:

```
Parent execution:           1
DAG declared as task:       1-2  (counter-based, the dag() call itself)
  Sub-DAG task "validation":  1-2-T_validation
    Sub-sub-task "rule-a":     1-2-T_validation-T_rule-a
    Sub-sub-task "rule-b":     1-2-T_validation-T_rule-b
  Other DAG task "decide":    1-2-T_decide
```

### Implementation requirement: explicit-ID variants for all operations

The DAG executor cannot use the standard operation handlers because they
call `createStepId()` to generate IDs from the counter. We need internal
primitives that accept pre-assigned entity IDs.

Each operation handler gets an explicit-ID variant. The signature is the
same as the public method except for the prepended `entityId` parameter:

```typescript
// Internal methods on DurableContextImpl, exposed only to the DAG executor
private runStepWithExplicitId<T>(
  entityId: string,                   // pre-assigned, e.g. "1-2-T_fetch"
  name: string,                        // human-readable
  fn: () => Promise<T>,
  options?: StepOptions,
): DurablePromise<T> {
  // Identical logic to step() but skip createStepId();
  // use provided entityId; do NOT increment counter.
}

// Same pattern for:
// - runInvokeWithExplicitId
// - runCallbackWithExplicitId
// - runWaitWithExplicitId
// - runWaitForConditionWithExplicitId
// - runMapWithExplicitId
// - runParallelWithExplicitId
// - runInChildContextWithExplicitId
// - runDagWithExplicitId
```

These are exposed only to the DAG executor; the public API is unchanged.

### Why the counter doesn't need to advance

The DAG itself takes one counter slot in its parent context (when
`context.dag(...)` is called, that consumes one parent-counter value to
produce the DAG's own context ID, e.g., `1-2`).

**Inside the DAG context, the counter is never used.** The `DagContext` is a
separate type that only exposes operation methods returning `TaskHandle`.
There are no operations on `DagContext` that call `createStepId()` — every
operation method ultimately calls an explicit-ID variant with a `T_{name}`
ID. So the counter in the DAG context stays at zero.

The `T_` prefix is also forward-compatible: even if a future change allowed
mixing counter-based operations with DAG tasks, the prefix would prevent
collisions (`T_foo` cannot collide with `1`, `2`, `3`...).

### Validation on replay

The replay validator already uses `validateReplayConsistency(entityId, ...)`.
For DAG tasks, the `entityId` will be `{parentId}-T_{taskName}`, which the
validator handles transparently — it doesn't care about the format, only that
the same entity ID maps to the same operation type/name across runs.

### What's stored in the operation summary

```typescript
interface DagSummary {
  totalCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  completionReason: string;
  taskNames: string[]; // declared task names, for diagnostics
}
```

Since IDs are derived directly from task names, no index map is needed —
the names themselves are the stable identifiers.

## Replay Determinism

The DAG feature relies on the existing replay machinery, plus the name-based
ID scheme described above:

1. **Registration callback is deterministic** — pure declarative JS that
   builds the graph from input data. Must not call non-deterministic APIs.
2. **Graph structure is identical on replay** — same registration produces
   same graph (same task names, same dependencies, same trigger rules).
3. **Each task has a stable entity ID** based on its name, not execution
   order — see [Entity ID Strategy](#entity-id-strategy-critical).
4. **Each task delegates to an existing handler's explicit-ID variant** —
   inheriting all existing checkpointing/replay machinery.
5. **Upstream task results are passed via closure** from the in-memory
   `results` map maintained by the scheduler. The map is rebuilt on each
   run from checkpoints, ensuring consistency.
6. **Replay reads task results from checkpoints** — same as map/parallel
   iterations today, just keyed on `T_{name}` IDs.
7. **Execution order on replay can vary** — but replay correctness depends
   only on stable IDs and topological order, not on execution order.

---

## Backward Compatibility

**Fully backward compatible** — pure addition.

- New top-level method `context.dag()` is added; no existing methods change
- New types (`DagContext`, `TaskHandle`, `DagResult`) are added; no existing types change
- No changes to `DurableContext` interface — `DagContext` is a separate type
- Existing applications continue to work without any changes
- Developers opt in by using `context.dag()` when they want DAG semantics

### Opt-in version compatibility

The feature uses the standard SDK feature-flag pattern (if any). Adding `dag()`
to the runtime is non-breaking even for clients that don't yet have it in their
type definitions.

---

## Examples

### Example 1: Diamond pattern

```typescript
const result = await context.dag("etl-pipeline", async (dagCtx) => {
  const fetch = dagCtx.step("fetch", [], async () => fetchSource());

  const transformA = dagCtx.step("transform-a", [fetch], async (deps) =>
    transformA(deps.fetch),
  );

  const transformB = dagCtx.step("transform-b", [fetch], async (deps) =>
    transformB(deps.fetch),
  );

  const merge = dagCtx.step("merge", [transformA, transformB], async (deps) =>
    merge(deps["transform-a"], deps["transform-b"]),
  );
});

console.log(result.getResult("merge"));
```

### Example 2: Mixed operation types — payment flow

```typescript
await context.dag("payment-flow", async (dagCtx) => {
  // STEP task
  const validate = dagCtx.step("validate", [], async () =>
    validateInput(event),
  );

  // INVOKE task — depends on validate, payload computed from deps
  const charge = dagCtx.invoke(
    "charge",
    "payment-fn:prod",
    [validate],
    async (deps) => ({ amount: deps.validate.amount }),
  );

  // CALLBACK task — wait for external approval
  const approval = dagCtx.callback(
    "approval",
    [charge],
    async (callbackId, deps) =>
      sendApprovalEmail(deps.charge.userId, callbackId),
    { timeout: { hours: 24 } },
  );

  // WAIT task — cooldown after approval
  const cooldown = dagCtx.wait("cooldown", [approval], { minutes: 5 });

  // CHILD CONTEXT task — multi-operation logic
  const finalize = dagCtx.runInChildContext(
    "finalize",
    [approval],
    async (ctx, deps) => {
      const audit = await ctx.step("audit", () => auditLog(deps.approval));
      await ctx.invoke("notify", "notify-fn:prod", deps.approval);
      return audit;
    },
  );
});
```

### Example 3: Compensation paths with trigger rules

```typescript
await context.dag("payment-flow", async (dagCtx) => {
  const charge = dagCtx.step("charge", [], async () => chargeCard(event));

  // Runs only if charge succeeded (default ALL_SUCCESS trigger rule)
  const fulfillOrder = dagCtx.step("fulfill", [charge], async (deps) =>
    fulfill(deps.charge),
  );

  // Runs only if charge failed (compensation) — ordering-only via .deps()
  const refund = dagCtx
    .step("refund", [], async () => refundCard(event))
    .deps(charge)
    .triggerRule("ALL_FAILED");

  // Runs after either path completes — ordering-only via .deps()
  const notify = dagCtx
    .step("notify", [], async () => notifyCustomer(event))
    .deps(fulfillOrder, refund)
    .triggerRule("ALL_DONE");
});
```

### Example 4: Tasks with mixed inline and ordering deps

```typescript
await context.dag("data-pipeline", async (dagCtx) => {
  const fetchA = dagCtx.step("fetch-a", [], async () => fetchA());
  const fetchB = dagCtx.step("fetch-b", [], async () => fetchB());
  const fetchC = dagCtx.step("fetch-c", [], async () => fetchC());

  // aggregate uses results from fetchA and fetchB (typed access via inline deps)
  // and ALSO waits for fetchC to finish (ordering-only via .deps())
  const aggregate = dagCtx
    .step("aggregate", [fetchA, fetchB], async (deps) =>
      combine(deps["fetch-a"], deps["fetch-b"]),
    )
    .deps(fetchC)
    .triggerRule("NONE_FAILED");

  const publish = dagCtx.step("publish", [aggregate], async (deps) =>
    publishResult(deps.aggregate),
  );
});
```

### Example 5: Nested DAGs

```typescript
await context.dag("validation-pipeline", async (dagCtx) => {
  const fetch = dagCtx.step("fetch", [], async () => fetchContent(event));

  // Nested DAG as a task — runs as a unit, depends on fetch
  const validation = dagCtx.dag("validation", [fetch], async (subDagCtx) => {
    const formatCheck = subDagCtx.step("format", [], async () => checkFormat());
    const safetyCheck = subDagCtx.step("safety", [], async () => checkSafety());
    const aggregate = subDagCtx.step(
      "aggregate",
      [formatCheck, safetyCheck],
      async (deps) => combineChecks(deps.format, deps.safety),
    );
  });

  // The sub-DAG's result is a DagResult — depend on it like any other task
  const decide = dagCtx.step("decide", [validation], async (deps) =>
    makeDecision(deps.validation.getResult("aggregate")),
  );
});
```

### Example 6: With completion config (custom predicate)

```typescript
await context.dag(
  "rules-engine",
  async (dagCtx) => {
    config.rules.map((rule) =>
      dagCtx.step(`rule-${rule.id}`, [], async () => evaluateRule(rule)),
    );
  },
  {
    maxConcurrency: 5,
    completionConfig: {
      shouldComplete: (state) => {
        const rejected = state.results
          .filter((r) => r.status === "SUCCEEDED")
          .filter((r) => (r.result as any).verdict === "REJECT");

        return rejected.length > 0
          ? { complete: true, reason: "FAILED_RULE_REACHED" }
          : undefined;
      },
    },
  },
);
```

### Example 7: Value-based branching with `runIf`

A content moderation pipeline where exactly one downstream task runs based
on the classifier's verdict.

```typescript
await context.dag("content-moderation", async (dagCtx) => {
  const fetch = dagCtx.step("fetch", [], async () => fetchContent(event));

  const classify = dagCtx.step(
    "classify",
    [fetch],
    async (deps) => classifyContent(deps.fetch),
    // returns "safe" | "review" | "block"
  );

  // Each downstream task runs only if classify produced its verdict
  const publish = dagCtx.step(
    "publish",
    [classify],
    async (deps) => publishContent(deps.classify),
    { runIf: (deps) => deps.classify === "safe" },
  );

  const review = dagCtx.step(
    "review",
    [classify],
    async (deps) => sendForReview(deps.classify),
    { runIf: (deps) => deps.classify === "review" },
  );

  const blocked = dagCtx.step(
    "blocked",
    [classify],
    async (deps) => logBlocked(deps.classify),
    { runIf: (deps) => deps.classify === "block" },
  );

  // Final task always runs (ALL_DONE) and reports outcome
  const audit = dagCtx
    .step("audit", [], async () => recordAuditTrail(event))
    .deps(publish, review, blocked)
    .triggerRule("ALL_DONE");
});
```

When `classify` returns `"safe"`:

- `publish` runs (predicate true)
- `review` is SKIPPED (predicate false, `skipReason: "RUN_IF_PREDICATE"`)
- `blocked` is SKIPPED (predicate false, `skipReason: "RUN_IF_PREDICATE"`)
- `audit` runs (`ALL_DONE` accepts skipped upstream)

### Example 8: Short-circuit with `runIf`

A precondition check that skips the entire downstream pipeline if the
input fails validation. Other downstream paths can still run via different
trigger rules.

```typescript
await context.dag("data-pipeline", async (dagCtx) => {
  const validate = dagCtx.step("validate", [], async () => isValidInput(event));
  // returns boolean

  // All downstream processing skips if validate returns false
  const process = dagCtx.step(
    "process",
    [validate],
    async (deps) => processData(event),
    { runIf: (deps) => deps.validate === true },
  );

  const enrich = dagCtx.step("enrich", [process], async (deps) =>
    enrichData(deps.process),
  );

  // Compensation: log when validation fails
  const logInvalid = dagCtx.step(
    "log-invalid",
    [validate],
    async () => logInvalidInput(event),
    { runIf: (deps) => deps.validate === false },
  );
});
```

---

## Deferred to v2

The following features are explicitly out of scope for v1, but the API design
must not preclude adding them later.

### v2.1: Dedicated branch operation

Airflow's `BranchPythonOperator` is a specialized task that returns the names
of downstream tasks to run, skipping all others. **The most common branching
use cases are already covered in v1 by the `runIf` predicate** (see
[Example 7](#example-7-value-based-branching-with-runif)).

A dedicated `branch` operation could provide additional benefits over `runIf`:

- **Single source of truth** — branching logic lives in one task instead of
  being distributed across multiple `runIf` predicates
- **DAG visualization** — visualizers can show explicit branching points
- **Compile-time validation** — branch can declare which downstream tasks
  it can choose between

```typescript
// Hypothetical v2 API
const branch = dagCtx
  .step("decide-path", [], async () => {
    const data = await fetchData();
    return data.isPremium ? ["premium-flow"] : ["standard-flow"];
  })
  .branchTo([premiumFlow, standardFlow]);
```

Deferred to v2 because `runIf` covers the immediate need.

### v2.2: Dynamic task creation

Tasks that spawn additional tasks at runtime (Airflow TaskFlow API). Replay
determinism makes this complex — the spawned tasks need stable names across
replays.

### v2.3: Cross-task resource pools

Airflow's Pools — semaphores that limit concurrency across multiple tasks
accessing a shared resource (e.g., max 3 concurrent calls to a flaky API).

```typescript
// Hypothetical v2 API
const dbPool = context.createPool("db", { maxConcurrency: 3 });

dagCtx.step("query-1", [], async () => dbQuery1(), { pool: dbPool });
dagCtx.step("query-2", [], async () => dbQuery2(), { pool: dbPool });
```

### v2.4: Pre-built operators

Companion package `@aws/durable-execution-sdk-js-operators` providing typed
wrappers for common AWS service calls.

---

## Open Questions

1. **`maxConcurrency` semantics for nested DAGs** — should the parent's limit
   constrain sub-DAG tasks too, or only top-level tasks? Recommendation: parent
   limit applies only to top-level; each sub-DAG has its own scope. Document
   clearly.

2. **Task naming uniqueness** — must task names be globally unique within a DAG
   (including nested DAGs)? Recommendation: unique within the immediate
   `DagContext` scope; nested DAGs have their own scope.

3. **`signal()` from within a DAG task** — does our separately-proposed signal
   mechanism apply to DAG tasks? Recommendation: yes, with the same semantics
   (stops new tasks from starting; in-flight tasks complete naturally).

4. **Async registration callback** — should `register` be allowed to be async?
   Useful for cases like `for (const x of await fetchConfig()) dagCtx.step(...)`.
   Risk: registration could become non-deterministic if it does IO.
   Recommendation: allow async, but document strongly that registration must
   be deterministic on replay.

5. **Memory cost for very large DAGs** — task graphs with thousands of nodes
   could consume significant memory. Should we cap or warn? Recommendation:
   document recommended graph size; defer hard limits to v2.

---

## Appendix: Comparison with Airflow

| Feature                                | Airflow                      | Proposed v1                                      | Notes                                                                    |
| -------------------------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| DAG definition                         | Python files                 | TypeScript registration callback                 |                                                                          |
| Task dependencies                      | `>>`, `<<`, `set_downstream` | Inline deps (typed) or `.deps()` (ordering-only) | Both styles supported                                                    |
| Trigger rules                          | Yes                          | Yes                                              | Same set of rules                                                        |
| XComs                                  | Push/pull                    | Function arguments                               | Cleaner — typed deps map                                                 |
| Branching (`BranchPythonOperator`)     | `BranchPythonOperator`       | `runIf` predicate per task                       | v1 covers common cases via `runIf`; dedicated `branch` op deferred to v2 |
| Short-circuit (`ShortCircuitOperator`) | `ShortCircuitOperator`       | `runIf` predicate per task                       | Same primitive as branching                                              |
| Sensors                                | `BaseSensorOperator`         | `waitForCondition`                               | Existing primitive                                                       |
| Pools                                  | Yes                          | Deferred to v2                                   |                                                                          |
| TaskGroups                             | Yes                          | Via nested `dag()`                               | Composes naturally                                                       |
| Operators                              | Hundreds                     | Deferred to companion package                    |                                                                          |
| Scheduling                             | Built-in                     | EventBridge Scheduler                            | External                                                                 |
| UI                                     | Built-in                     | AWS Console execution history                    | External                                                                 |
| Backfilling                            | Yes                          | Not applicable                                   | Different model                                                          |
| Dynamic tasks                          | Yes (TaskFlow)               | Deferred to v2                                   |                                                                          |

---

## Changelog

- **2026-05-17** — Initial draft
- **2026-05-17** — Reframed `DagContext` as a separate type with its own
  operation methods (`step`, `invoke`, `callback`, `wait`,
  `runInChildContext`, `map`, `parallel`, `dag`). Mandatory name on all
  operations. Inline deps for typed access + `.deps()` builder for
  ordering-only. Implementation reuses existing handlers via internal
  explicit-ID variants. Removed obsolete `task()` method.
- **2026-05-17** — Mandatory deps array on every operation (possibly empty).
  Replaces the with-deps/without-deps overload pair with a single uniform
  signature per operation. TypeScript narrows the function parameter
  conditionally based on whether deps is empty (using `StepFn<TDeps, TResult>`
  and similar types).
- **2026-05-18** — Added `runIf` predicate (`ConditionalConfig<TDeps>`) on
  every operation's options. Predicate is evaluated against the typed
  upstream deps map; if it returns `false`, the task is `SKIPPED` with
  `skipReason: "RUN_IF_PREDICATE"`. Covers Airflow's `BranchPythonOperator`
  and `ShortCircuitOperator` use cases. The dedicated `branch` operation
  remains deferred to v2 as syntactic sugar over the same skip mechanism.
