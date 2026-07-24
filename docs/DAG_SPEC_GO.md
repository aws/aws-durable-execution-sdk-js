# DAG Support (`dag.Dag(...)`) — Go Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable.
>
> **Required API annotation (Go).** Use the standard Go pre-stable doc-comment convention (as in `google.golang.org/protobuf`): every exported DAG symbol's doc comment ends with an `// Experimental:` paragraph.
>
> ```go
> // Dag declares and runs a directed acyclic graph of tasks. ...
> //
> // Experimental: This API is experimental and may be changed or removed in
> // future releases.
> func Dag(ctx *durable.Context, name string, register func(*dag.Context)) (*DagResult, error)
> ```

Status: **Grounded / Buildable** · **Stability: Experimental** · Target: `aws-durable-execution-sdk-go` · Scope: adapting the canonical JS/TS design ([`DAG_SPEC.md`](./DAG_SPEC.md)) to idiomatic Go, grounded in two real local implementations.

> ## ✅ Grounding banner — read first
>
> **A real Go durable-execution SDK now exists locally in two independent first-cut implementations.** This spec is re-grounded against their actual source (verified 2026-07-23):
>
> | Branch                                                     | Layout      | Package(s)                                                                            | ID hashing                                                               | Concurrency primitives                                                                                               | Explicit-ID seam exposure                                                                              |
> | ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
> | **firstcut/a** (`/Users/parpooya/workplace/go-firstcut-a`) | **FLAT**    | single `durable/`                                                                     | MD5 → 16 hex (`state.go` `hashID`)                                       | rich & public: `Go`, `Future[T]`, `All/Any/Race/AllSettled`, `StepAsync`, `RunInChildContextAsync` + semaphore batch | **internal only** (`execContext.child`, `opIDs.child` unexported)                                      |
> | **firstcut/b** (`/Users/parpooya/workplace/go-firstcut-b`) | **LAYERED** | `pkg/durable/{context,operations,execmgr,checkpoint,types,utils,plugin}` + `insight/` | SHA-256 → 64 hex (`context/dcontext.go` `hashOperationID`, matches Java) | Map/Parallel only (internal goroutine pool; IDs pre-claimed by index)                                                | **exported**: `NewChildWithName`, `NewVirtualChildWithName`, `NextStepID`, `PeekStepID` on the context |
>
> Both branches implement the full base operation set (Step, Wait, Invoke, RunInChildContext, Map, Parallel, WaitForCondition, WaitForCallback, CreateCallback), checkpoint/replay, retries, custom serdes, plugins, and a local test runner. The JS spec (`DAG_SPEC.md`) remains the **canonical source of the design**; Go divergences are called out in **[GO DIVERGENCE]** callouts and reconciled in §3.
>
> **What is verified vs. what still must be added.** Most of the machinery the DAG needs _exists today_ and is cited by `file:line` (branch-qualified) throughout. Three things the DAG needs are **absent from both base SDKs and must be added** — tagged **[NEEDS SDK ADDITION]**:
>
> 1. **A custom completion predicate** (`ShouldComplete(status) → decision`). Both SDKs' batch completion is **threshold-only** (`MinSuccessful` / `ToleratedFailureCount` / `ToleratedFailurePercentage`; firstcut-a `batch.go`, firstcut-b `types/types.go` `CompletionConfig`). No results-aware predicate hook exists.
> 2. **Name-based task-ID minting** (`{parent}-DAG_NODE_T_{name}`). Both SDKs mint operation IDs **positionally** from a per-context counter (a: `opIDs.next()`; b: `Context.NextStepID()`), not from names. firstcut-b exposes enough (arbitrary-prefix child contexts + `Checkpoint()`/`ExecManager()` access) to build name-based IDs _without core changes_; firstcut-a would need a new exported seam. See §4.
> 3. **Completion-reason supersets** (`CUSTOM_COMPLETION_SUCCEEDED/FAILED`, `COMPLETED_WITH_FAILURES`). Neither SDK's `CompletionReason` has these (a: 3-value int enum; b: none beyond the 3 threshold reasons). Purely additive.
>
> Everything else the design leaned on as "[ASSUMPTION]" — checkpoint manager, replay-mode determination, child-context handler, replay-consistency validation, suspension, large-payload offload — is **real and reused**, cited below.
>
> The remaining divergences are driven by **Go generics limits (Go 1.25), now confirmed against BOTH real SDKs' actual API style** (both use free generic functions, e.g. `durable.Step[O](ctx, …)` / `operations.Step[T](dc, …)`, precisely because methods can't be generic):
>
> 1. **Methods cannot declare type parameters.** Confirmed: neither SDK hangs typed operations off the context; both use free functions (`durable.Step[O]`, `operations.Map[TIn,TOut]`). The DAG follows suit: `dag.Step[T](d, …)`, and the entry is a free function `dag.Dag(dc, …)`, not a method.
> 2. **No mapped types / template-literal types.** → JS's `DepsMap<TDeps>` `deps.fetch` typed access is impossible; replaced by a `Deps` map + generic accessor `dag.Get[T](deps, handle) (T, error)`.
> 3. **No conditional types, no function overloading.** → one **uniform** task-fn shape always receiving `Deps` (empty for roots).
> 4. **No closed union types.** → `TriggerRule` / `CompletionReason` are `string`/typed-const enums (open set; runtime-validated) — matching how both SDKs already model their own enums (a's `CompletionReason` is an `int` enum, b's statuses are `string` consts).

---

## 1. Executive summary — does the JS design port to Go?

**Yes, and the base machinery to build it now exists.** The parts of the JS design that constitute the _durability contract_ — the reserved `DAG_NODE_T_` delimiter, no-dash task names, the injectivity proof, topological scheduling with readiness/trigger-rule/`runIf` semantics, the completion-reason core+superset layering, and the drain-by-default failure model — are **string- and algorithm-level** decisions that carry over to Go essentially unchanged. Both real SDKs already provide the hard runtime substrate: positional+hashed operation IDs with per-op checkpoint fast-path replay (a: `state.go`/`execution_context.go`; b: `context/dcontext.go`), replay-consistency validation (a: `validateReplayConsistency`; b: `checkReplayConsistency`), child-context scope isolation, 256KB large-payload offload via `ReplayChildren`, deterministic-order concurrent ID pre-claiming in batch, value-typed errors, and a local test runner. Go's concurrency model (goroutines + bounded worker pool + `context.Context` cancellation) is arguably a **better** host for the topological scheduler than JS's single event loop — and firstcut-a already ships the exact primitives (`Go[T]`, `Future[T]`, `All/Any/Race`) a scheduler would want.

**What changes is the _surface ergonomics_, driven by Go generics limits** — now confirmed against both SDKs' real API style. The fluent, deeply type-inferred JS API cannot be reproduced. Go gets a **free-function registration API** (`dag.Step[T](d, "x", deps, fn)`) with a **map-based `Deps` + generic accessor** (`dag.Get[T](deps, handle)`). Error handling is value-based: task failures live inside `DagResult.ThrowIfError()` (modeled on firstcut-a's `BatchResult.ThrowIfError()`), while registration/validation failures surface as the `error` return of `dag.Dag(...)`.

**What must be added to the base SDK** (see banner): a custom completion predicate, name-based task-ID minting, and completion-reason supersets. All three are additive and well-scoped; none requires rearchitecting the base SDK.

**Net verdict:** the durability/correctness core is fully portable and its dependencies are real; the type-level data-flow guarantees are ~70% preserved (result _types_ are retained via `TaskHandle[T]`, but _compile-time key checking_ of `deps.<name>` is lost). Recommended base: **firstcut/b** (exported ID seams + Java-matching SHA-256 + clean package boundaries), porting firstcut/a's scheduler primitives. See §12 for the full verdict.

---

## 2. Proposed Go public API

