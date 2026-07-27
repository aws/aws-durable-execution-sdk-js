# DAG Support (`durable.Dag(...)`) — Go Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable.
>
> **Required API annotation (Go).** Every exported DAG symbol's doc comment ends with an `// Experimental:` paragraph (the standard Go pre-stable doc-comment convention).
>
> ```go
> // Dag declares and runs a directed acyclic graph of tasks. ...
> //
> // Experimental: This API is experimental and may be changed or removed in
> // future releases.
> func Dag(ctx Context, name string, register func(d *DagBuilder), opts ...DagOption) (*DagResult, error)
> ```

Status: **Implemented** · **Stability: Experimental** · Package: `durable` (in `go-alpha`) · Scope: the Go realization of the canonical JS/TS design ([`DAG_SPEC.md`](./DAG_SPEC.md)) and the cross-language normative core ([`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md)).

The DAG feature is a single flat package: it lives in `durable` alongside the core operations (`Step`, `Wait`, `Invoke`, `RunInChildContext`, `Map`, `Parallel`, `WaitForCondition`, `WaitForCallback`), reusing the SDK's positional+hashed operation IDs, per-operation checkpoint fast-path replay, replay-consistency validation, child-context scope isolation, large-payload offload via `ReplayChildren`, goroutine-ownership-safe concurrent child contexts, invocation-wide suspension, value-typed errors, and the local test runner (`durable/durabletest`).

---

## 1. Overview

The DAG layer lets a handler declare a graph of named tasks with dependencies, trigger rules, conditional execution (`runIf`), and threshold/custom completion, then runs them with bounded concurrency while preserving the SDK's replay/checkpoint guarantees.

The parts of the design that constitute the **durability contract** — the reserved `DAG_NODE_T_` delimiter, no-dash task names, the injectivity guarantee, topological scheduling with readiness/trigger-rule/`runIf` semantics, the completion-reason core+superset layering, and the drain-by-default failure model — are string- and algorithm-level decisions that are identical across all four language SDKs and are enforced here verbatim. Go's concurrency model (goroutines + a bounded worker pool + `context.Context` cancellation) hosts the topological scheduler directly.

**Surface ergonomics are shaped by Go generics limits (Go 1.25).** The fluent, deeply type-inferred JS API is not reproducible. Task registration uses **free functions** (`durable.DagStep[T](d, ...)`) rather than methods, because Go methods cannot declare type parameters. Typed dependency access uses a **map-based `Deps` + generic accessor** (`durable.Get[T](deps, handle)`). Error handling is value-based: task failures live inside `DagResult.ThrowIfError()`, while registration/validation failures surface as the `error` return of `durable.Dag(...)`.

The result-type data-flow guarantee is partially preserved: result _types_ are retained via `TaskHandle[T]` (so `Get`/`Result` return concrete types with no manual assertion), but _compile-time key checking_ of `deps.<name>` is lost — a wrong handle yields `ErrDepNotAvailable` at run time rather than a compile error.

---

## 2. Go public API

All symbols are exported from the `durable` package. Registration functions carry a `Dag` prefix (`DagStep`, `DagInvoke`, `DagCallback`, `DagWait`, `DagWaitForCondition`, `DagChild`, `DagMap`, `DagParallel`, `SubDag`) so they never collide with the core operation functions of the same base name (`Step`, `Invoke`, `Map`, ...).

Relevant source files:

```
durable/dag.go            // Dag() entry, scope materialization, runDagRegister panic-recovery wrapper
durable/dag_options.go    // DagBuilder, functional DagOption set, per-op applicability
durable/dag_registration.go // DagStep/DagInvoke/.../SubDag free functions
durable/dag_handle.go     // TaskHandle[T], AnyHandle, After/WithTrigger, dagTaskDef
durable/dag_deps.go       // Deps, Get[T], MustGet[T]
durable/dag_trigger.go    // TriggerRule consts + evaluators
durable/dag_completion.go // DagCompletionConfig/Status, CompletionDecision, DagCompletionReason
durable/dag_scheduler.go  // topological scheduler (bounded goroutine pool)
durable/dag_result.go     // DagResult, TaskExecution, the canonical container envelope
durable/dag_validate.go   // name/duplicate/missing-dep/cycle validation
durable/dag_errors.go     // typed error values
```

### 2.1 Entry point (free function — NOT a method)

Task registration and the DAG entry are free functions taking the durable `Context` interface as the first argument, because Go methods cannot be generic and the core operations follow the same convention (`durable.Step[O](ctx, ...)`, `durable.Map[TIn, TOut](ctx, ...)`).

```go
// ctx is the base durable Context interface.
// Returns (*DagResult, error):
//   - err != nil        => registration/validation/config failure (nothing was
//                          scheduled): *DagValidationError, a cycle error, or
//                          *DagInvalidConfigError; *DagRegistrationError when the
//                          register callback panicked; *DagPredicateError when a
//                          task's runIf predicate panicked (a defect that ABORTS
//                          the DAG). On suspension it propagates the SDK's internal
//                          suspend signal so the invocation pauses.
//   - err == nil        => the DAG drained (or early-completed). Individual task
//                          failures (including a panicking task BODY) are reported
//                          INSIDE the result: res.ThrowIfError() != nil.
func Dag(
    ctx Context,
    name string,
    register func(d *DagBuilder),
    opts ...DagOption,
) (*DagResult, error)
```

[GO DIVERGENCE — no exceptions] JS splits outcomes into "promise rejects" (validation) vs "promise resolves with `DagResult`" (task failures). Go collapses this into the idiomatic `(*DagResult, error)` two-channel return: `error` = the JS reject cases; `DagResult.ThrowIfError()` = the JS `throwIfError()` case, matching the SDK's existing `BatchResult.ThrowIfError() error`.

### 2.2 `DagBuilder` (registration handle) — methods are NOT generic

Because Go methods cannot have type parameters, `DagBuilder` exposes no generic registration methods. It is an opaque handle threaded into the register callback and passed to the free registration functions. It carries the ordered task registry, name set, accumulated registration errors, and the DAG-level default serdes.

```go
type DagBuilder struct {
    // unexported: ordered []*dagTaskDef, byName index, accumulated regErrs,
    // and the DAG-level default serdes.
}
```

### 2.3 Task registration — free functions (the core divergence)

Each JS `dagCtx.<kind>(...)` method is a free function `durable.Dag<Kind>[T](d *DagBuilder, ...)`. This is the only way to obtain a type parameter on the returned `TaskHandle[T]`.

```go
// ── task-fn shapes (deps-first, uniform) ─────────────────────────────────
type DagStepFunc[T any]      func(deps Deps, sctx StepContext) (T, error)
type DagPayloadFunc[In any]  func(deps Deps) (In, error)
type DagSubmitterFunc        func(deps Deps, sctx StepContext, callbackID string) error
type DagCheckFunc[S any]     func(deps Deps, state S, sctx StepContext) (S, error)
type DagChildFunc[T any]     func(deps Deps, cctx Context) (T, error)
type DagItemsFunc[In any]    func(deps Deps) []In
type DagMapFunc[In, Out any] func(cctx Context, item In, index int) (Out, error)

// ── step ─────────────────────────────────────────────────────────────────
func DagStep[T any](
    d *DagBuilder, name string, deps []AnyHandle,
    fn DagStepFunc[T], opts ...DagOption,
) TaskHandle[T]

// ── invoke ─────────────────────────────────────────────────────────────────
func DagInvoke[In, Out any](
    d *DagBuilder, name string, functionARN string, deps []AnyHandle,
    payload DagPayloadFunc[In], opts ...DagOption,
) TaskHandle[Out]

// ── callback (submitter-based) ──────────────────────────────────────────────
func DagCallback[T any](
    d *DagBuilder, name string, deps []AnyHandle,
    submit DagSubmitterFunc, opts ...DagOption,
) TaskHandle[T]

// ── wait (no result) ───────────────────────────────────────────────────────
func DagWait(
    d *DagBuilder, name string, deps []AnyHandle,
    duration time.Duration, opts ...DagOption,
) TaskHandle[Void] // Void = struct{}

// ── waitForCondition ────────────────────────────────────────────────────────
// The initial state is a POSITIONAL parameter; the completion predicate travels
// in opts via WithCondition and is REQUIRED — an omission is recorded as a
// *DagInvalidConfigError at registration.
func DagWaitForCondition[S any](
    d *DagBuilder, name string, deps []AnyHandle,
    initial S, check DagCheckFunc[S], opts ...DagOption,
) TaskHandle[S]

// ── runInChildContext ───────────────────────────────────────────────────────
func DagChild[T any](
    d *DagBuilder, name string, deps []AnyHandle,
    fn DagChildFunc[T], opts ...DagOption,
) TaskHandle[T]

// ── map ─────────────────────────────────────────────────────────────────────
func DagMap[In, Out any](
    d *DagBuilder, name string, deps []AnyHandle,
    items DagItemsFunc[In], mapFn DagMapFunc[In, Out], opts ...DagOption,
) TaskHandle[BatchResult[Out]]

// ── parallel ────────────────────────────────────────────────────────────────
// Branch[Out]{Name, Func} is the core parallel-branch type (named branches aid
// observability and result access).
func DagParallel[Out any](
    d *DagBuilder, name string, deps []AnyHandle,
    branches []Branch[Out], opts ...DagOption,
) TaskHandle[BatchResult[Out]]

// ── nested dag ──────────────────────────────────────────────────────────────
func SubDag(
    d *DagBuilder, name string, deps []AnyHandle,
    register func(sub *DagBuilder), opts ...DagOption,
) TaskHandle[*DagResult]
```

[GO DIVERGENCE — uniform fn shape] Unlike JS (which uses conditional types so a root task's fn omits `deps`), **every** task fn takes `deps Deps` as its first parameter, even when `deps` is `nil`. Go has neither conditional types nor overloading, so a single uniform shape is the only option. The native operation args (`StepContext`, `callbackID`, `state`, the child `Context`) follow `deps`, preserving the "deps-first" rule.

[GO DIVERGENCE — result-type inference gaps: `DagInvoke`/`DagCallback` require explicit type args] For task kinds whose result type parameter appears **only in the returned `TaskHandle[T]`** and in no function-argument position, Go's type inference cannot resolve it (return types do not participate in inference), so callers MUST supply it explicitly:

- **`DagInvoke[In, Out]`** — `Out` appears only in the return; `In` is inferred from `payload`. Because Go's partial inference is prefix-only, specifying `Out` forces specifying `In` too: callers write `durable.DagInvoke[InType, OutType](d, ...)`.
- **`DagCallback[T]`** — `T` appears only in the return (`DagSubmitterFunc` does not mention it). Callers write `durable.DagCallback[ResultType](d, ...)`.

All other kinds infer their result type from the task fn / arguments and need no explicit type args: `DagStep[T]` (from the fn's return), `DagWaitForCondition[S]` (from the `initial` param + return), `DagChild[T]` (from the fn's return), `DagMap[In, Out]` (from `mapFn`), `DagParallel[Out]` (from `[]Branch[Out]`); `DagWait` and `SubDag` have no free result type parameter.

**Diamond example:**

```go
res, err := durable.Dag(ctx, "etl", func(d *durable.DagBuilder) {
    fetch := durable.DagStep(d, "fetch", nil,
        func(_ durable.Deps, s durable.StepContext) (Source, error) { return fetchSource() })

    a := durable.DagStep(d, "ta", []durable.AnyHandle{fetch},
        func(deps durable.Deps, s durable.StepContext) (A, error) {
            src, _ := durable.Get(deps, fetch) // typed: src is Source
            return transformA(src)
        })

    b := durable.DagStep(d, "tb", []durable.AnyHandle{fetch},
        func(deps durable.Deps, s durable.StepContext) (B, error) {
            src, _ := durable.Get(deps, fetch)
            return transformB(src)
        })

    durable.DagStep(d, "merge", []durable.AnyHandle{a, b},
        func(deps durable.Deps, s durable.StepContext) (Out, error) {
            av, _ := durable.Get(deps, a) // typed: av is A
            bv, _ := durable.Get(deps, b) // typed: bv is B
            return merge(av, bv)
        })
})
if err != nil { return err }                              // registration/validation error
if err := res.ThrowIfError(); err != nil { return err }   // >=1 task FAILED
```

### 2.4 `TaskHandle[T]` and `AnyHandle`

```go
// AnyHandle is a sealed heterogeneous handle for dependency lists ([]AnyHandle)
// and internal storage. Its methods are unexported so it cannot be implemented
// outside the package.
type AnyHandle interface {
    taskName() string
    taskID() string
    kindOf() dagResultKind
}

// TaskHandle carries the result type T as a phantom so Get/Result return the
// task's value with its concrete type. It holds the task name, id, result kind,
// and a back-reference to the task definition (for the builder methods).
type TaskHandle[T any] struct { /* name, id, kind, def (unexported) */ }

// ── builder (chainable; mutates the underlying task definition) ──
func (h TaskHandle[T]) After(deps ...AnyHandle) TaskHandle[T]     // ordering-only edges
func (h TaskHandle[T]) WithTrigger(rule TriggerRule) TaskHandle[T] // set trigger rule
```

[GO DIVERGENCE — chaining works, registration does not chain] Builder _mutation_ methods (`After`, `WithTrigger`) are legal methods because they do not introduce a new type parameter — they return `TaskHandle[T]`. But _registration_ (`DagStep`, `DagInvoke`, ...) must be free functions because they mint a _new_ `T`. So Go reads `h := durable.DagStep(d, ...)` then `h.After(x).WithTrigger(durable.AllDone)`, not JS's `dagCtx.step(...).after(x).triggerRule(...)`. `After` adds ordering-only edges (upstream results are NOT injected into `Deps`), distinct from the inline `deps` passed at registration.

### 2.5 `Deps` and the generic accessor

```go
// Deps is the in-memory, single-invocation view of resolved upstream results
// passed to a task body and its runIf predicate: the actual Go values produced
// by inline dependencies that SUCCEEDED this run, keyed by task name. Failed,
// skipped, and ordering-only deps are absent.
type Deps struct { /* m map[string]any (unexported) */ }

// Get returns the typed result of the upstream task referenced by h:
//   - (value, nil)                 dep succeeded and the type matches
//   - (zero, ErrDepNotAvailable)   dep absent (FAILED/SKIPPED/not-inline)
//   - (zero, ErrDepTypeMismatch)   stored value is not a T (serdes edge)
func Get[T any](d Deps, h TaskHandle[T]) (T, error)

// MustGet panics on error, for call sites that treat a missing ALL_SUCCESS dep
// as a programming bug.
func MustGet[T any](d Deps, h TaskHandle[T]) T
```

[GO DIVERGENCE — typed deps without literal-name access] This is the single biggest expressiveness change from JS:

- The **result type is preserved** — `durable.Get(deps, fetch)` returns `Source` because `fetch` is `TaskHandle[Source]`; no manual type assertion is needed. This is better than a bare `map[string]any`.
- The **key is not compile-time-checked against the deps list** — calling `Get` with a handle not in this task's deps returns `ErrDepNotAvailable` at run time rather than a compile error (JS rejects this at compile time via `DepsMap<TDeps>`).

### 2.6 `TriggerRule`, `runIf`

```go
type TriggerRule string

const (
    AllSuccess TriggerRule = "ALL_SUCCESS" // default (also the empty value)
    AllFailed  TriggerRule = "ALL_FAILED"
    AllDone    TriggerRule = "ALL_DONE"
    AnySuccess TriggerRule = "ANY_SUCCESS"
    AnyFailed  TriggerRule = "ANY_FAILED"
    NoneFailed TriggerRule = "NONE_FAILED"
)

// runIf is supplied via WithRunIf(func(deps Deps) bool) — a synchronous,
// deterministic, pure predicate.
```

[GO DIVERGENCE — open enum] Go string-const enums are open: `TriggerRule("bogus")` is a valid value at compile time. A runtime guard in `dag_validate.go` rejects unknown rules (`DagInvalidTriggerRuleError`). The truth table (including empty-upstream rows and the `len > 0` guard on the failure-family rules) ports verbatim as a `map[TriggerRule]func([]TaskStatus) bool` (§5.2). `SKIPPED` counts as neither success nor failure.

### 2.7 `DagResult`, `TaskExecution`

```go
type TaskStatus string
const (
    StatusSucceeded TaskStatus = "SUCCEEDED"
    StatusFailed    TaskStatus = "FAILED"
    StatusSkipped   TaskStatus = "SKIPPED"
    StatusStarted   TaskStatus = "STARTED" // in-flight at early completion only (§5.6); never persisted as terminal
)

type SkipReason string
const (
    SkipTriggerRule SkipReason = "TRIGGER_RULE"
    SkipRunIf       SkipReason = "RUN_IF_PREDICATE"
)

type TaskExecution struct {
    Name        string
    Status      TaskStatus
    SkipReason  SkipReason // set only when Status == SKIPPED
    Err         error      // set only when Status == FAILED
    StartedAt   time.Time
    CompletedAt time.Time
    // unexported: result (in-memory value, present only when SUCCEEDED),
    // rawResult (JSON on the replay/deser path), kind (recursive-restore discriminator).
}

type DagResult struct { /* unexported: ordered executions, byName index, reason, total */ }

// Typed getters — free functions (need T).
func Result[T any](r *DagResult, h TaskHandle[T]) (T, error)
func ResultByName[T any](r *DagResult, name string) (T, error)

func (r *DagResult) Status(nameOrHandle any) (TaskStatus, bool) // false => never started
func (r *DagResult) Succeeded() []TaskExecution
func (r *DagResult) Failed() []TaskExecution
func (r *DagResult) Skipped() []TaskExecution
func (r *DagResult) Results() map[string]TaskExecution // copy

func (r *DagResult) SucceededCount() int
func (r *DagResult) FailureCount() int
func (r *DagResult) SkippedCount() int
func (r *DagResult) TotalCount() int // number of REGISTERED tasks (fixed; independent of early completion)
func (r *DagResult) CompletionReason() DagCompletionReason

// Returns *DagExecutionError (wrapping the first failed task's Err via Unwrap)
// when FailureCount() > 0 OR CompletionReason() == CustomCompletionFailed; else nil.
func (r *DagResult) ThrowIfError() error
```

The count and `SucceededCount`/`FailureCount`/`SkippedCount` spellings match `BatchResult` so customers see one vocabulary across a DAG result and a nested Map/Parallel `BatchResult` at the same call site. `TotalCount` is the registered-task count: never-started tasks are absent from the per-task executions but still counted here.

### 2.8 Completion reason — core base + Go superset

The shared base vocabulary is owned by the core (shared with Map/Parallel); the DAG adds exactly one member. Go models the DAG reason as a defined `string` type whose values share the core wire vocabulary.

```go
type DagCompletionReason string
const (
    AllCompleted              DagCompletionReason = "ALL_COMPLETED"
    MinSuccessfulReached      DagCompletionReason = "MIN_SUCCESSFUL_REACHED"
    FailureToleranceExceeded  DagCompletionReason = "FAILURE_TOLERANCE_EXCEEDED"
    CustomCompletionSucceeded DagCompletionReason = "CUSTOM_COMPLETION_SUCCEEDED"
    CustomCompletionFailed    DagCompletionReason = "CUSTOM_COMPLETION_FAILED"
    // DAG-only superset member:
    CompletedWithFailures     DagCompletionReason = "COMPLETED_WITH_FAILURES"
)
```

[GO DIVERGENCE — no closed union] JS enforces `DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES"` at the type level. Go cannot express a closed union, so `CompletedWithFailures` is simply another `DagCompletionReason` const. The wire strings are identical across SDKs, and the dependency direction (`dag → core`, never `dag → batch`) is honored: the DAG's reason type reuses the core wire vocabulary and adds one member.

Semantics: default drain ⇒ `AllCompleted` if all reachable tasks succeeded/skipped, else `CompletedWithFailures`; `ThrowIfError()` keys off `FailureCount()` (and `CustomCompletionFailed`).

### 2.9 Options (functional options)

```go
type DagOption func(*dagConfig)

// Task-level
func WithTriggerRule(r TriggerRule) DagOption
func WithRunIf(pred func(deps Deps) bool) DagOption
func WithTaskRetry(s RetryStrategy) DagOption      // Step, Callback submitter, WaitForCondition
func WithDagTaskSerdes(s Serdes) DagOption          // per-task result serializer (non-generic Serdes)
func WithTaskTimeout(d time.Duration) DagOption     // Callback / WaitForCondition
func WithCondition[S any](pred func(S) bool) DagOption // WaitForCondition; REQUIRED for that kind
func WithBatchMaxConcurrency(n int) DagOption       // inner fan-out of a Map/Parallel task

// DAG-level (passed to durable.Dag / SubDag)
func WithDagMaxConcurrency(n int) DagOption
func WithDefaultTriggerRule(r TriggerRule) DagOption
func WithDagSerdes(s Serdes) DagOption              // DAG-level default result serializer
func WithDagCompletion(cc DagCompletionConfig) DagOption
```

[GO DIVERGENCE — typed options] `WithDagTaskSerdes`/`WithDagSerdes` are non-generic because the core `Serdes` interface is non-generic (it works over `any`). The one option that needs a type parameter — `WithCondition[S]` — is a **generic free function returning `DagOption`**, legal because it is a function, not a method; it stashes an `S`-erased predicate into the config, resolved back to `func(S) bool` at run time.

[GO DIVERGENCE — per-operation option applicability] Each option records which builder set it; at registration the builder rejects an option applied to a task kind that does not honor it, recording a `*DagInapplicableOptionError` (e.g. `WithTaskTimeout` on a `DagStep`). `SubDag` accepts every option because its `opts` slice is forwarded to both the task level and the nested DAG level.

**Concurrency defaults.** `DefaultDagMaxConcurrency` is `40`. When `WithDagMaxConcurrency` is unset, the DAG runs at most 40 top-level tasks concurrently — **not** unbounded. `WithDagMaxConcurrency(n)` with `n <= 0` is a configuration error (`*DagInvalidConfigError`), rejected before the scope is entered. An explicit value always wins, including a value above 40. The bound governs only this DAG's top-level tasks: a Map/Parallel task's inner fan-out is bounded separately by `WithBatchMaxConcurrency`, and a nested `SubDag` resolves its own independent default of 40 (because `SubDag` runs its nested graph back through `Dag`). Because `<= 0` is rejected and an unset bound resolves to 40, the public API can no longer express a genuinely unbounded scheduler; a caller who wants effectively-unbounded top-level concurrency passes a bound at least as large as the task count (e.g. `math.MaxInt32`).

> Rationale for the `<= 0` rejection: the default is a resource bound, not a scheduling preference. An unbounded wide graph would spawn one goroutine (and, in sibling SDKs, one OS thread / pool slot) per ready task inside a constrained Lambda sandbox. A single shared value across languages makes a graph behave identically everywhere; forbidding `<= 0` prevents a caller from accidentally re-opening the unbounded behavior the default exists to close.

### 2.10 `DagCompletionConfig` (threshold or results-aware custom predicate)

```go
type CompletionOutcome int
const (
    OutcomeSucceeded CompletionOutcome = iota + 1
    OutcomeFailed
)

type CompletionDecision struct{ /* opaque */ }
func (d CompletionDecision) ShouldComplete() bool
func (d CompletionDecision) Outcome() CompletionOutcome
func ContinueDag() CompletionDecision                     // keep scheduling
func CompleteDag(outcome CompletionOutcome) CompletionDecision // complete now

type DagCompletionItemStatus struct {
    Name       string
    Status     TaskStatus // incl. SKIPPED; zero value "" => not started
    SkipReason SkipReason
    // unexported: result (present only when SUCCEEDED)
}
func ResultOf[T any](s DagCompletionItemStatus) (T, bool)  // typed access to item result

type DagCompletionStatus struct {
    SuccessCount, FailureCount, SkippedCount, CompletedCount, TotalCount int
    Items   []DagCompletionItemStatus            // settled tasks, registration order
    Results map[string]DagCompletionItemStatus   // terminal tasks by name
}

type DagCompletionConfig struct {
    // Custom mode (results-aware; sees per-task results and SKIPPED):
    ShouldComplete func(status DagCompletionStatus) CompletionDecision
    // OR threshold mode (result-blind), reused from core batch semantics:
    MinSuccessful              *int
    ToleratedFailureCount      *int
    ToleratedFailurePercentage *float64
}
```

The custom `ShouldComplete` predicate is re-evaluated each time a task settles (including on a skip), sees per-task results and `SKIPPED`, and can complete the DAG early with a success or failure outcome (mapped to `CustomCompletionSucceeded`/`CustomCompletionFailed`). The threshold half reuses the core Map/Parallel completion semantics unchanged. The two modes are **mutually exclusive**: setting both a threshold field and `ShouldComplete` is a `*DagInvalidConfigError`, enforced at validation (Go cannot type-level-exclude fields the way JS `never` does).

---

## 3. Per-decision mapping (JS design → Go realization)

Legend: **Ports** = carries over essentially unchanged · **Adapts** = same intent, different Go mechanism · **Deferred** = not offered in v1.

| #   | JS decision (DAG_SPEC.md §)                                        | Go disposition           | How / why                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `context.dag()` entry (§2.1)                                       | **Adapts**               | `(*DagResult, error)` return; no promises/exceptions.                                                                                                                                                                        |
| 2   | `DagContext` with a method per task kind (§2.2)                    | **Adapts (major)**       | Go methods can't have type params → **free functions** `durable.DagStep[T](d, ...)`. `DagBuilder` is an opaque handle. Result type is inferred for most kinds; `DagInvoke[In,Out]` / `DagCallback[T]` require explicit args. |
| 3   | `TaskHandle[T]` + `.after()/.triggerRule()` builder (§2.4)         | **Ports**                | Generic struct with phantom `T`; `After`/`WithTrigger` return `TaskHandle[T]` (no new type param ⇒ legal methods). `AnyHandle` sealed interface for heterogeneous deps.                                                      |
| 4   | `DepsMap<TDeps>` literal-name typed access (§2.5)                  | **Infeasible → Adapts**  | No mapped/template-literal types. `Deps` map + `durable.Get[T](deps, handle)`. Result **type preserved**; **key-membership check lost** (runtime `ErrDepNotAvailable`).                                                      |
| 5   | Conditional deps-first fn collapse (§2.3)                          | **Adapts**               | No conditional types/overloading → uniform `func(deps Deps, native…) (T, error)`; `deps` empty for roots.                                                                                                                    |
| 6   | Positional typed deps ergonomics                                   | **Deferred**             | Arity helpers (`DagStep2/3`) don't fit arbitrary fan-in + builder deps; the map + `Get` accessor is the general mechanism.                                                                                                   |
| 7   | Name-based entity IDs (§4.2)                                       | **Ports**                | Tasks run under a name-based id `{scopeId}-DAG_NODE_T_{name}`, minted via `opIDs.named`/`childNamed` (§4). Composed once, MD5-hashed at the wire boundary.                                                                   |
| 8   | Reserved `DAG_NODE_T_` delimiter + no-dash names + injectivity     | **Ports**                | `^[a-zA-Z0-9_]+$` + reserved-substring check (`dag_validate.go`). The no-dash decomposition proof is language-independent.                                                                                                   |
| 9   | `TriggerRule` union + default (§2.7)                               | **Ports (open enum)**    | `type TriggerRule string` + consts; unknown values runtime-rejected. Truth table ports verbatim.                                                                                                                             |
| 10  | `runIf` sync predicate (§2.6)                                      | **Ports**                | `func(Deps) bool` via `WithRunIf`; uses `Get` for values. A panicking predicate ABORTS the DAG (`*DagPredicateError`).                                                                                                       |
| 11  | Completion-reason core base + DAG superset (§2.8)                  | **Ports**                | `DagCompletionReason` string type reusing the core wire vocabulary + one member. Dependency direction `dag → core` preserved.                                                                                                |
| 12  | `DagCompletionConfig` custom predicate w/ results + SKIPPED (§2.9) | **Ports**                | Struct + `func(DagCompletionStatus) CompletionDecision`; `ResultOf[T]` for typed item results. Threshold half reuses core semantics.                                                                                         |
| 13  | Container envelope (§8.1)                                          | **Ports (converged)**    | The canonical `dagEnvelope` (`type: "DagResult"`) is written by all four SDKs; offload via `ReplayChildren`; ordered size-degradation ladder (§8).                                                                           |
| 14  | Replay reconstruction                                              | **Ports (re-execution)** | On replay, `register` re-runs and each task hits its own per-op checkpoint fast-path; the aggregate is deserialized inline or reconstructed + overlaid from the offloaded envelope (§7).                                     |
| 15  | Heterogeneous result serdes tagged by `resultKind` (§8)            | **Adapts (improves)**    | Per-task result stored as `json.RawMessage`; `Result[T]`/`Get[T]` lazily `Unmarshal` into `T`. `resultKind` discriminates recursive batch/dag restore.                                                                       |
| 16  | Concurrency: ready-set scheduler, `maxConcurrency` (§5)            | **Ports (Go-native)**    | Bounded goroutine pool with a single-lock park/wake protocol (`dag_scheduler.go`). Determinism from name-based IDs claimed on the owning goroutine.                                                                          |
| 17  | Failure = terminal state, drain by default (§5.7)                  | **Ports**                | Scheduler does not cancel on task failure; drains reachable graph. Opt into fail-fast via `WithDagCompletion`.                                                                                                               |
| 18  | `throwIfError()` (§2.8)                                            | **Adapts**               | `DagResult.ThrowIfError() error` returning `*DagExecutionError` (with `Unwrap`/`As` to `*OperationError`).                                                                                                                   |
| 19  | `Dag*Error` classes (§5.10)                                        | **Adapts**               | Typed `error` structs; `errors.Is/As`. Registration errors accumulated on `DagBuilder`, returned by `Dag()`.                                                                                                                 |
| 20  | Registration-time throw ergonomics (§5.10, §6)                     | **Adapts**               | Free registration fns record errors on `DagBuilder.regErrs` and surface them as the `error` return of `Dag()`; a `register` panic is recovered into `*DagRegistrationError` (§6).                                            |
| 21  | Raw `Dag*Error` escaping the child context (§7.4)                  | **Ports**                | Validation runs before the scope body, so validation errors return directly from `Dag()`. Task-execution errors are value-typed and unwrappable (`errors.As` reaches `*OperationError`).                                     |
| 22  | Nested DAGs, scope isolation, ID recursion (§9.1, §10.1)           | **Ports**                | `SubDag(d, ...) TaskHandle[*DagResult]`; IDs recurse `…-DAG_NODE_T_a-DAG_NODE_T_b`; nested DAG checkpoints with SubType `Dag`.                                                                                               |
| 23  | Skips checkpoint nothing (§9.5)                                    | **Ports**                | Pure function of upstream terminal statuses + deterministic `runIf`; recomputed each run, no id minted, no checkpoint.                                                                                                       |
| 24  | Empty DAG / empty-upstream trigger rows (§5.9, §5.3)               | **Ports**                | Same evaluators incl. `len > 0` guard on failure-family rules.                                                                                                                                                               |
| 25  | Async `register` (§10.2)                                           | **Adapts**               | `register` is synchronous `func(*DagBuilder)`; deterministic setup only. Non-deterministic work is forbidden and surfaces as replay inconsistency.                                                                           |

---

## 4. Entity-ID strategy & replay correctness

**Flat name-based model.** A DAG materializes a single **scope** CONTEXT operation (SubType `Dag`). Each task's underlying operation (STEP/WAIT/CONTEXT/...) is then checkpointed **directly** under that scope with a deterministic name-based id `{scopeId}-DAG_NODE_T_{name}` — there is no per-task container operation. The scope is checkpointed START-before-body (as `RunInChildContext` and Map/Parallel do), so every task op always has a valid, already-recorded `ParentId`. This costs N+1 checkpoints for N tasks (one scope + one op per task) rather than the 2N+1 of a per-task-container design.

```go
const dagTaskIDPrefix = "DAG_NODE_T_" // reserved; forbidden as a substring of task names

// A task's operation id (opIDs.formatSuffix joins prefix + "-" + suffix):
//   root scope:  DAG_NODE_T_fetch
//   under scope: {scopeId}-DAG_NODE_T_fetch
```

**How the name-based id is minted.** The scope id is a single positional id claimed from the enclosing context's counter (`claimOperation`), so the enclosing counter advances by exactly one for the whole DAG regardless of task count. Within the scope, each task runs under `scopeEc.childNamed("DAG_NODE_T_" + name)`: the `opIDs.named` field sets the suffix the next claimed id uses instead of the positional counter. Because task ids are name-derived and never touch a shared mutable counter, concurrent DAG tasks share no id state — which is exactly what lets them run flat under one scope with no cross-goroutine race.

**Hashing.** IDs are composed into one raw multi-level string and hashed **once at the wire boundary** with `hashID` — MD5, first 16 hex characters (`state.go`). MD5 is an identifier encoding here, not a security mechanism. The `-` structural joins and the `DAG_NODE_T_` token are transparent because they are hash _input_, never stored raw. This is the JS-style single-composition model (not the per-level re-hashing of Python/Java); the observable wire contract — exactly one `DAG_NODE_T_{name}` token per nesting level, hashed before storage — is identical across SDKs.

**Injectivity.** Guaranteed by two charset rules enforced at registration: no `-` in names, and no `DAG_NODE_T_` substring. Since `-` appears in an id only structurally, every `-DAG_NODE_T_` is an unforgeable delimiter, so splitting on it decomposes the id uniquely into `(prefix, name₁, name₂, …)`. In Go (as in JS) the no-dash rule is load-bearing; the no-`DAG_NODE_T_` rule is defense-in-depth.

**Replay correctness** rests on: (a) each task's id is a pure function of its name + scope prefix — identical every run; (b) topological ordering guarantees deps resolve before a task runs; (c) a completed task hits its own per-operation checkpoint fast path via `childReplayMode` + replay-consistency validation (`validateReplayConsistency`), so it returns its checkpointed result without re-executing. A name always maps to the same operation type, so the consistency check passes.

[GO DIVERGENCE — goroutine nondeterminism is a non-issue here] In JS the event loop serializes; in Go, goroutine completion order is variable. Because task ids are name-derived (not counter-derived), a task's id does not depend on the order in which siblings complete, so concurrent scheduling is replay-safe without any pre-claim dance on a shared counter.

---

## 5. Scheduler & concurrency

### 5.1 Model

The scheduler runs inside the DAG's scope context. The SDK's durable-operation API is **synchronous and blocking** — `Step(...) (O, error)` blocks until the step is checkpointed/resolved, and suspension (waits, scheduled retries, pending callbacks) is signaled by an internal sentinel error (`errSuspendExecution`) that unwinds the call stack and ends the invocation PENDING.

Each task runs in its own goroutine under its own child context (`scopeEc.childNamed(...)`), capturing goroutine ownership inside the worker. This satisfies the SDK's per-goroutine context-ownership rule: a context may only issue ops from its owning goroutine, so concurrent durable work runs in its own child context whose owner is captured in the worker goroutine.

The scheduler (`dag_scheduler.go`) is decoupled from the runtime via `dagSchedHooks` (`runTask`, `suspendedCh`, `isSuspend`, `failTask`) so it can be unit-tested with a fake runner. It uses a **single-lock park/wake protocol** rather than a completions channel: worker completions are appended to a mutex-guarded `pending` queue, and the same lock guards both the main loop's decision to park and a finishing worker's decision to wake it — which avoids the two-independent-signals spurious-wake race.

- **Ready set**: a task is ready when every dep (inline ∪ ordering-only) is terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`). Roots ready immediately. `STARTED` is not terminal.
- **Concurrency**: `startReady` starts ready tasks while `len(inFlight) < maxConcurrency`. Each started task runs in its own goroutine; on completion it delivers a `dagTaskDone` into `pending` and wakes the parked main loop, which records the terminal state and re-scans for newly-ready tasks.
- **`errgroup` is deliberately not used**: its cancel-on-first-error semantics are wrong for the DAG (a task failure must NOT cancel siblings — failure is a terminal state, §5.5). A plain bounded pool + explicit park/wake is used instead.

[GO DIVERGENCE — explicit goroutine choreography] JS drives everything on the event loop with `.catch(()=>{})` on eager promises. Go uses a scheduler goroutine + worker goroutines + the single-lock pending queue. The readiness/trigger/`runIf`/skip logic is identical.

### 5.2 Trigger-rule evaluation (ports verbatim)

```go
var triggerRuleEvaluators = map[TriggerRule]func([]TaskStatus) bool{
    AllSuccess: func(s []TaskStatus) bool { return allAre(s, StatusSucceeded) },            // [] => true
    AllFailed:  func(s []TaskStatus) bool { return len(s) > 0 && allAre(s, StatusFailed) }, // [] => false
    AllDone:    func(s []TaskStatus) bool { return true },                                  // [] => true
    AnySuccess: func(s []TaskStatus) bool { return anyIs(s, StatusSucceeded) },             // [] => false
    AnyFailed:  func(s []TaskStatus) bool { return anyIs(s, StatusFailed) },                // [] => false
    NoneFailed: func(s []TaskStatus) bool { return noneIs(s, StatusFailed) },               // [] => true
}
```

An empty rule defaults to `AllSuccess`. An unknown rule (which validation rejects) conservatively evaluates to `false`. `SKIPPED` counts as neither success nor failure.

### 5.3 `runIf`, running, skip propagation

After the trigger rule passes, the scheduler builds `Deps` from succeeded inline deps and evaluates `runIf(deps)`; `false` ⇒ `SKIPPED{RUN_IF_PREDICATE}`. `runIf` runs synchronously on the scheduler goroutine (it decides whether a task even starts). A **panicking** `runIf` is recovered (`evalRunIf`) — it must never reach the runtime — and ABORTS the DAG with a typed `*DagPredicateError`; it is deliberately NOT reinterpreted as a task failure (that would drive downstream `ALL_FAILED`/`ANY_FAILED`/`ALL_DONE` compensation off a scheduler-side defect). Running a task invokes its name-based operation; resolve ⇒ SUCCEEDED, error ⇒ FAILED. Skips are terminal and cascade.

A **panicking task body** is different: the worker goroutine recovers it at entry and delivers it through the normal completion path as a task FAILED (shaped into a `*DagTaskFailedError` via the `failTask` hook), so `inFlight` clears, siblings drain, and the DAG completes with `CompletedWithFailures`.

### 5.4 `maxConcurrency` for nested DAGs

The DAG-level bound limits only this DAG's top-level tasks. A `SubDag` runs through `Dag` again, so it resolves its own independent default of 40 (or its own explicit `WithDagMaxConcurrency`). A Map/Parallel task's inner fan-out is bounded separately by `WithBatchMaxConcurrency`.

### 5.5 Failure semantics (ports)

A failed task is a **terminal state, not an abort**. Default (no `WithDagCompletion`): drain the reachable graph, then `CompletionReason` = `AllCompleted` (all succeeded/skipped) or `CompletedWithFailures` (≥1 failed). `Dag(...)` returns `err == nil`; the caller inspects `res.ThrowIfError()`. With `WithDagCompletion`, a threshold or custom predicate can stop scheduling early: no new tasks start, and every currently in-flight task is recorded as `STARTED`.

### 5.6 Early completion & `STARTED`

`STARTED` marks a task whose goroutine was launched but the DAG resolved (early completion) before it settled. It is only meaningful within a single live drain and is never persisted as a terminal state. Never-started tasks are **absent** from results (`Status(...)` returns `(_, false)`); they count only toward `TotalCount`.

### 5.7 Suspension

Suspension is a first-class, invocation-wide signal. When any task returns `errSuspendExecution`, the scheduler stops starting new tasks; once in-flight workers have drained (or the invocation-wide suspend channel fires), `run` returns the suspend flag and `Dag` propagates `errSuspendExecution` so the invocation ends PENDING and resumes later. Suspension outranks a pending abort: on replay a deterministic `runIf` panics again and aborts then. Task **failure** does not suspend or cancel.

### 5.8 Config guards

- `WithDagMaxConcurrency(n)` with `n <= 0` ⇒ `Dag(...)` returns `*DagInvalidConfigError`, evaluated before the scope is entered.
- A `DagCompletionConfig` with both a threshold field and `ShouldComplete` set ⇒ `*DagInvalidConfigError`, evaluated before the scope is entered.

---

## 6. Validation & error values

```go
// dag_errors.go — all implement error; use errors.Is / errors.As.
type DagValidationError        struct{ Errs []error } // aggregate of registration/validation errors
type DagInvalidTaskNameError   struct{ Name, Reason string }
type DagDuplicateTaskError     struct{ Name string }
type DagInvalidDependencyError struct{ Task, Dep string }
type DagCyclicDependencyError  struct{ Cycle []string }
type DagInvalidConfigError     struct{ Reason string }
type DagInvalidTriggerRuleError struct{ Rule TriggerRule }
type DagInapplicableOptionError struct{ Task, Option, Op string }

// Registration-callback and predicate panics (recovered, never reach the runtime):
type DagRegistrationError struct{ Name string; Err error } // register callback panicked
type DagPredicateError    struct{ Name string; Err error } // a task's runIf panicked

// Execution-time (surfaced via the result / errors.As to *OperationError):
type DagError           struct{ Name string; Err error }         // scope-level operation failure
type DagTaskFailedError struct{ Name, TaskID string; Err error } // a single task failed
type DagExecutionError  struct{ FirstFailed string; /* cause */ } // returned by ThrowIfError()
```

**Validation runs once, after `register` returns, before the scheduler starts.** Because free registration functions cannot ergonomically return `(handle, error)`, each function that detects a problem (bad name, duplicate, missing `WithCondition`, an inapplicable option) **records the error on `DagBuilder.regErrs`** and still returns a handle. After `register` returns, `validateDag` runs the config guards, carries over the accumulated registration errors, checks name rules and unknown trigger rules, runs missing-dep detection and cycle detection (Kahn's algorithm over the union of inline + ordering edges), aggregates everything into a `*DagValidationError`, and returns it as the `error` result **without scheduling any task**.

[GO DIVERGENCE — deferred, aggregated validation] JS throws at the exact offending registration call (fail-fast, one error). Go collects all registration errors and returns them together, reporting every problem at once at the cost of the precise call-site stack.

Name rules port exactly: non-empty, ≤ 100 chars, `^[a-zA-Z0-9_]+$` (no `-`), and no `DAG_NODE_T_` substring.

**Register-callback panic (recovered).** Registration runs synchronously, before any task starts, and is expected to be pure graph-construction code. `runDagRegister` wraps the callback with `recover`: a panic there is treated the same way a panicking `runIf` is — recovered and converted into a typed `*DagRegistrationError` that `Dag` returns directly, rather than reaching the Lambda runtime and crashing the invocation. There is no task graph yet for the panic to be reinterpreted as a task failure, and no tasks have started, so nothing needs draining. The recovered value is wrapped with the stack preserved (with `%w` when it is itself an `error`, so `errors.Is`/`errors.As` reach the original). The DAG container checkpoints a failure. Well-behaved `register` callbacks do not panic; this is a safety net, not a control-flow mechanism.

---

## 7. Replay & checkpointing

The DAG runs as a child context; everything below reuses the core SDK machinery.

- **Name-based-ID operations.** Each task runs under a stable, name-derived id via `childNamed` (§4), so a completed task fast-paths from its own checkpoint. `childNamed` captures the worker goroutine as owner and derives the replay mode from the underlying op's checkpoint.
- **Reconstruction on replay — re-execution.** On replay, `register` re-runs, skip/trigger are recomputed from upstream terminal statuses, and each task hits its own checkpoint fast-path. When the DAG scope is already terminal-SUCCEEDED:
  - **inline** (tasks present in the envelope, `ReplayChildren` unset): the envelope is deserialized and returned **without** reading children or re-scheduling — task bodies do not re-execute (`dagEnvelopeToResult`).
  - **offloaded** (tasks absent, `ReplayChildren` set): the scheduler re-runs so each task reconstructs its result from its own child checkpoint, then the envelope's authoritative aggregate (started set, `completionReason`, total, counts) is overlaid (`dagApplyOffloadEnvelope`). The `startedTaskNames` set is not recoverable from any child op, so taking it from the envelope keeps it faithful across the re-run.
- **Large payloads — `ReplayChildren` offload.** When the aggregate result exceeds the checkpoint size limit, the scope SUCCEED checkpoint degrades (§8) and sets `ReplayChildren` so the backend preserves the per-task child operations. The DAG's aggregate `DagResult` rides this offload path automatically because the DAG is a child context.
- **Suspension across goroutines.** Suspension is invocation-wide (§5.7); concurrent durable work is supported because each task runs in its own child context with ownership captured inside the worker goroutine.
- **Determinism.** `register` must be deterministic; non-determinism surfaces as replay-consistency failures on task ids (`validateReplayConsistency` → `NonDeterministicReplayError`).

---

## 8. Serialization (`json`-based)

Per-task results are stored as `json.RawMessage` and unmarshaled lazily into `T` at `Result[T]`/`Get[T]` call time, because the `TaskHandle[T]` supplies the target type. Plain results need no discriminator; the `resultKind` tag (`plain`/`batch`/`dag`) drives recursive restore of nested `BatchResult`/`DagResult` values (whose unexported fields would otherwise marshal to `{}`).

```go
type dagResultKind string
const (
    dagKindPlain dagResultKind = "plain"
    dagKindBatch dagResultKind = "batch"
    dagKindDag   dagResultKind = "dag"
)
```

Errors serialize via a canonical error object (type + message) and are reconstructed on replay as a `replayedError`. A failed task reports the SDK **operation** error type (e.g. `StepError`), matching JS and Python: the outer `*DagTaskFailedError` wrapper is unwrapped to the operation error it carries.

### 8.1 Canonical container envelope

The DAG scope's checkpoint payload converges on **one envelope format**, written identically by all four SDKs. The payload is returned by `GetExecutionHistory` and rendered in the AWS console, so it is a customer-facing contract (normative in `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4). There is no `schemaVersion`; evolution is additive-only, so readers ignore unknown fields (`encoding/json` does by default) and treat a missing field as absent.

```go
type dagEnvelope struct {
    Type             string             `json:"type"` // "DagResult"
    TotalCount       int                `json:"totalCount"`
    SuccessCount     int                `json:"successCount"`
    FailureCount     int                `json:"failureCount"`
    SkippedCount     int                `json:"skippedCount"`
    CompletionReason string             `json:"completionReason"`
    StartedTaskNames []string           `json:"startedTaskNames"`     // always [] when empty, never null
    FailedTaskNames  *[]string          `json:"failedTaskNames"`      // may drop to null as the last step
    Tasks            *[]dagEnvelopeTask `json:"tasks,omitempty"`      // ONLY optional field; absence = offload signal
}
```

Contract highlights (see §2.A.4 for the full normative text):

1. **Only `tasks` is optional.** Every other field is always present, with explicit `null`s rather than omissions, so the inline and offloaded cases share one shape.
2. **The absence of `tasks` is the offload signal** — per-task detail exceeded the checkpoint limit and now lives in the retained child operations (`ReplayChildren` set). Readers must not infer an empty task set from an absent `tasks`.
3. **Ordered degradation ladder** (`dagEnvelopePayload`): (i) full envelope inline; (ii) drop `tasks`, set `ReplayChildren`; (iii) drop `failedTaskNames` to null. The four counts, `completionReason` and `startedTaskNames` never drop, so a DAG can never fail to checkpoint because its own summary did not fit. `startedTaskNames` is bounded by `maxConcurrency` (≤ 40 by default).
4. **Canonical PascalCase error keys** — `ErrorType`, `ErrorMessage`, `StackTrace`, always present and `null` when unset. Go operation errors carry no stack, so `StackTrace` is always `null`.
5. A **nested `dag` task** checkpoints its container with SubType `Dag` (a nested DAG is a DAG), and its inner envelope is embedded recursively into the outer payload so the outer's size accounting is honest.

There is no customer-supplied summary generator and no `summary` field on the envelope: the per-task `tasks` array (each entry backed by its own checkpoint) is sufficient for observability without a customer-generated string riding along on the persisted payload. The deleted fields (`completedCount`, `terminalTaskNames`, `summary`) are asserted absent by conformance.

---

## 9. Worked examples (Go)

### 9.1 Compensation with trigger rules

```go
res, err := durable.Dag(ctx, "payment", func(d *durable.DagBuilder) {
    charge := durable.DagStep(d, "charge", nil,
        func(_ durable.Deps, s durable.StepContext) (Receipt, error) { return chargeCard(event) })

    durable.DagStep(d, "fulfill", []durable.AnyHandle{charge},
        func(deps durable.Deps, s durable.StepContext) (durable.Void, error) {
            r, _ := durable.Get(deps, charge)
            return durable.Void{}, fulfill(r)
        }) // default ALL_SUCCESS

    durable.DagStep(d, "refund", nil,
        func(_ durable.Deps, s durable.StepContext) (durable.Void, error) { return durable.Void{}, refundCard(event) }).
        After(charge).WithTrigger(durable.AllFailed)

    durable.DagStep(d, "notify", nil,
        func(_ durable.Deps, s durable.StepContext) (durable.Void, error) { return durable.Void{}, notify(event) }).
        After(charge).WithTrigger(durable.AllDone)
})
```

### 9.2 Rules engine with custom completion

```go
res, err := durable.Dag(ctx, "rules", func(d *durable.DagBuilder) {
    for _, r := range rules {
        r := r
        durable.DagStep(d, "rule_"+r.ID, nil, // r.ID must satisfy name rules (no dash, no DAG_NODE_T_)
            func(_ durable.Deps, s durable.StepContext) (Verdict, error) { return evaluate(r) })
    }
},
    durable.WithDagMaxConcurrency(5),
    durable.WithDagCompletion(durable.DagCompletionConfig{
        ShouldComplete: func(st durable.DagCompletionStatus) durable.CompletionDecision {
            for _, it := range st.Items {
                if it.Status == durable.StatusSucceeded {
                    if v, ok := durable.ResultOf[Verdict](it); ok && v.Decision == "REJECT" {
                        return durable.CompleteDag(durable.OutcomeFailed)
                    }
                }
            }
            return durable.ContinueDag()
        },
    }),
)
if err == nil && res.CompletionReason() == durable.CustomCompletionFailed {
    // a rule rejected; res.ThrowIfError() != nil
}
```

---

## 10. Determinism & scoping rules

- `register` must be deterministic (same names, deps, rules every replay). No non-deterministic IO in `register`; put it in tasks. Non-determinism surfaces as replay-consistency failures on task ids. Use the SDK's replay-safe time source (`durable.CurrentTime(ctx)`) for any timestamps needed during setup.
- Name uniqueness is scoped to the immediate `DagBuilder`; nested DAGs open a fresh scope; a dep handle must belong to the same scope (missing-dep check, §6).

---

## 11. Notes & accepted limitations (Go-specific)

1. **Deps key-membership checking (§2.5).** Result _types_ are preserved via `TaskHandle[T]`, but there is no compile-time guarantee that a handle passed to `Get` is in the task's deps list; a wrong handle yields `ErrDepNotAvailable` at run time. Accepted as a documented limitation; small-fan-in positional helpers (`DagStep2/3`) are a possible future ergonomic addition.
2. **Blocking durable ops in goroutines (§5/§7).** Supported subject to the ownership rule: each concurrent task runs in its own child context with goroutine ownership captured inside the worker. The DAG scheduler is structurally the batch scheduler with a dependency graph.
3. **Open enums (§2.6, §2.8).** Go cannot close `TriggerRule`/`DagCompletionReason`; unknown values are runtime-validated. Exhaustive-switch linters are recommended for callers.
4. **Typed options (§2.9).** `WithCondition[S]` erases its predicate type into the config; the initial state is a positional parameter. The type is resolved back to `func(S) bool` at run time.
5. **Aggregated vs fail-fast validation (§6).** `Dag()` returns all registration errors at once rather than the first.

---

## 12. Testing

Tests use the standard `testing` package + the SDK's local runner (`durable/durabletest`, with in-memory checkpoint clients and by-name operation lookup), always with `-race` (goroutine scheduler). Existing coverage in `go-alpha/durable` includes:

- **`dag_validate_test.go`**: cycle detection, invalid names (empty, > 100, dash, `DAG_NODE_T_` substring), duplicates across kinds, missing/foreign-scope deps, aggregated `*DagValidationError`.
- **`dag_option_validation_test.go`**: inapplicable-option rejection per operation kind; `WithDagMaxConcurrency <= 0`; mutually-exclusive completion config; required `WithCondition`.
- **`dag_handle_test.go`**: `After`/`WithTrigger` mutate the task definition; `Get[T]`/`Result[T]` typing and `ErrDepNotAvailable`.
- **`dag_scheduler_test.go`**: readiness/topological order, `maxConcurrency` throttling, skip propagation, `runIf`, threshold + custom completion, drain-vs-early-completion, `runIf`/register panic recovery, `-race` clean.
- **`dag_result_test.go`**: `Result`/`Status` for succeeded/failed/skipped/not-started; `ThrowIfError()`; `json.RawMessage` lazy typing; nested batch/dag recursive restore.
- **`dag_envelope_test.go` / `dag_envelope_e2e_test.go`**: canonical envelope shape, degradation ladder, additive-field tolerance.
- **`dag_large_payload_e2e_test.go` / `dag_nested_offload_test.go` / `dag_nested_offload_e2e_test.go`**: `ReplayChildren` offload and nested-offload reconstruction.
- **`dag_concurrency_e2e_test.go` / `dag_default_concurrency_test.go`**: bounded concurrency, default-40 behavior, `-race`.
- **`dag_conformance_test.go` / `dag_smoke_test.go` / `dag_e2e_test.go`**: cross-language conformance and end-to-end scenarios.
- **Verification bar**: `go build ./...`, `go vet ./...`, `go test -race ./...`, `golangci-lint`.

---

## 13. Cross-language note

This Go spec is one leaf of a four-language effort (JS canonical + Python / Java / Go). The shared normative core (`DAG_NODE_T_` delimiter, no-dash names, injectivity, topological scheduling + trigger/`runIf`/skip semantics, completion-reason core+superset, the converged container envelope, drain-by-default failure model, the default concurrency bound of 40, determinism rules) is identical across all languages and lives in `DAG_SPEC_CROSS_LANGUAGE.md`. Go's per-language divergences: `Dag`-prefixed free-function registration + free `durable.Dag(ctx, ...)` entry (no generic methods), `Deps` + `Get[T]` (no `DepsMap`), uniform fn shape (no conditional types), open enums (no closed unions), `error`-value flow (no exceptions), aggregated validation, a bounded goroutine-pool scheduler with a single-lock park/wake protocol, and single-composition MD5→16-hex name-based IDs (the JS-style hashing model). Register-callback and `runIf` panics are recovered into `*DagRegistrationError` / `*DagPredicateError` rather than crashing the invocation.

---

## 14. Materialization & checkpoint model

The flat-scope model is the load-bearing implementation choice, summarized here for reference:

- **One scope CONTEXT op.** `Dag` claims a single positional id from the enclosing context and materializes it as a CONTEXT operation with SubType `Dag`, checkpointed START-before-body (`dagMaterializeChild`). The enclosing counter advances by exactly one for the whole DAG.
- **Flat name-based task ops.** Each task's underlying operation is checkpointed directly under the scope with id `{scopeId}-DAG_NODE_T_{name}` (`scopeEc.childNamed`). There is no per-task container, so N tasks cost N+1 checkpoints.
- **Callback exception.** A callback task cannot take an explicit name-based operation id directly, so it materializes as a container context with SubType `Callback` carrying the name-based id, whose body runs the native `WaitForCallback` operation. This two-level shape is normative (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5).
- **Scope finish.** `dagFinishChild` checkpoints the scope's terminal transition: CONTEXT/SUCCEED carrying the canonical envelope (degrading per §8) on a normal drain, or CONTEXT/FAIL carrying the cause on a predicate/register abort. The DAG never fails at the container level for a task-level failure — only for a predicate or register-callback abort.
- **Replay branch.** A terminal-SUCCEEDED scope returns the inline envelope directly, or (offloaded) re-runs the scheduler and overlays the envelope aggregate (§7).

---

## 15. Summary

The DAG feature is implemented in the `durable` package as a bounded-concurrency, replay-safe topological scheduler over the SDK's existing operation primitives. Registration is a set of `Dag`-prefixed generic free functions returning `TaskHandle[T]`; dependencies are accessed with the typed `Get[T]` accessor; task failures are reported inside `DagResult.ThrowIfError()` while registration/validation/config errors — and recovered register-callback (`*DagRegistrationError`) and `runIf` (`*DagPredicateError`) panics — are returned as the `error` of `Dag()`. Tasks materialize flat under a single `Dag`-subtype scope with single-composition MD5→16-hex name-based IDs, and the container checkpoints the canonical cross-language `DagResult` envelope, degrading via `ReplayChildren` offload when oversize. The default top-level concurrency bound is 40; `WithDagMaxConcurrency(n <= 0)` is a configuration error.
