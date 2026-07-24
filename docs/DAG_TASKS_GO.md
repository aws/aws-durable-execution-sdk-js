# DAG Implementation Tasks — Go (`dag.Dag(...)`)

> **Status: EXPERIMENTAL.** Every exported DAG symbol's doc comment MUST end with an
> `// Experimental: This API is experimental and may be changed or removed in future releases.`
> paragraph (Go pre-stable convention, per `DAG_SPEC_GO.md` banner).
>
> **Base:** `firstcut/b` (`/Users/parpooya/workplace/go-firstcut-b`) — layered `pkg/durable/…`,
> module `github.com/aws/aws-durable-execution-sdk-go`. Chosen because the name-derived-ID seam
> is already **exported** (`context/dcontext.go`), SHA-256 IDs align with the Java DAG sibling,
> and the `dag` package sits cleanly beside `operations/`.
>
> **Feature package (new):** `pkg/durable/dag/` — import path
> `github.com/aws/aws-durable-execution-sdk-go/pkg/durable/dag`.
>
> Source spec: [`DAG_SPEC_GO.md`](./DAG_SPEC_GO.md) (canonical design: [`DAG_SPEC.md`](./DAG_SPEC.md)).
> Ordering is strict: tasks are PR-sized and each depends only on earlier tasks. **Tasks 1–3 are the
> three GATING base-SDK additive extensions from §15 and MUST land before any `dag`-package work.**

---

## Phase 0 — GATING base-SDK additive extensions (§15; must merge first)

These are the only genuinely new base-SDK work. All three are additive; none rearchitects the SDK.

### ☐ Task 1 — Name-based task-ID seam

- **Spec:** §4 (Route A), §7 ("explicit / name-based-ID operations"), §15(2).
- **Files:** `pkg/durable/context/dcontext.go` (exported seams already present:
  `NewChildWithName` L305, `NewVirtualChildWithName` L332, `NextStepID` L687, `PeekStepID` L705,
  `ExecManager()` L748, `Checkpoint()` L752, `hashOperationID` L520). Add a thin exported helper
  (e.g. `RunChildUnderEntityID(entityID, name string, ...)`) if a single-call "run body under an
  explicit `{parent}-DAG_NODE_T_{name}` entity ID + drive its CONTEXT START/SUCCEED checkpoints"
  entry is not already expressible from the existing seams.
- **Dependencies:** none.
- **Acceptance:**
  1. Given a parent prefix and task name, the seam mints a deterministic ID
     `{parent}-DAG_NODE_T_{name}` (empty prefix ⇒ `DAG_NODE_T_{name}`), stable across replays and
     independent of registration/completion order; hashed via existing `hashOperationID` (SHA-256).
  2. A body run under the seam reuses the existing per-op checkpoint fast-path
     (`ExecManager().GetOperation` + replay-consistency) with **no** core edit to the ID counter.
  3. Exported symbol carries an `// Experimental:` doc comment; unit test in
     `pkg/durable/context/dcontext_test.go` covers prefixed/unprefixed + nested recursion.

### ☐ Task 2 — Custom completion predicate (per-task results + `SKIPPED`)

- **Spec:** §2.10, §5.8, §15(1).
- **Files:** `pkg/durable/types/types.go` (add shared value types: `CompletionDecision`,
  `CompletionOutcome`/`OutcomeSucceeded`/`OutcomeFailed`; extend the completion-status view with
  per-item results + a `SKIPPED` item status — today `CompletionConfig` here is threshold-only,
  pointer fields). Predicate evaluation is threaded where batch completion is decided
  (`pkg/durable/operations/batch.go`, `shouldStopMin`/`shouldStopFailure`). NOTE: the DAG owns its
  own completion loop, so the results-aware `ShouldComplete` hook itself is consumed in the `dag`
  package (Task 11); this task adds only the **shared, additive** decision/outcome/status types so
  Map/Parallel could adopt them later.