Package layout (grounded in firstcut/b's layered structure — recommended base):

```
pkg/durable/            // core SDK — types.DurableContext, operations.Step/Wait/Invoke/Map/…
pkg/durable/dag/        // this feature (sibling of operations/, sharing context/checkpoint/execmgr)
  dag.go            // Context (registration), entry Dag(dc, …)
  handle.go         // TaskHandle[T], AnyHandle, builder methods
  deps.go           // Deps, Get[T], MustGet[T]
  result.go         // DagResult, TaskExecution, serialization
  trigger.go        // TriggerRule consts + evaluators
  completion.go     // DagCompletionConfig, DagCompletionStatus, CompletionDecision
  scheduler.go      // topological scheduler (goroutine pool; port firstcut/a's Go/Future pattern)
  validate.go       // name/duplicate/missing-dep/cycle validation
  errors.go         // typed error values
```

> On **firstcut/a** (flat) the equivalent would be a `durable/dag/` subpackage, but the DAG needs access to the currently-unexported ID/checkpoint seam (`execContext.child`, `checkpointer`) — see §4/§7. On **firstcut/b** those seams are already exported on `*dcontext.Context` (`NewChildWithName`, `NextStepID`, `Checkpoint()`, `ExecManager()`), so a `dag` package can be built against them with no core edits beyond the three [NEEDS SDK ADDITION] items.

### 2.1 Entry point (free function — NOT a method)

Neither real SDK hangs typed operations off the context object (both use free generic functions because Go methods cannot be generic — confirmed: firstcut-a `durable.Step[O](ctx, …)`, firstcut-b `operations.Step[T](dc, …)`). The DAG entry therefore is a **free function** taking the durable context as its first argument, mirroring `operations.Map(dc, …)`:

```go
// dc is the base durable context (firstcut-a: durable.Context; firstcut-b: types.DurableContext).
// Returns (*DagResult, error):
//   - err != nil        => registration/validation/infra failure (the JS "reject" path,
//                          §5.10). Includes DagValidationError, cycle errors, and a
//                          deterministic panic/error escaping the register callback.
//   - err == nil        => the DAG drained (or early-completed). Individual task
//                          failures are reported INSIDE the result: res.ThrowIfError() != nil.
func Dag(
    dc DurableContext,          // alias for the base SDK's context interface
    name string,
    register func(d *Context),
    opts ...Option,
) (*DagResult, error)
```

[GO DIVERGENCE — no exceptions] JS splits outcomes into "promise rejects" (validation) vs "promise resolves with `DagResult`" (task failures). Go collapses this into the idiomatic `(*DagResult, error)` two-channel return: `error` = the JS reject cases; `DagResult.ThrowIfError()` = the JS `throwIfError()` case. This exactly matches firstcut-a's existing `BatchResult.ThrowIfError() error` (`batch.go`) pattern.

### 2.2 `dag.Context` (registration) — methods are NOT generic

Because **Go methods cannot have type parameters**, `dag.Context` exposes _no generic registration methods_. It is an opaque handle threaded into the free registration functions (§2.3). It carries the registry, config, and accumulated validation errors.

```go
package dag

type Context struct {
    // unexported: task registry (ordered), name set, config, accumulated regErrs,
    // and a back-reference to the executor host (the child DurableContext).
}
```

### 2.3 Task registration — free functions (the core divergence)

Each JS `dagCtx.<kind>(...)` method becomes a **free function** `dag.<Kind>[T](d *Context, ...)`. This is the only way to obtain a type parameter on the returned `TaskHandle[T]`.

```go
package dag

// Base-SDK aliases (firstcut-b shown; firstcut-a is durable.Context / durable.StepContext).
// NOTE: both are INTERFACES — never pointers. StepContext exposes no durable ops (Logger/
// Attempt only); DurableContext is the full operation-issuing context.
//   type DurableContext = types.DurableContext
//   type StepContext    = types.StepContext

// ── step ────────────────────────────────────────────────────────────────────
// sctx is the base SDK's StepContext INTERFACE (verified: a `func(StepContext)(O,error)`,
// b `func(sc types.StepContext)(T,error)` — NOT a pointer).
type StepFunc[T any] func(deps Deps, sctx StepContext) (T, error)

func Step[T any](
    d *Context, name string, deps []AnyHandle,
    fn StepFunc[T], opts ...Option,
) TaskHandle[T]

// ── invoke ───────────────────────────────────────────────────────────────────
// Base Invoke takes a value payload directly: a/b `Invoke[TIn,TOut](dc, id, functionARN, input TIn, …)`.
// DAG wraps it so the payload is produced from deps (a DAG-specific adapter).
type PayloadFunc[In any] func(deps Deps) (In, error)

func Invoke[In, Out any](
    d *Context, name string, functionARN string, deps []AnyHandle,
    payload PayloadFunc[In], opts ...Option,
) TaskHandle[Out]

// ── callback (submitter-based) ───────────────────────────────────────────────
// Verified b signature: WaitForCallback submitter is `func(sc types.StepContext, callbackID string) error`.
type SubmitterFunc func(deps Deps, sctx StepContext, callbackID string) error

func Callback[T any](
    d *Context, name string, deps []AnyHandle,
    submit SubmitterFunc, opts ...Option,
) TaskHandle[T]

// ── wait (no fn) ─────────────────────────────────────────────────────────────
// Base wait uses types.Duration (b) / time.Duration (a). Use the base SDK's own type.
func Wait(
    d *Context, name string, deps []AnyHandle,
    duration Duration, opts ...Option,
) TaskHandle[Void]                       // Void = struct{}

// ── waitForCondition ─────────────────────────────────────────────────────────
// Base check runs in a StepContext. The initial state is a POSITIONAL parameter
// (no WithInitialState option); the condition/wait strategy travel in opts and the
// condition (WithCondition) is REQUIRED — validated at registration (DagInvalidConfigError).
type CheckFunc[S any] func(deps Deps, state S, sctx StepContext) (S, error)

func WaitForCondition[S any](
    d *Context, name string, deps []AnyHandle,
    initial S, check CheckFunc[S], opts ...Option,   // initial state positional; opts MUST carry WithCondition (+ strategy)
) TaskHandle[S]

// ── runInChildContext ────────────────────────────────────────────────────────
// Verified: child fn receives the DurableContext INTERFACE
// (a `func(Context)(O,error)`, b `func(child types.DurableContext)(T,error)`).
type ChildFunc[T any] func(deps Deps, cctx DurableContext) (T, error)

func Child[T any](
    d *Context, name string, deps []AnyHandle,
    fn ChildFunc[T], opts ...Option,
) TaskHandle[T]

// ── map ──────────────────────────────────────────────────────────────────────
// Base: a `Map[I,O](ctx,name,items,func(ctx Context,item I,index int)(O,error),…)`,
//       b `Map[TIn,TOut](dc,id,items,func(child types.DurableContext,item TIn,index int)(TOut,error),…)`.
type ItemsFunc[In any] func(deps Deps) []In
type MapFunc[In, Out any] func(cctx DurableContext, item In, index int) (Out, error)

func Map[In, Out any](
    d *Context, name string, deps []AnyHandle,
    items ItemsFunc[In], mapFn MapFunc[In, Out], opts ...Option,
) TaskHandle[BatchResult[Out]]           // BatchResult[O] is a VALUE type in a (not pointer)

// ── parallel ─────────────────────────────────────────────────────────────────
// [GO DIVERGENCE — Branch type differs by branch]: firstcut-a has a Branch[O]{Name, Func}
// struct; firstcut-b's Parallel takes a bare []func(child types.DurableContext)(TOut,error).
// The DAG should adopt firstcut-a's named-Branch shape (names aid observability & result access).
func Parallel[Out any](
    d *Context, name string, deps []AnyHandle,
    branches []Branch[Out], opts ...Option,
) TaskHandle[BatchResult[Out]]

// ── nested dag ───────────────────────────────────────────────────────────────
func Dag(
    d *Context, name string, deps []AnyHandle,
    register func(sub *Context), opts ...Option,
) TaskHandle[*DagResult]
```

[GO DIVERGENCE — uniform fn shape] Unlike JS (which uses conditional types so a root task's fn omits `deps`), **every** Go task fn takes `deps Deps` as its first parameter, even when `deps` is `nil`. Go has neither conditional types nor overloading, so a single uniform shape is the only option — and it is arguably clearer. The native operation args (`*StepContext`, `callbackID`, `state`, `*DurableContext`) follow `deps`, preserving the JS "deps-first" rule (§2.3 of the JS spec).

[GO DIVERGENCE — result-type inference gaps: `Invoke`/`Callback` require explicit type args] **Verified against Go 1.25.** For task kinds whose result type parameter appears **only in the returned `TaskHandle[T]`** and in no function-argument position, Go's type inference cannot resolve it (return types do not participate in inference), so callers MUST supply it explicitly:

- **`Invoke[In, Out]`** — `Out` appears only in the return; `In` is inferred from `payload`. But Go's partial-inference is prefix-only, so specifying `Out` forces specifying `In` too: callers write `dag.Invoke[InType, OutType](d, …)`. (Uninferred, the compiler emits `cannot infer Out`.)
- **`Callback[T]`** — `T` appears only in the return (`SubmitterFunc` does not mention it). Callers write `dag.Callback[ResultType](d, …)`. (Uninferred: `cannot infer T`.)

All other kinds infer their result type from the task fn / arguments and need no explicit type args: `Step[T]` (from the fn's return), `WaitForCondition[S]` (from the `state` param + return), `Child[T]` (from the fn's return), `Map[In, Out]` (from `mapFn`), `Parallel[Out]` (from `[]Branch[Out]`); `Wait` and nested `Dag` have no free result type parameter. This asymmetry is a genuine ergonomic wrinkle with no clean workaround short of reordering type params (which cannot help, since `Out`/`T` are unconstrained by any argument) — documented rather than hidden.

**Ergonomic comparison (JS vs Go), diamond example:**

```go
res, err := dag.Dag(dc, "etl", func(d *dag.Context) {
    fetch := dag.Step(d, "fetch", nil,
        func(_ dag.Deps, s dag.StepContext) (Source, error) { return fetchSource() })

    a := dag.Step(d, "ta", []dag.AnyHandle{fetch},
        func(deps dag.Deps, s dag.StepContext) (A, error) {
            src, _ := dag.Get(deps, fetch)          // typed: src is Source
            return transformA(src)
        })

    b := dag.Step(d, "tb", []dag.AnyHandle{fetch},
        func(deps dag.Deps, s dag.StepContext) (B, error) {
            src, _ := dag.Get(deps, fetch)
            return transformB(src)
        })

    dag.Step(d, "merge", []dag.AnyHandle{a, b},
        func(deps dag.Deps, s dag.StepContext) (Out, error) {
            av, _ := dag.Get(deps, a)               // typed: av is A
            bv, _ := dag.Get(deps, b)               // typed: bv is B
            return merge(av, bv)
        })
})
if err != nil { return err }        // registration/validation error
if err := res.ThrowIfError(); err != nil { return err }   // >=1 task FAILED (JS throwIfError)
```

### 2.4 `TaskHandle[T]` and `AnyHandle`

```go
// Sealed heterogeneous handle for the deps slice ([]AnyHandle) and internal storage.
// Unexported methods make the interface non-implementable outside the package.
type AnyHandle interface {
    taskName() string
    taskID() nodeID
    resultKind() resultKind
}

// Generic handle: carries the result type T as a phantom (no field needed —
// Go permits unused struct type params). Builder methods return the SAME T, so
// they need NO new type parameter (legal on methods). This is why chaining works
// in Go even though registration functions cannot be methods.
type TaskHandle[T any] struct {
    name string
    id   nodeID
    kind resultKind
}

func (h TaskHandle[T]) taskName() string       { return h.name }
func (h TaskHandle[T]) taskID() nodeID          { return h.id }
func (h TaskHandle[T]) resultKind() resultKind  { return h.kind }

// ── builder (chainable; mutates the underlying TaskDef in the registry) ──
func (h TaskHandle[T]) After(deps ...AnyHandle) TaskHandle[T]  // ordering-only edges (§3 of JS: builder .after)
func (h TaskHandle[T]) WithTrigger(rule TriggerRule) TaskHandle[T] // JS .triggerRule
```

[GO DIVERGENCE — builder vs JS `_id: symbol`] JS uses a `symbol` for in-memory identity. Go uses an unexported `nodeID` (a monotonic registration index string or the name itself). `TaskHandle[T]` is a **value type**; `After`/`WithTrigger` mutate the registry entry (looked up by `id`) and return the handle by value for chaining. The handle is never serialized (as in JS).

**Chaining works, registration does not chain.** Note the asymmetry vs JS: builder _mutation_ methods (`After`, `WithTrigger`) are legal Go methods (they don't introduce a new type param — return type stays `TaskHandle[T]`). But _registration_ (`Step`, `Invoke`, …) must be free functions because they mint a _new_ `T`. So Go reads `h := dag.Step[T](d, …)` then `h.After(x).WithTrigger(dag.AllDone)`, not JS's `dagCtx.step(…).after(x).triggerRule(…)`.

### 2.5 `Deps` and the generic accessor (replaces `DepsMap`)

```go
// In-memory, single-invocation view of resolved upstream results. Values are the
// actual Go values produced by upstream tasks this run (not re-deserialized).
type Deps struct {
    m map[string]any        // keyed by task name; only inline deps that SUCCEEDED
}

// The typed accessor. This is the Go stand-in for JS `deps.fetch`.
// Returns:
//   - (value, nil)                 if the dep succeeded and the type matches
//   - (zero, ErrDepNotAvailable)   if the dep is absent (FAILED/SKIPPED/not-inline)
//   - (zero, ErrDepTypeMismatch)   if stored value is not a T (should not happen
//                                   given TaskHandle[T], but defends serdes edges)
func Get[T any](d Deps, h TaskHandle[T]) (T, error)

// Panic variant for call sites that treat a missing ALL_SUCCESS dep as a bug.
func MustGet[T any](d Deps, h TaskHandle[T]) T
```

[GO DIVERGENCE — the DepsMap gap] This is the **single biggest expressiveness loss**. In JS, `deps.fetch` is a compile-time-checked, correctly-typed property. In Go:

- The **result type is preserved** — `dag.Get(deps, fetch)` returns `Source` because `fetch` is `TaskHandle[Source]`. **No manual type assertion by the user.** This is better than a bare `map[string]any`.
- The **key is not compile-time-checked against the deps list** — you _can_ call `dag.Get(deps, someHandleNotInThisTasksDeps)`, which returns `ErrDepNotAvailable` at runtime rather than a compile error. JS would reject this at compile time (the name isn't a key of `DepsMap<TDeps>`).
- **Verdict:** result _typing_ ports; _key membership_ checking is lost (runtime error instead). Documented as an accepted limitation (§11 open questions).

**Rejected alternative — positional arity helpers (`Dag2`/`Dag3`).** One could offer `dag.Step2[A,B,T](d, name, a, b, func(a A, b B, s *StepContext)(T,error))` (à la `errgroup`/`samber/lo`), giving fully-typed positional deps. Rejected as the _primary_ API because a DAG node has **arbitrary fan-in** — you would need `Step2…Step9` and still cap out, and mixing ordering-only builder deps breaks the arity. Offered (optionally) only for the common 2–3 dep cases as sugar over `Step` + `Get`; the map+accessor is the general mechanism. **Deferred to a follow-up** (§11).

### 2.6 `TriggerRule`, `runIf`

```go
type TriggerRule string

const (
    AllSuccess TriggerRule = "ALL_SUCCESS"   // default
    AllFailed  TriggerRule = "ALL_FAILED"
    AllDone    TriggerRule = "ALL_DONE"
    AnySuccess TriggerRule = "ANY_SUCCESS"
    AnyFailed  TriggerRule = "ANY_FAILED"
    NoneFailed TriggerRule = "NONE_FAILED"
)

// runIf is supplied via an Option (§2.9). Sync, deterministic predicate.
// WithRunIf(func(deps Deps) bool)
```

[GO DIVERGENCE — open enum] Go string-const "enums" are open: any `TriggerRule("bogus")` is a valid value at compile time. A runtime guard in `validate.go` rejects unknown rules (`DagInvalidTriggerRuleError`). Trigger-rule _semantics_ (the truth table incl. empty-upstream rows and the `len>0` guard on `ALL_FAILED`) port verbatim as a `map[TriggerRule]func([]TaskStatus) bool` (§5.2).

### 2.7 `DagResult`, `TaskExecution`

```go
type TaskStatus string
const (
    StatusSucceeded TaskStatus = "SUCCEEDED"
    StatusFailed    TaskStatus = "FAILED"
    StatusSkipped   TaskStatus = "SKIPPED"
    StatusStarted   TaskStatus = "STARTED"   // in-flight at early completion only (§5.6)
)

type SkipReason string
const (
    SkipTriggerRule SkipReason = "TRIGGER_RULE"
    SkipRunIf       SkipReason = "RUN_IF_PREDICATE"
)

type TaskExecution struct {
    Name        string
    Status      TaskStatus
    SkipReason  SkipReason      // set only when Status == SKIPPED
    result      any             // in-memory; nil unless SUCCEEDED
    rawResult   json.RawMessage // on replay/deser path (§8)
    Err         error           // set only when Status == FAILED
    StartedAt   time.Time
    CompletedAt time.Time
    kind        resultKind
}

type DagResult struct { /* unexported: ordered results, counts, reason */ }

// Typed getter — mirrors JS getResult<TResult>(handle). Free function (needs T).
func Result[T any](r *DagResult, h TaskHandle[T]) (T, error)

func (r *DagResult) Status(nameOrHandle any) (TaskStatus, bool)  // false => not started (JS undefined)
func (r *DagResult) Succeeded() []TaskExecution
func (r *DagResult) Failed() []TaskExecution
func (r *DagResult) Skipped() []TaskExecution
func (r *DagResult) Results() map[string]TaskExecution           // copy

func (r *DagResult) SucceededCount() int
func (r *DagResult) FailureCount() int
func (r *DagResult) SkippedCount() int
func (r *DagResult) TotalCount() int
func (r *DagResult) CompletionReason() CompletionReason

// Base BatchResult.ThrowIfError() parity: idiomatic Go returns the error rather than throwing.
// Returns *DagExecutionError (wrapping the first failed task's Err via Unwrap)
// when FailureCount() > 0 OR CompletionReason() == CustomCompletionFailed; else nil.
func (r *DagResult) ThrowIfError() error
```

[GO DIVERGENCE — getter is a free function] `getResult<T>(handle)` in JS is a method with a type param. In Go it must be the free function `dag.Result[T](r, handle)` (methods can't add `T`). A non-generic `r.Status(...)` method is fine.

### 2.8 Completion reason — core base + Go superset

Mirrors the JS core-extraction (`src/types/core.ts`). In Go, the shared base lives in the **core `durable` package**; the DAG package declares one additional constant of the _same underlying type_.

```go
// package durable (core) — shared by map/parallel and dag
type CompletionReason string
const (
    AllCompleted             CompletionReason = "ALL_COMPLETED"
    MinSuccessfulReached     CompletionReason = "MIN_SUCCESSFUL_REACHED"
    FailureToleranceExceeded CompletionReason = "FAILURE_TOLERANCE_EXCEEDED"
    CustomCompletionSucceeded CompletionReason = "CUSTOM_COMPLETION_SUCCEEDED"
    CustomCompletionFailed    CompletionReason = "CUSTOM_COMPLETION_FAILED"
)

// package dag — SUPERSET: one extra member of the same string type.
const CompletedWithFailures CompletionReason = "COMPLETED_WITH_FAILURES"
```

[GO DIVERGENCE — no closed union] JS enforces `DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES"` at the type level. Go cannot express a closed union, so `CompletedWithFailures` is just another `CompletionReason` const declared in the `dag` package.

> **[NEEDS SDK ADDITION] + grounding note.** Both base SDKs already have a batch `CompletionReason`, but only the **three threshold reasons**, and with _different underlying types_: firstcut-a `batch.go` is an **`int` enum** (`CompletionAllCompleted`/`CompletionMinSuccessfulReached`/`CompletionFailureToleranceExceeded`, with a `String()` giving `ALL_COMPLETED` etc.); firstcut-b `batch.go` uses **string consts** (`CompletionReasonAllCompleted`/`…MinSuccessfulReached`/…). Neither has `CUSTOM_COMPLETION_SUCCEEDED/FAILED` or `COMPLETED_WITH_FAILURES`. The DAG must **add** those members. If building on firstcut-b, model the DAG's `CompletionReason` as a `string` type (matching b's style); on firstcut-a, either extend the int enum or introduce a parallel string type in the `dag` package. The dependency direction the JS design requested (`dag` → core, never core → `dag`) is still honored either way.

The semantics are identical: default drain ⇒ `AllCompleted` if all reachable tasks succeeded/skipped, else `CompletedWithFailures`; `ThrowIfError()` keys off `FailureCount()`.

### 2.9 Options (functional options replace the JS config object)

```go
type Option func(*taskOrDagConfig)

// Task-level
func WithTriggerRule(r TriggerRule) Option
func WithRunIf(pred func(deps Deps) bool) Option
func WithRetry(s RetryStrategy) Option               // a: func(err,attempt)RetryDecision; b: types.RetryDecision
func WithSerdes(s Serdes) Option                     // Serdes is NON-generic in both SDKs
                                                     //   a: Serdes{Marshal([]byte);Unmarshal}
                                                     //   b: types.Serdes{Serialize(v,entityID,execARN)string;Deserialize}
func WithTimeout(d time.Duration) Option             // callback/condition
func WithCondition[S any](pred func(S) bool) Option  // waitForCondition; REQUIRED (validated at registration)

// DAG-level (passed to dag.Dag / nested dag.Dag)
func WithMaxConcurrency(n int) Option
func WithDefaultTriggerRule(r TriggerRule) Option
func WithDefaultRetry(s durable.RetryStrategy) Option
func WithCompletion(c DagCompletionConfig) Option
func WithSummaryGenerator(f func(*DagResult) string) Option   // observability-only (§8.1)
func WithNesting(n durable.NestingType) Option
```

[GO DIVERGENCE — typed options] `WithSerdes` is non-generic (the base `Serdes` interface is non-generic in both SDKs, so no type param is needed — the serdes works over `any`). The one that DOES need a type param — `WithCondition[S]` (the waitForCondition predicate; initial state is now a **positional** param, §2.9/C7) — is a **generic free function returning `Option`**, legal because it is a function, not a method. It stashes an `S`-erased closure into the config. This is the standard Go workaround for "typed functional options," and matches how firstcut-a threads `ConditionConfig[S]` through `WaitForCondition`.

### 2.10 `DagCompletionConfig` (custom predicate with results)

```go
type DagCompletionItemStatus struct {
    Name       string
    Status     TaskStatus       // incl. SKIPPED; zero value "" => not started
    result     any              // present only when SUCCEEDED
    SkipReason SkipReason
}
func ResultOf[T any](s DagCompletionItemStatus) (T, bool)   // typed access to item result

type DagCompletionStatus struct {
    SuccessCount, FailureCount, SkippedCount, CompletedCount, TotalCount int
    Items   []DagCompletionItemStatus                 // registration order
    Results map[string]DagCompletionItemStatus        // terminal tasks by name
}

type CompletionDecision struct { /* opaque; built by factories below */ }
func ContinueDag() CompletionDecision
func CompleteDag(outcome durable.CompletionOutcome) CompletionDecision  // SUCCEEDED|FAILED

type DagCompletionConfig struct {
    // Exactly one of the two "modes" may be set (enforced at runtime — §5.8):
    ShouldComplete func(status DagCompletionStatus) CompletionDecision   // custom mode
    // OR threshold mode (reused from core, result-blind):
    MinSuccessful             *int
    ToleratedFailureCount     *int
    ToleratedFailurePercentage *float64
}
```

Mirrors JS `DagCompletionStatus`/`DagCustomCompletionConfig` (carries per-task results and `SKIPPED`, which the core batch status lacks). Threshold fields reuse the core semantics unchanged. Mutual exclusivity is a runtime guard (§5.8) — Go can't type-level `never`-exclude fields as JS does.

> **[NEEDS SDK ADDITION] — the custom `ShouldComplete` predicate does not exist in either base SDK.** Both SDKs' batch completion is strictly **threshold-based**:
>
> - firstcut-a `batch.go`: `CompletionConfig{MinSuccessful, ToleratedFailureCount, ToleratedFailurePercentage}` evaluated by `shouldStopMin`/`shouldStopFailure` — no results-aware hook.
> - firstcut-b `types/types.go` `CompletionConfig{MinSuccessful *int, ToleratedFailureCount *int, ToleratedFailurePercentage *float64}` — same three thresholds, no predicate.
>
> The DAG's **threshold half** reuses this existing machinery directly. The DAG's **custom-predicate half** (`ShouldComplete(status) CompletionDecision`, which sees per-task results and `SKIPPED`) is genuinely new and must be built in the `dag` package (it does not require a core-SDK change — the DAG scheduler owns its own completion loop, unlike Map/Parallel which delegate to `executeBatchItems`). The `CompletionOutcome`/`OutcomeSucceeded`/`OutcomeFailed` values it references are likewise new `dag`-package types.

---

## 3. Per-decision mapping table

Legend: **Ports** = carries over essentially unchanged · **Adapts** = same intent, different Go mechanism · **Infeasible/Deferred** = cannot reproduce; replaced or postponed.

| #   | JS decision (DAG_SPEC.md §)                                                          | Go disposition                                 | How / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `context.dag()` entry (§2.1)                                                         | **Adapts**                                     | `(*DagResult, error)` return; no promises/exceptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | `DagContext` with a method per task kind (§2.2)                                      | **Adapts (major)**                             | Go methods can't have type params → **free functions** `dag.Step[T](d, …)` etc. `Context` is a plain opaque handle. Result type is inferred for most kinds; `Invoke[In,Out]` and `Callback[T]` require **explicit** type args (result type appears only in the return — §2.3, verified Go 1.25).                                                                                                                                                                                                                                                                                          |
| 3   | `TaskHandle[T]` + `.after()/.triggerRule()` builder (§2.4)                           | **Ports**                                      | Generic struct with phantom `T`; builder methods return `TaskHandle[T]` (no new type param ⇒ legal on methods). `AnyHandle` sealed interface for heterogeneous deps.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | `DepsMap<TDeps>` literal-name typed access (§2.5)                                    | **Infeasible → Adapts**                        | No mapped/template-literal types. `Deps` map + `dag.Get[T](deps, handle) (T, error)`. Result **type preserved**; **key-membership check lost** (runtime `ErrDepNotAvailable`).                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | Conditional deps-first fn collapse (§2.3)                                            | **Adapts**                                     | No conditional types/overloading → uniform `func(deps Deps, native…) (T, error)`; `deps` empty for roots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | Positional typed deps ergonomics                                                     | **Deferred**                                   | `Dag2/Dag3`-style arity helpers don't fit arbitrary fan-in + builder deps. Optional 2–3-dep sugar only; deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | Name-based entity IDs (§4.2)                                                         | **Adapts + [NEEDS SDK ADDITION]**              | Both SDKs mint IDs **positionally** (a `opIDs.next()`, b `Context.NextStepID()`), then hash. Name-based `{parent}-DAG_NODE_T_{name}` requires a name-derived prefix seam: **exported in b** (`NewChildWithName`/`NextStepID`+`Checkpoint()`), **internal-only in a**. Alternatively (§4) reuse batch's deterministic index pre-claim — order-independence is then achieved as batch already does.                                                                                                                                                                                         |
| 8   | Reserved `DAG_NODE_T_` delimiter + no-dash names + injectivity proof (§4.2, App D/E) | **Ports**                                      | `regexp.MustCompile(^[a-zA-Z0-9_]+$)` + forbidden-substring check. Proof is language-independent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 9   | `TriggerRule` union + default (§2.7)                                                 | **Ports (weakly)**                             | `type TriggerRule string` + consts (open set; runtime-validated). Truth table ports verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | `runIf` sync predicate (§2.6)                                                        | **Ports**                                      | `func(Deps) bool` via `WithRunIf`. Uses `Get` for values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Completion-reason core base + DAG superset (§2.8, App C)                             | **Ports (weakly)**                             | Core `CompletionReason` string in `durable`; DAG adds one const. No closed-union enforcement; dependency direction (dag→core, not dag→batch) preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | `DagCompletionConfig` custom predicate w/ results + SKIPPED (§2.9)                   | **Ports**                                      | Struct + `func(DagCompletionStatus) CompletionDecision`; `ResultOf[T]` for typed item results. Threshold half reused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | SDK-owned `DagSummary` envelope (§8.1)                                               | **Not needed as designed**                     | No such envelope exists in either SDK. Both persist an aggregate result in the parent context's checkpoint payload (a: `batchCheckpointPayload` in `batch.go`) and offload oversize via `ReplayChildren` (256KB). The DAG reuses this: the `DagResult` is serialized as the DAG child-context's own result, and reconstructed by **re-executing `register` + reading per-task checkpoints** on replay (row 14). A summary _string_ can still ride along, but no separate authoritative envelope is required.                                                                              |
| 14  | Design-B replay reconstruction (§7.7, App F)                                         | **Ports as re-execution (design-A), verified** | Neither SDK does design-B "reconstruct-without-re-running." Both **re-execute deterministic code on replay** and let per-op checkpoint fast-paths short-circuit completed ops (a: `refreshReplayMode`/`replayTerminalBatch`; b: `checkReplayConsistency`+`GetOperation`). Oversize results trigger `ReplayChildren` → re-execute child body (a: `child_context.go`/`batch.go`; b: `invoke.go` `replayChildrenResult`). The DAG's `register` re-runs each replay, skip/trigger are recomputed, and each task hits its own checkpoint fast-path — no bespoke `reconstructDagResult` needed. |
| 15  | Heterogeneous result serdes tagged by `resultKind` (§8)                              | **Adapts (improves)**                          | Store per-task result as `json.RawMessage`; `Result[T]/Get[T]` lazy-`Unmarshal` into `T`. Sidesteps Go's "`any` loses concrete type". `resultKind` discriminator drives batch/dag **recursive** restore.                                                                                                                                                                                                                                                                                                                                                                                  |
| 16  | Concurrency: ready-set scheduler, `maxConcurrency` (§5.1–5.2)                        | **Ports (Go-native), verified**                | Both SDKs already run a bounded concurrent scheduler: firstcut-a `batch.go` pre-claims child IDs on the owner goroutine then dispatches to `sem := make(chan struct{}, concurrency)`; firstcut-a also ships public `Go[T]`/`Future[T]`/`All/Any/Race`. firstcut-b `batch.go` claims by index then spawns branch goroutines. The DAG scheduler mirrors this exact pattern. Determinism from **deterministic ID claim order**, same argument as JS §4.4.                                                                                                                                    |
| 17  | Failure = terminal state, drain by default (§5.7)                                    | **Ports**                                      | Scheduler does not cancel on task failure; drains reachable graph. Opt into fail-fast via `WithCompletion`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 18  | `throwIfError()` (§2.8)                                                              | **Adapts**                                     | `DagResult.ThrowIfError() error` returning `*DagExecutionError` (with `Unwrap`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 19  | `Dag*Error` classes (§5.10)                                                          | **Adapts**                                     | Typed `error` structs; `errors.Is/As`. Registration errors **accumulated on `Context`**, returned by `dag.Dag(...)` (see #20).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 20  | Registration-time throw ergonomics (§5.10, §6)                                       | **Adapts**                                     | Free registration fns return a handle but **cannot cleanly return an error too** without wrecking ergonomics → errors are recorded on `Context` and surfaced as the `error` return of `dag.Dag(...)`. JS throws at the call site; Go reports at `Dag()` boundary.                                                                                                                                                                                                                                                                                                                         |
| 21  | `errorMapper` pass-through so raw `Dag*Error` escapes child ctx (§7.4)               | **Ports (verified path)**                      | Both SDKs wrap a failing child body's error in `ChildContextError` (a `child_context.go`; b `invoke.go` `contextError`). Since Go can validate/aggregate registration errors **before** the child body runs, validation errors are returned directly by `Dag()` and never need to survive the child-context wrapper. Task-execution errors are already value-typed and unwrappable (`errors.As`), so no bespoke error-mapper is required.                                                                                                                                                 |
| 22  | Nested DAGs, scope isolation, ID recursion (§9.1, §10.1)                             | **Ports**                                      | `dag.Dag(d, …) TaskHandle[*DagResult]`; IDs recurse `…-DAG_NODE_T_a-DAG_NODE_T_b`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 23  | Skips checkpoint nothing (§9.5)                                                      | **Ports**                                      | Pure function of upstream terminal statuses + deterministic `runIf`; recomputed each run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 24  | Empty DAG / empty-upstream trigger rows (§5.9, §5.3)                                 | **Ports**                                      | Same evaluators incl. `len>0` guard on failure-family rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 25  | Async `register` (§10.2, §11.3)                                                      | **Adapts/Deferred**                            | Go `register` is synchronous `func(*Context)`; "async ergonomics" (`for x := range await cfg()`) is unnecessary — do deterministic setup inline. Non-deterministic work still forbidden.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 26  | Logger dedup / mode-management no-op coupling (§7.3.1)                               | **Ports (verified, different mechanism)**      | Neither SDK couples replay-mode to a "logger no-op counter" the way JS does. Replay-mode is tracked structurally: a `replayState` frontier flag flipped at first real execution (b `dcontext.go` `markRealExecution`/`isSuppressing`) or a per-context `mode` + `refreshReplayMode` probe (a `execution_context.go`). Name-keyed DAG tasks do **not** perturb any counter-coupled logger state, so the JS "bypass mode management" concern **does not arise** in Go. Lowest-risk item, not highest.                                                                                       |

---

## 4. Entity-ID strategy & replay correctness (grounded)

**Reality check (verified in both SDKs):** operation IDs are minted **positionally from a per-context counter**, then hashed — they are NOT name-based today.

- **firstcut-a** (`ids.go`, `state.go`): `opIDs.next()` returns `"1","2",…` (or `"<prefix>-N"` inside a child); `hashID` = **MD5 → first 16 hex chars**. A child context's prefix is set by `opIDs.child(entityID)` — which _does_ accept an arbitrary string — but its only caller (`RunInChildContext`) passes the **positional** `id` from `claimOperation()`. The `id`/`name` argument to operations is a display name, not the identity.
- **firstcut-b** (`context/dcontext.go`): `Context.NextStepID()` returns `SHA-256(prefix + "-" + counter)` = **64 hex chars** (deliberately matching the Java SDK's `OperationIdGenerator`). The explicit `id string` argument to `operations.Step/Map/RunInChildContext/…` becomes the wire **`Name`**, while the real operation ID is the positional hash.

**So the JS "name-based entity ID" is not free in Go — it is a [NEEDS SDK ADDITION].** There are two viable routes:

**Route A (recommended, firstcut-b): name-derived child-context prefixes via already-exported seams.** firstcut-b exposes on `*dcontext.Context`: `NewChildWithName(parentStepID, contextName)`, `NewVirtualChildWithName(contextID, contextName, reportedParentID)`, `NextStepID`, `PeekStepID`, plus `Checkpoint()` and `ExecManager()`. The DAG scheduler (a sibling of `operations`) can, per task, compute a name-based ID string `dagPrefix + "-DAG_NODE_T_" + name`, enqueue its CONTEXT START/SUCCEED via `Checkpoint()`, and run the task body in `NewChildWithName(thatID, name)` so the task's own nested ops mint under it. This reproduces the JS scheme with **no core-SDK edits** to the ID machinery.

```go
const delimiter = "DAG_NODE_T_"        // reserved; forbidden as a substring of names

func taskEntityID(parentPrefix, name string) string {
    if parentPrefix == "" {
        return delimiter + name                       // DAG_NODE_T_fetch
    }
    return parentPrefix + "-" + delimiter + name       // <hash>-DAG_NODE_T_fetch
}
```

**Route B (either branch, no new seam): deterministic index pre-claim, exactly as batch already does.** Both SDKs' Map/Parallel already solve order-independent ID assignment by claiming every child ID **by index on the single owning goroutine before dispatching** (a `batch.go` `preClaimed` loop; b's index-based claim noted in `dcontext.go`'s `mintOrder` doc). A DAG scheduler can claim task IDs positionally in **registration order** the same way. This gives replay-safe IDs with zero new seams, at the cost of losing name-stability across registration-order edits. **Route A is preferred** because DAG graphs are edited far more than linear batch bodies, and name-based IDs make skip/replay reconstruction insensitive to registration reordering.

- **Hashing is real, but the algorithm differs by branch**: firstcut-a MD5→16 hex (matches the JS `hashId` assumption the JS spec relied on); firstcut-b SHA-256→64 hex (matches Java). The DAG inherits whichever branch it is built on — **choosing firstcut-b keeps the Go DAG's IDs consistent with the Java DAG sibling.** Either way the `-` structural joins and the long `DAG_NODE_T_` token are transparent because they are hash _input_, never stored raw.
- **Injectivity** is guaranteed by the same two charset rules (no `-` in names; no `DAG_NODE_T_` substring). The JS §4.2 proof is language-independent and holds verbatim.
- **Replay correctness** rests on: (a) each task's ID is a pure function of its name + DAG prefix (Route A) or its registration index (Route B) — identical every run; (b) topological ordering guarantees deps resolve before a task runs. Completed tasks hit the per-ID checkpoint fast path — **verified real**: a `refreshReplayMode` + `state.get(hashID(id))`; b `ExecManager().GetOperation(NextStepID())` + `checkReplayConsistency(...)`. A name always maps to the same op type, so the consistency check passes.

[GO DIVERGENCE — goroutine nondeterminism is handled by pre-claim] In JS the event loop serializes; in Go, goroutines make completion order variable. Both SDKs already neutralize this by claiming IDs deterministically **before** spawning goroutines (batch precedent). The DAG scheduler MUST do the same: claim/derive every task's ID on the owning goroutine at scheduling time, never inside the worker goroutine.

---

## 5. Scheduler & concurrency (Go-native)

### 5.1 Model

The scheduler runs inside the DAG's child context (one child-context node in the parent). **Verified:** both SDKs expose a **synchronous, blocking** durable-operation API — `Step(...) (O, error)` blocks until the step is checkpointed/resolved, and suspension (waits, scheduled retries, pending callbacks) is signaled by an internal sentinel error that unwinds the call stack and ends the invocation PENDING (a: `errSuspendExecution` + `suspendSignal` in `suspend.go`; b: `errSuspended`). This is exactly the blocking model the scheduler wants.

**Verified — durable ops in worker goroutines are supported, with a rule.** firstcut-a enforces per-goroutine context ownership (`goroutine.go` `goroutineOwner`/`ErrWrongGoroutine`): a context may only issue ops from its owning goroutine; concurrent durable work MUST run in its **own child context** whose owner is captured inside the worker goroutine (`RunInChildContextAsync`/`Go` do exactly this, and `batch.go` captures `currentGoroutineOwner()` inside each worker). firstcut-b's batch likewise runs each branch's `RunInChildContext` body in its own goroutine. **Therefore the DAG scheduler MUST run each task in its own child context, capturing ownership inside the worker goroutine** — not issue multiple tasks' ops against one shared context concurrently. firstcut-a's `Future[T]` + `suspendSignal.registerFuture` machinery (settles all in-flight futures with the suspend sentinel on `fire()`) is a ready-made join primitive for this.

```go
type scheduler struct {
    tasks     []*taskDef
    results   map[string]*TaskExecution   // guarded by mu
    inFlight  map[string]struct{}
    mu        sync.Mutex
    sem       chan struct{}               // bounded worker pool; cap = maxConcurrency
    done      chan taskDone               // completions delivered here
    ctx       context.Context             // cancel => stop starting new tasks
    cancel    context.CancelFunc
}
```

- **Ready set**: a task is ready when every dep (inline ∪ builder) is terminal in `results` (SUCCEEDED/FAILED/SKIPPED). Roots ready immediately.
- **Concurrency**: `tryStartNext()` starts ready tasks while `len(inFlight) < maxConcurrency`. Each started task runs in its own goroutine, acquiring `sem` (a buffered channel of capacity `maxConcurrency`; unbounded ⇒ skip the semaphore). On completion it sends a `taskDone` to `done`; the scheduler loop drains `done`, records the terminal state, then `queueDownstream` + `tryStartNext`.
- **`errgroup` note**: `golang.org/x/sync/errgroup` with `SetLimit(n)` is a natural fit for the worker pool, **but** its cancel-on-first-error semantics are wrong for the DAG (a task failure must NOT cancel siblings — failure is terminal, §5.5). So use a plain semaphore + explicit `context.Context` that is cancelled **only** on early completion, not on task error.

[GO DIVERGENCE — scheduler is a real goroutine choreography] JS drives everything on the event loop with `.catch(()=>{})` on eager promises. Go uses an explicit scheduler goroutine + worker goroutines + a completions channel. Functionally equivalent; the readiness/trigger/`runIf`/skip logic is identical.

### 5.2 Trigger-rule evaluation (ports verbatim)

```go
var triggerRuleEvaluators = map[TriggerRule]func([]TaskStatus) bool{
    AllSuccess: func(s []TaskStatus) bool { return allAre(s, StatusSucceeded) },              // [] => true
    AllFailed:  func(s []TaskStatus) bool { return len(s) > 0 && allAre(s, StatusFailed) },   // [] => false
    AllDone:    func(s []TaskStatus) bool { return true },                                    // [] => true
    AnySuccess: func(s []TaskStatus) bool { return anyIs(s, StatusSucceeded) },               // [] => false
    AnyFailed:  func(s []TaskStatus) bool { return anyIs(s, StatusFailed) },                  // [] => false
    NoneFailed: func(s []TaskStatus) bool { return noneIs(s, StatusFailed) },                 // [] => true
}
```

Same empty-upstream semantics and the explicit `len>0` guard on `ALL_FAILED` as JS §5.3. `SKIPPED` counts as neither success nor failure.

### 5.3 `runIf`, running, skip propagation

Identical to JS §5.4–§5.6: after trigger rule passes, build `Deps` from `results` (inline deps only), evaluate `runIf(deps)`; `false` ⇒ `SKIPPED{RUN_IF_PREDICATE}`. Running a task invokes its explicit-ID operation; resolve ⇒ SUCCEEDED, error ⇒ FAILED (the returned `error` value is stored). Skips are terminal and cascade.

### 5.4 `maxConcurrency` for nested DAGs

Parent `maxConcurrency` limits only top-level tasks; each nested DAG has its own scope/limit (JS §9.2). Ports.

### 5.5 Failure semantics (ports)

A failed task is a **terminal state, not an abort**. Default (no `WithCompletion`): drain the reachable graph, then `CompletionReason` = `AllCompleted` (all succeeded/skipped) or `CompletedWithFailures` (≥1 failed). `dag.Dag(...)` returns `err == nil`; the caller inspects `res.ThrowIfError()`. This is exactly firstcut-a's batch behavior (`batch.go`: a failed item is recorded, not propagated, unless a threshold fires). With `WithCompletion`, threshold/custom predicate can stop scheduling early (cancel `ctx`; in-flight goroutines finish but their results are dropped from the DAG result — the same "stop scheduling new work, let in-flight settle" shape as batch's `reasonLocked`/`stopped` flags); they appear `STARTED`.

### 5.6 Early completion & `STARTED`

`STARTED` = a task whose goroutine was launched but the DAG resolved before it finished (early completion only). Never-started tasks are **absent** from `results` (`Status(...)` returns `(_, false)`). Same as JS §5.7/§9.6.

### 5.7 Context cancellation

`context.Context` threads through the scheduler (obtained from the base context: firstcut-a's `Context` _is_ a `context.Context`; firstcut-b via `dc.Context()`). On early completion the scheduler calls `cancel()`, which stops `tryStartNext` from launching new tasks. In-flight tasks run to their next suspension/checkpoint point and settle normally; their results are simply excluded from the DAG result (matching batch's drop-in-flight-on-early-stop behavior). Task **failure** does not cancel.

### 5.8 Config guards

- `WithMaxConcurrency(n)` with `n <= 0` ⇒ `dag.Dag(...)` returns `DagInvalidConfigError` (Go analog of the JS "throw a plain Error"; §9.4). Evaluated **before** entering the child context.
- Mutually-exclusive `DagCompletionConfig` (both threshold fields and `ShouldComplete` set) ⇒ returns `DagInvalidConfigError` before the child context (Go can validate pre-body without the terminate/never-resolve dance JS needs; §7).

---

## 6. Validation & error values

```go
// errors.go — all implement error; use errors.Is / errors.As.
type DagValidationError struct{ Errs []error }          // aggregate of registration errors
type DagInvalidTaskNameError struct{ Name, Reason string }
type DagDuplicateTaskError   struct{ Name string }
type DagInvalidDependencyError struct{ Task, Dep string }
type DagCyclicDependencyError struct{ Cycle []string }
type DagInvalidConfigError    struct{ Reason string }
type DagInvalidTriggerRuleError struct{ Rule TriggerRule }

// Thrown-equivalent for task failures at the aggregate level:
type DagExecutionError struct{ FirstFailed string; cause error }
func (e *DagExecutionError) Unwrap() error { return e.cause }
```

**Validation runs once, after `register` returns, before the scheduler starts** (JS §6). Because Go free-registration functions can't ergonomically return `(handle, error)`, each function that detects a problem (bad name §6.1, duplicate §6.2) **records the error on `Context.regErrs`** and still returns a (poisoned) handle. After `register` returns, `dag.Dag` runs missing-dep (§6.3) and cycle detection (§6.4, Kahn over `allDeps`), aggregates everything into `DagValidationError`, and returns it as the `error` result **without scheduling any task**.

[GO DIVERGENCE — deferred, aggregated validation] JS throws at the exact offending registration call (fail-fast, one error). Go collects all registration errors and returns them together from `dag.Dag(...)`. This is arguably friendlier (reports every problem at once) but loses the precise-call-site stack. A stricter variant could `panic` inside the registration function; rejected as un-idiomatic for expected/user errors.

Name rules (§6.1) port exactly: non-empty, ≤100 chars, `^[a-zA-Z0-9_]+$` (no `-`), and no `DAG_NODE_T_` substring.

**Register-callback panic** (Go analog of JS "register throws"): if the `register` func panics, `dag.Dag` recovers it, and — if it is deterministic — returns it wrapped as `DagValidationError` (no task scheduled). Non-deterministic panics violate determinism (§10) and surface as replay inconsistency. Recommend `register` never panics; return-value-style setup only.

---

## 7. Replay, checkpointing & what must be added

This section is now **grounded in real code**. The machinery the DAG depends on exists; the gaps are enumerated and scoped.

- **Explicit / name-based-ID operations — the one real seam question.** The DAG needs each task to run under a stable, name-derived ID rather than a raw positional counter.
  - **firstcut-b (has the seam, exported):** `*dcontext.Context` exposes `NewChildWithName(parentStepID, contextName)` and `NewVirtualChildWithName(contextID, contextName, reportedParentID)` — both take an **arbitrary string** as the child's ID prefix — plus `NextStepID`/`PeekStepID` on the public `types.DurableContext` and `Checkpoint()`/`ExecManager()` accessors. A `dag` package can mint `{parent}-DAG_NODE_T_{name}` IDs and drive per-task CONTEXT checkpoints directly. **No core change to the ID machinery is required.**
  - **firstcut-a (seam is internal):** `execContext.child(entityID, owner, mode)` + `opIDs.child(entityID)` do exactly the right thing but are **unexported**, and the checkpointer is private. Building the DAG on firstcut-a requires exporting a small "run a child context under an explicit entity ID" entry point.
  - **Fallback for either branch:** Route B in §4 (deterministic index pre-claim) needs no seam at all.
- **Mode-management bypass (JS §7.3.1) — does not arise in Go.** Neither SDK couples replay mode to a logger no-op counter. Replay position is structural: firstcut-a's per-context `mode`/`refreshReplayMode` (probes `state.get(pendingID)` and `pendingID+"-1"`); firstcut-b's shared `replayState` frontier (`markRealExecution`/`isSuppressing`). Name-keyed task IDs don't perturb any counter, so no bypass dance is needed.
- **Reconstruction on replay — re-execution, verified (design-A).** Neither SDK reconstructs results without re-running. Both re-execute deterministic code every replay and short-circuit completed operations via per-ID checkpoint fast-paths (a: `runStep`/`replayTerminalBatch` reading `state.get(hashID(id))`; b: `runStep`/`RunInChildContext` reading `ExecManager().GetOperation(stepID)` after `checkReplayConsistency`). The DAG follows suit: on replay, `register` re-runs, skip/trigger are recomputed from upstream terminal statuses, and each task hits its own checkpoint fast-path. No `reconstructDagResult` and no `DagSummary` envelope are needed.
- **Large payloads — verified `ReplayChildren` offload (256KB).** Both SDKs, when a child/context result exceeds `checkpointSizeLimitBytes` (256KB), checkpoint SUCCEED with an empty payload + `ReplayChildren=true`, and on replay **re-execute the child body** to reconstruct the value in memory (a: `child_context.go`, `batch.go` `checkpointBatchSuccess`; b: `invoke.go` `replayChildrenResult`). Single-op results over 750KB fail with `ResultTooLargeError` (a: `errors.go`). The DAG's aggregate `DagResult` rides the same offload path automatically because the DAG runs as a child context. There is also a checkpoint-payload envelope precedent to model the serialized `DagResult` on: firstcut-a's `batchCheckpointPayload` (`batch.go`).
- **Suspension across goroutines — verified, with the ownership rule from §5.1.** Suspension is a first-class, invocation-wide signal that settles all registered in-flight futures (a: `suspendSignal.fire()` → `settleWithSuspend` on every future) and unwinds blocked goroutines cleanly. Durable ops in worker goroutines are explicitly supported **provided each runs in its own child context with ownership captured inside the goroutine** (a: `goroutineOwner` check + `RunInChildContextAsync`; b: batch branch goroutines). This is the single most important scheduler constraint and it is satisfiable today — the DAG scheduler is structurally the same as the existing batch scheduler, just with a dependency graph instead of a flat item list.

**Net: the only genuinely new SDK-level work is the three [NEEDS SDK ADDITION] items** (custom completion predicate, name-based-ID minting entry, completion-reason supersets). Everything in this section — replay-mode determination, checkpoint fast-paths, large-payload offload, suspension, goroutine ownership — is real and reusable.

---

## 8. Serialization (`json`-based, improved by generics)

```go
type resultKind string
const ( kindPlain resultKind = "plain"; kindBatch = "batch"; kindDag = "dag" )

type serializedTaskExecution struct {
    Name       string          `json:"name"`
    Status     TaskStatus      `json:"status"`
    SkipReason SkipReason      `json:"skipReason,omitempty"`
    Kind       resultKind      `json:"resultKind,omitempty"`
    Result     json.RawMessage `json:"result,omitempty"`   // raw; typed lazily
    Err        *errorObject    `json:"error,omitempty"`
    StartedAt  *time.Time      `json:"startedAt,omitempty"`
    CompletedAt *time.Time     `json:"completedAt,omitempty"`
}
type serializedDagResult struct {
    Tasks            []serializedTaskExecution `json:"tasks"`
    CompletionReason CompletionReason          `json:"completionReason"`
}
```

[GO DIVERGENCE — `json.RawMessage` sidesteps the JS "methods lost" problem] JS must re-hydrate `BatchResult`/`DagResult` _methods_ on the completed-replay path (§8 F5), tagging by `resultKind` and recursively restoring. Go has a cleaner option: **store each task result as `json.RawMessage` and unmarshal lazily into `T` at `Result[T]`/`Get[T]` call time**, because the `TaskHandle[T]` supplies the target type. Plain results need no discriminator at all. The `resultKind` tag is still needed for **batch/dag** results whose restored form is a package type with unexported fields (`*BatchResult`/`*DagResult`) — those recurse into `restoreBatchResult`/`restoreDagResult`. This is strictly simpler than the JS approach and fully type-safe.

Errors serialize via an error object (message + type), reconstructed on replay as a `replayedError` — **verified real** in firstcut-a (`step.go` `errorObject(err)`/`errorTypeName`, `replayedError` with `errType`/`message`; `batch.go` `batchCheckpointItem` stores `ErrType`/`ErrMessage`). The DAG reuses this exact pattern for per-task error persistence; a DAG-level `DagExecutionError` type name is registered the same way any typed error is.

### 8.1 Aggregate persistence (no separate SDK-owned envelope needed)

**Verified:** neither SDK has an SDK-owned "summary envelope" concept. The aggregate result of a fan-out is simply serialized into the parent context's checkpoint payload (firstcut-a `batchCheckpointPayload{Results, Reason}` in `batch.go`) and offloaded via `ReplayChildren` when oversize. The DAG follows the same model: the `DagResult` is the DAG child-context's serialized result, reconstructed by re-execution on replay (§7). No authoritative envelope, and no separate `startedTaskNames` persistence, is required — the `STARTED` set (§5.6) is only meaningful within a single live drain and is recomputed, not persisted.

If a human-readable summary string is desired, it is an **observability-only** field on the serialized result (never read on replay for control-flow), mirroring how firstcut-a keeps checkpoint payloads authoritative and derived values recomputed:

```go
type serializedDagResult struct {
    Tasks            []serializedTaskExecution `json:"tasks"`
    CompletionReason CompletionReason          `json:"completionReason"`
    Summary          string                    `json:"summary,omitempty"` // observability only; never read on replay
}
```

`WithSummaryGenerator` output goes only into `Summary`; a missing/malformed value never changes the result and never hangs, because the authoritative data is the per-task `Tasks` array (each backed by its own checkpoint).

---

## 9. Worked examples (Go)

### 9.1 Compensation with trigger rules (JS §13.2)

```go
res, err := c.Dag("payment", func(d *dag.Context) {
    charge := dag.Step(d, "charge", nil,
        func(_ dag.Deps, s *durable.StepContext) (Receipt, error) { return chargeCard(event) })

    dag.Step(d, "fulfill", []dag.AnyHandle{charge},
        func(deps dag.Deps, s *durable.StepContext) (Void, error) {
            r, _ := dag.Get(deps, charge)
            return Void{}, fulfill(r)
        }) // default ALL_SUCCESS

    dag.Step(d, "refund", nil,
        func(_ dag.Deps, s *durable.StepContext) (Void, error) { return Void{}, refundCard(event) }).
        After(charge).WithTrigger(dag.AllFailed)

    dag.Step(d, "notify", nil,
        func(_ dag.Deps, s *durable.StepContext) (Void, error) { return Void{}, notify(event) }).
        After(charge).WithTrigger(dag.AllDone)
})
```

### 9.2 Rules engine with custom completion (JS §13.4)

```go
res, err := c.Dag("rules", func(d *dag.Context) {
    for _, r := range rules {
        r := r
        dag.Step(d, "rule_"+r.ID, nil,   // r.ID must satisfy name rules (no dash, no DAG_NODE_T_)
            func(_ dag.Deps, s *durable.StepContext) (Verdict, error) { return evaluate(r) })
    }
},
    dag.WithMaxConcurrency(5),
    dag.WithCompletion(dag.DagCompletionConfig{
        ShouldComplete: func(st dag.DagCompletionStatus) dag.CompletionDecision {
            for _, it := range st.Items {
                if it.Status == dag.StatusSucceeded {
                    if v, ok := dag.ResultOf[Verdict](it); ok && v.Decision == "REJECT" {
                        return dag.CompleteDag(durable.OutcomeFailed)
                    }
                }
            }
            return dag.ContinueDag()
        },
    }),
)
if err == nil && res.CompletionReason() == durable.CustomCompletionFailed {
    // a rule rejected; res.ThrowIfError() != nil
}
```

---

## 10. Determinism & scoping rules (port)

- `register` must be deterministic (same names, deps, rules every replay). No non-deterministic IO in `register`; put it in tasks. Non-determinism surfaces as replay-consistency failures on task IDs — **verified real**: firstcut-a returns `NonDeterministicReplayError` from `validateReplayConsistency` (`errors.go`); firstcut-b returns an error from `checkReplayConsistency` (`step.go`/`wait_for_condition.go`). Use the base SDK's replay-safe time source for any timestamps in `register` (a: none exposed — keep it pure; b: `durable.CurrentTime(dc)` in `determinism.go`).
- Name uniqueness is scoped to the immediate `Context`; nested DAGs open a fresh scope; a dep handle must belong to the same scope (missing-dep check, §6).

---

## 11. Open questions (Go-specific)

1. **Deps key-membership checking (§2.5).** Result _types_ are preserved via `TaskHandle[T]`, but there is no compile-time guarantee that a handle passed to `Get` is actually in the task's deps list. _Recommendation:_ accept as a documented limitation; optionally add a `go vet`-style analyzer. Revisit `Dag2/Dag3` positional helpers (§2.5) for the common small-fan-in case if friction appears.
2. **Blocking durable ops in goroutines (§7) — RESOLVED.** Verified supported in both SDKs, subject to the ownership rule: each concurrent task must run in its own child context with `currentGoroutineOwner()` captured inside the worker goroutine (firstcut-a `goroutine.go`/`RunInChildContextAsync`; firstcut-b batch branch goroutines). The DAG scheduler is structurally the existing batch scheduler with a dependency graph. _Recommendation:_ port firstcut-a's `Go[T]`/`Future[T]`/`suspendSignal` join primitives if building on b (b lacks public equivalents).
3. **Open enums (§2.6, §2.8).** Go can't close `TriggerRule`/`CompletionReason`. _Recommendation:_ runtime validation + exhaustive-switch linters.
4. **Typed options (§2.9).** `WithCondition[S]` erases its type into the config (initial state is now a positional param, C7). _Recommendation:_ validate the type at registration against the `TaskHandle[T]` where possible.
5. **Aggregated vs fail-fast validation (§6).** Go returns all registration errors at once. Confirm this is the desired ergonomics vs. first-error.

---

## 12. Testing outline (Go)

Use the standard `testing` package + the base SDK's real local runner (**verified**: firstcut-a `durable/durabletest` `runner.go` with `SkipTime`; firstcut-b `pkg/durable/testing` `runner.go`, both with in-memory checkpoint clients and by-name operation lookup), with `-race` always on (goroutine scheduler).

- **`validate_test.go`**: cycle detection (self-loop, 2-cycle, deep, diamond=no-cycle), invalid names (empty, >100, dash, `DAG_NODE_T_` substring), duplicates across kinds, missing/foreign-scope deps, aggregated `DagValidationError`.
- **`trigger_test.go`**: full truth table × 6 rules × {all-succ, all-fail, mixed, includes-skip, empty}.
- **`handle_test.go`**: `After`/`WithTrigger` mutate the `taskDef`; `Get[T]`/`Result[T]` type correctness (compile-time via generic instantiation; runtime `ErrDepNotAvailable` for missing).
- **`scheduler_test.go`** (mock context): readiness/topological order; `maxConcurrency` throttling (assert peak in-flight ≤ N); skip propagation; `runIf`; threshold + custom completion; drain-vs-fail-fast; **`-race` clean**.
- **`result_test.go`**: `Result`/`Status` for succeeded/failed/skipped/not-started; `ThrowIfError()`; JSON round-trip incl. error reconstruction and `json.RawMessage` lazy typing; nested batch/dag recursive restore; serialized-result shape (§8.1).
- **Entity-ID tests**: `taskID` for prefixed/unprefixed; nested recursion `…-DAG_NODE_T_a-DAG_NODE_T_b`; disjoint from counter IDs.
- **Replay tests** (real runner, both branches ship one): order-independence (force differing completion orders via the runner; assert identical `DagResult`, no replay-consistency error); interruption/resume (completed tasks hit fast paths, count side effects); skip determinism across replay; large-payload reconstruction via `ReplayChildren` re-execution (assert the oversize `DagResult` survives a suspend/resume cycle; a malformed-`summary` regression guard that must neither change the result nor hang).
- **Verification bar**: `go build ./...`, `go vet ./...`, `go test -race ./...`, `golangci-lint`.

---

## 13. Cross-language note

This Go spec is one leaf of a four-language effort (JS canonical + Python / Java / Go). The **shared normative core** (`DAG_NODE_T_` delimiter, no-dash names, injectivity, topological scheduling + trigger/`runIf`/skip semantics, completion-reason core+superset, drain-by-default failure model, determinism rules) is identical across all languages and lives in the central cross-language document. Go's **per-language divergences**: free-function registration + free `dag.Dag(dc,…)` entry (no generic methods — validated by both real SDKs), `Deps`+`Get[T]` (no `DepsMap`), uniform fn shape (no conditional types), open enums (no closed unions), `error`-value flow (no exceptions), aggregated validation, goroutine-pool scheduling, and **positional+hashed IDs with a name-derived-prefix seam** (not intrinsic name-based IDs). Notably, choosing **firstcut-b** keeps the Go DAG's SHA-256 ID hashing aligned with the **Java** DAG sibling.

---

## 14. firstcut/a vs firstcut/b — structural differences that matter for DAG, and the recommendation

| Concern (DAG-relevant)     | firstcut/a (flat `durable/`)                                                                                                                                 | firstcut/b (layered `pkg/durable/…`)                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explicit-ID seam**       | `execContext.child(entityID)` + `opIDs.child` exist but are **unexported**; checkpointer private. Needs a new exported entry.                                | `NewChildWithName`/`NewVirtualChildWithName`/`NextStepID`/`PeekStepID` + `Checkpoint()`/`ExecManager()` **exported** on `*dcontext.Context`. Name-derived prefixes buildable **with no core edit**. |
| **ID hashing**             | MD5 → 16 hex (matches JS `hashId`)                                                                                                                           | SHA-256 → 64 hex (**matches Java** — cross-SDK consistency with the Java DAG spec)                                                                                                                  |
| **Concurrency primitives** | Rich & public: `Go[T]`, `Future[T]`, `All/Any/Race/AllSettled`, `StepAsync`, `RunInChildContextAsync`, `suspendSignal` join. Ready-made scheduler substrate. | Map/Parallel only; internal goroutine pool. No public `Go`/`Future` to reuse.                                                                                                                       |
| **Package boundaries**     | One flat package — DAG would be `durable/dag` but must reach private internals.                                                                              | Clean split (`context`/`operations`/`checkpoint`/`execmgr`/`types`); `dag` sits naturally beside `operations`. Also ships `insight/` observability.                                                 |
| **Virtual/flat nesting**   | `NestingFlat` in `batch.go`                                                                                                                                  | `NewVirtualChildWithName` first-class — directly useful for DAG scope isolation                                                                                                                     |
| **Completion config**      | threshold-only (`CompletionConfig` + `shouldStopMin/Failure`)                                                                                                | threshold-only (`types.CompletionConfig`, pointer fields)                                                                                                                                           |
| **Serdes signature**       | `Serdes{Marshal/Unmarshal}`                                                                                                                                  | `types.Serdes{Serialize(v,entityID,execARN)/Deserialize}`                                                                                                                                           |
| **Module path quirk**      | `aws-durable-execution-sdk-go`-style                                                                                                                         | go.mod module path is `…-sdk-csharp` (a naming artifact; behavior matches Java)                                                                                                                     |

**Recommendation: build the DAG on firstcut/b (layered).** Rationale, in priority order:

1. **The DAG's hardest dependency — a name-derived-ID seam — is already exported in b** (`NewChildWithName`/`NextStepID`/`Checkpoint()`), so name-based `{parent}-DAG_NODE_T_{name}` task IDs are achievable with no edit to the core ID machinery. In a, the same capability exists only as unexported internals and would require new public surface.
2. **SHA-256 IDs align the Go DAG with the Java DAG sibling**, aiding cross-language conformance.
3. **The layered package structure gives the `dag` package a clean home** beside `operations`, sharing `context`/`checkpoint`/`execmgr` without reaching into private internals.
4. **Trade-off, mitigated:** b lacks public `Go`/`Future`/combinators, so the DAG scheduler must build its own bounded goroutine pool — but that is exactly what §5 already specifies, and **firstcut/a's `Go[T]`/`Future[T]`/`suspendSignal` implementation is a proven pattern to port** (they are ~200 lines total across `future.go`/`goroutine.go`/`suspend.go`/`combinators.go`).

If instead the priority were fastest-possible prototype of the scheduler itself (not production ID stability), firstcut/a's ready-made `Go`+`Future`+`Race`/`All` would let a DAG scheduler be sketched in a day — at the cost of adding an exported explicit-ID seam and diverging from Java's hashing.

---

## 15. Go readiness verdict

**Ready to implement — on firstcut/b, after three additive SDK extensions.** The correctness-critical substrate is all present and verified: positional+hashed IDs with per-op checkpoint fast-path replay, replay-consistency validation, child-context scope isolation, 256KB `ReplayChildren` large-payload offload (re-execution model, like Java/Python), invocation-wide suspension with goroutine-ownership-safe concurrent child contexts, value-typed errors, and a local test runner — nothing needs rearchitecting.

**Must be added to the base SDK first (all additive, none structural):** (1) a **custom completion predicate** `ShouldComplete(status)→decision` with per-task results + `SKIPPED` (both SDKs are threshold-only — the DAG owns this in its own scheduler loop); (2) a thin **name-based-ID task seam** — trivial on b via the exported `NewChildWithName`+`Checkpoint()` (or fall back to §4 Route B index pre-claim, which needs nothing); (3) **completion-reason supersets** (`CUSTOM_COMPLETION_*`, `COMPLETED_WITH_FAILURES`). Everything else the DAG needs is reuse, not new work.