- **Dependencies:** none (parallel to Task 1).
- **Acceptance:**
  1. `ShouldComplete(status) CompletionDecision` signature exists where `status` exposes per-task
     **results** and a `SKIPPED` status (both absent from the current threshold-only status).
  2. `ContinueDag()` / `CompleteDag(OutcomeSucceeded|OutcomeFailed)` factories build opaque
     `CompletionDecision` values; threshold mode remains fully backward-compatible.
  3. Exported symbols carry `// Experimental:`; a table test covers continue-vs-complete and the
     SKIPPED-aware status projection.

### ☐ Task 3 — Completion-reason supersets

- **Spec:** §2.8, §15(3).
- **Files:** `pkg/durable/operations/batch.go` (string `CompletionReason` consts live here —
  `CompletionReasonAllCompleted`/`…MinSuccessfulReached`/`…FailureToleranceExceeded`). Add
  `CustomCompletionSucceeded` = `"CUSTOM_COMPLETION_SUCCEEDED"` and `CustomCompletionFailed` =
  `"CUSTOM_COMPLETION_FAILED"`. (`COMPLETED_WITH_FAILURES` is DAG-only and is declared in the `dag`
  package in Task 4, not here — preserves the `dag → core`, never `core → dag`, direction.)
- **Dependencies:** none (parallel to Tasks 1–2).
- **Acceptance:**
  1. Two new consts of the existing `CompletionReason` string type; no change to the three
     threshold reasons.
  2. `String()`/JSON round-trip covers the new members; existing batch tests stay green.
  3. New consts carry `// Experimental:` doc comments.

---

## Phase 1 — DAG public surface (value-typed)

### ☐ Task 4 — Public types, enums & error values

- **Spec:** §2.6 (`TriggerRule`), §2.7 (`TaskStatus`/`SkipReason`/`TaskExecution`/`DagResult` shells),
  §2.8 (`CompletedWithFailures`), §6 (error values).
- **Files:** `pkg/durable/dag/trigger.go` (`TriggerRule` + 6 consts), `pkg/durable/dag/result.go`
  (`TaskStatus`, `SkipReason`, `TaskExecution`, `DagResult` skeletons, `resultKind`),
  `pkg/durable/dag/completion.go` (`CompletedWithFailures` const), `pkg/durable/dag/errors.go`
  (`DagValidationError`, `DagInvalidTaskNameError`, `DagDuplicateTaskError`,
  `DagInvalidDependencyError`, `DagCyclicDependencyError`, `DagInvalidConfigError`,
  `DagInvalidTriggerRuleError`, `DagExecutionError` with `Unwrap`).
- **Dependencies:** Task 3 (references core `CompletionReason` type).
- **Acceptance:**
  1. All enums are open `string`-typed consts (§2.6/§2.8); errors implement `error` and support
     `errors.Is`/`errors.As` (`DagExecutionError.Unwrap()` returns the first failed task's cause).
  2. `go build ./pkg/durable/dag/...` compiles the type-only package.
  3. Every exported type/const/func carries an `// Experimental:` doc comment.

### ☐ Task 5 — Free-function registration + `TaskHandle[T]` + `Deps`/`Get[T]`

- **Spec:** §2.2–§2.5 (free functions, no generic methods), §2.9 (functional options).
- **Files:** `pkg/durable/dag/dag.go` (`Context` opaque handle; `Option` + `With*` options;
  `Dag(dc, name, register, opts...)` entry **stub** returning `(*DagResult, error)`),
  `pkg/durable/dag/handle.go` (`AnyHandle` sealed iface, generic `TaskHandle[T]` with `DependsOn`/
  `WithTrigger` builder methods), `pkg/durable/dag/deps.go` (`Deps`, `Get[T]`, `MustGet[T]`,
  `ErrDepNotAvailable`, `ErrDepTypeMismatch`), plus registration free funcs `Step[T]`, `Invoke[In,Out]`,
  `Callback[T]`, `Wait`, `WaitForCondition[S]`, `Child[T]`, `Map[In,Out]`, `Parallel[Out]`, nested `Dag`.
  Base-SDK aliases: `type DurableContext = types.DurableContext`, `type StepContext = types.StepContext`.
- **Dependencies:** Task 4.
- **Acceptance:**
  1. Registration funcs are free (mint new `T`); `DependsOn`/`WithTrigger` are methods on
     `TaskHandle[T]` (no new type param) and chain. `Get[T]` returns the upstream's typed value.
  2. **Divergence documented in doc comments:** `Invoke[In, Out]` and `Callback[T]` REQUIRE explicit
     type args (result type appears only in the return; verified Go 1.25) — every other kind infers.
  3. `go build ./...` passes; exported symbols carry `// Experimental:`.

---

## Phase 2 — Validation, scheduling, results

### ☐ Task 6 — Validator (names, duplicates, missing deps, cycles)

- **Spec:** §6, §5.8 (config guards), §2.6 (unknown trigger rule).
- **Files:** `pkg/durable/dag/validate.go`.
- **Dependencies:** Task 5.
- **Acceptance:**
  1. Enforces name rules (`^[a-zA-Z0-9_]+$`, ≤100, non-empty, no `DAG_NODE_T_` substring),
     duplicate detection across all kinds, missing/foreign-scope dep detection, and Kahn-based cycle
     detection; aggregates into `DagValidationError` returned by `Dag(...)` **before** scheduling.
  2. `WithMaxConcurrency(n<=0)` and mutually-exclusive `DagCompletionConfig` (threshold + custom both
     set) return `DagInvalidConfigError` before entering the child context.
  3. `validate_test.go` covers self-loop, 2-cycle, deep cycle, diamond (no cycle), each name
     violation, duplicates, missing/foreign dep, aggregated multi-error.

### ☐ Task 7 — Goroutine-based executor / scheduler

- **Spec:** §5.1–§5.7 (ready-set, `maxConcurrency`, trigger eval, `runIf`, skip propagation,
  drain-by-default failure, early completion `STARTED`, cancellation), §4 (deterministic ID pre-claim).
- **Files:** `pkg/durable/dag/scheduler.go`, trigger evaluators in `pkg/durable/dag/trigger.go`.
- **Dependencies:** Task 6; Task 1 (name-based IDs); Task 2 (decision types for early completion).
- **Acceptance:**
  1. Bounded worker pool (plain semaphore + `context.Context`, **not** `errgroup` cancel-on-error);
     each task runs in its **own child context** with `currentGoroutineOwner()` captured inside the
     worker goroutine; task IDs are claimed/derived on the owning goroutine **before** spawning
     (deterministic per §4). `-race` clean.
  2. Trigger truth table ports verbatim (empty-upstream rows + `len>0` guard on `ALL_FAILED`);
     `runIf`=false ⇒ `SKIPPED{RUN_IF_PREDICATE}`; failures are terminal (no sibling cancel);
     early completion cancels only new starts, in-flight settle and are dropped (`STARTED`).
  3. `scheduler_test.go` (mock context): topological order, peak in-flight ≤ N, skip cascade,
     threshold + custom completion, drain-vs-fail-fast. Exported symbols `// Experimental:`.

### ☐ Task 8 — `DagResult` + serdes (lazy `json.RawMessage`) + large-payload re-execution

- **Spec:** §2.7 (getters), §8 (serialization, `resultKind`), §8.1 (aggregate persistence),
  §7 (`ReplayChildren` 256KB offload, re-execution model).
- **Files:** `pkg/durable/dag/result.go` (`Result[T]`, `Status`, `Succeeded/Failed/Skipped/Results`,
  counts, `CompletionReason`, `Err()`; `serializedTaskExecution`/`serializedDagResult`;
  `restoreBatchResult`/`restoreDagResult` recursion; error object round-trip modeled on the base
  SDK's `errorObject`/`replayedError`).
- **Dependencies:** Task 5 (`TaskHandle[T]`), Task 7 (produces `TaskExecution`s).
- **Acceptance:**
  1. Per-task result stored as `json.RawMessage`, lazily unmarshaled into `T` at `Result[T]`/`Get[T]`
     (no manual assertion); `resultKind` drives recursive restore of nested `*BatchResult`/`*DagResult`.
  2. `Err()` returns `*DagExecutionError` when `FailureCount()>0` or reason == `CustomCompletionFailed`,
     else `nil`; `Summary` field is observability-only (never read on replay).
  3. `result_test.go`: succeeded/failed/skipped/not-started getters, JSON round-trip incl. error
     reconstruction and nested recursion. Exported symbols `// Experimental:`.

---

## Phase 3 — Wiring, tests, docs

### ☐ Task 9 — Wire the `Dag(dc, …)` entry to the base context

- **Spec:** §2.1, §4 (Route A), §5.7 (cancellation from `dc.Context()`), §7.
- **Files:** `pkg/durable/dag/dag.go` (replace Task 5 stub): run the whole DAG as one child context
  via `NewChildWithName`/`Checkpoint()`/`ExecManager()` (Task 1 seam); thread `dc.Context()` into the
  scheduler; enforce config guards (Task 6) before the child body.
- **Dependencies:** Tasks 6, 7, 8.
- **Acceptance:**
  1. `Dag(...)` returns `err != nil` for registration/validation/config failures (nothing scheduled),
     `err == nil` with task failures reported inside `res.Err()` (the JS reject-vs-resolve split).
  2. The aggregate `DagResult` rides the existing `ReplayChildren` offload automatically when >256KB.
  3. Entry doc comment carries the `// Experimental:` paragraph exactly as in the spec banner.

### ☐ Task 10 — Unit tests: handles, deps, entity IDs, trigger

- **Spec:** §12 (testing outline).
- **Files:** `pkg/durable/dag/handle_test.go`, `deps_test.go`, `trigger_test.go`, entity-ID tests
  (in `dag_test.go`).
- **Dependencies:** Tasks 5, 7, 8.
- **Acceptance:**
  1. `DependsOn`/`WithTrigger` mutate the underlying `taskDef`; `Get[T]` type correctness + runtime
     `ErrDepNotAvailable` for a non-inline/failed/skipped dep.
  2. `taskID` tests for prefixed/unprefixed and nested recursion
     `…-DAG_NODE_T_a-DAG_NODE_T_b`, disjoint from positional counter IDs.
  3. Full trigger truth table × 6 rules × {all-succ, all-fail, mixed, includes-skip, empty}.

### ☐ Task 11 — Runner integration + replay tests (custom-completion loop consumed here)

- **Spec:** §7, §12, §2.10 (DAG-owned completion loop consuming Task 2's `ShouldComplete`).
- **Files:** `pkg/durable/dag/dag_replay_test.go` using `pkg/durable/testing` runner
  (`runner.go`, in-memory checkpoint client, by-name op lookup, `SkipTime`); wire the results-aware
  `ShouldComplete` predicate into the scheduler's completion loop.
- **Dependencies:** Tasks 2, 9, 10.
- **Acceptance:**
  1. Order-independence: force differing completion orders → identical `DagResult`, no
     replay-consistency error; interruption/resume hits per-task fast-paths (side effects counted once).
  2. Custom `ShouldComplete` with per-task results + `SKIPPED` yields `CustomCompletionSucceeded`/
     `CustomCompletionFailed`; skip determinism holds across replay.
  3. Large-payload `DagResult` survives a suspend/resume cycle via `ReplayChildren` re-execution;
     `go test -race ./pkg/durable/dag/...` passes.

### ☐ Task 12 — Docs, package doc & example

- **Spec:** §9 (worked examples), §13 (cross-language note), banner.
- **Files:** `pkg/durable/dag/doc.go` (package-level `// Experimental:` overview), README section,
  `examples/dag-go/` (diamond + compensation-with-trigger-rules + rules-engine custom-completion,
  mirroring §9.1/§9.2).
- **Dependencies:** Task 11.
- **Acceptance:**
  1. Package doc states EXPERIMENTAL, the free-function API, and the `Invoke`/`Callback`
     explicit-type-arg divergence.
  2. Example builds and its `handler_test.go` passes under the local runner.
  3. `go vet ./...` + `golangci-lint` clean across the `dag` package and example.

---

**Total: 12 ordered tasks** (3 GATING Phase-0 base-SDK prerequisites — name-based-ID seam, custom
completion predicate with per-task results + SKIPPED, completion-reason supersets — which MUST merge
before the 9 `dag`-package tasks). Recommended base: **firstcut/b**.
