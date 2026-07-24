# DAG Implementation Task Breakdown — Python (`context.dag()`)

> **Source spec:** [`DAG_SPEC_PYTHON.md`](./DAG_SPEC_PYTHON.md) (canonical design: [`DAG_SPEC.md`](./DAG_SPEC.md)).
> **Target repo:** `aws-durable-execution-sdk-python`, package `src/aws_durable_execution_sdk_python/`.
> **Stability:** ⚠️ **EXPERIMENTAL** in all languages. Every public symbol MUST carry a Sphinx `.. warning:: **Experimental.**` docstring admonition, and `context.dag()` MUST emit a one-time `FutureWarning` on first use (spec ⚠️ header).

## Grounding notes (real repo layout vs. spec citations)

Verified against the local checkout; a few spec paths are aspirational and are corrected here:

- **`concurrency` is a single module, not a package.** The repo ships `src/.../concurrency.py` — there is **no** `concurrency/models.py` or `concurrency/executor.py`. `BatchResult`, `CompletionConfig`/`CompletionReason` (via `config.py`), `ExecutionCounters`, and `ConcurrentExecutor` all live in `concurrency.py`. Reuse-verbatim references target `concurrency.py`.
- **New DAG code lands under the existing `operation/` package** (`operation/dag*.py`) plus the public `dag.py` at package root — both directories exist.
- **Exception bases:** `exceptions.py` defines `DurableExecutionsError` (root), `ValidationError`, `FatalError`, `UserlandError`, `CallableRuntimeError`, `SuspendExecution`/`TimedSuspendExecution`. The spec's `DurableOperationError` does **not** exist — new `Dag*Error` types subclass `DurableExecutionsError` (validation ones subclass `ValidationError`).
- **`OperationIdentifier`** (`identifier.py`) has fields `operation_id`, `parent_id`, `name` **only** — no `sub_type`. Native subtype is supplied to the executor/config, not to the identifier.
- **Tests** live in `tests/operation/*_test.py` and `tests/e2e/*_int_test.py`; there is **no** `conformance-tests/` directory. "Conformance handlers" map onto `tests/e2e/`.
- **No blocking base-SDK prerequisite.** Unlike some other languages, the Python SDK already has every primitive the DAG needs (name-independent child IDs via `_create_step_id_for_logical_step`, `ChildOperationExecutor` fast paths, `ThreadPoolExecutor`/`TimerScheduler`, threshold `CompletionConfig`). The DAG is purely additive — **Python can start immediately**.

---

## Ordered subtasks

### T1 — Types, enums & error taxonomy (foundation)

- **Spec:** §2.5, §2.6, §2.7, §7.2, §9
- **Files:** `dag.py` (new — skeleton: `TriggerRule`, `TaskStatus`, `SkipReason`, `DagCompletionReason`, `TaskExecution`, `DagConfig`, plus type aliases `DepsArg`); `exceptions.py` (extend); `lambda_service.py` (add `OperationSubType.DAG = "Dag"`).
- **Deps:** none.
- **Acceptance:**
  1. `TriggerRule` (6 members), `TaskStatus`, `SkipReason`, and `DagCompletionReason` (4 members: 3 value-compatible with `CompletionReason` + `COMPLETED_WITH_FAILURES`) defined; `DagConfig` frozen dataclass reuses existing `CompletionConfig`/`SerDes` types.
  2. `DagExecutionError`, `DagCyclicDependencyError`, `DagInvalidTaskNameError`, `DagDuplicateTaskError`, `DagInvalidDependencyError` added — validation errors subclass `ValidationError`, `DagExecutionError` subclasses `DurableExecutionsError`; `DagExecutionError` registered in the `ErrorObject` reconstruction registry.
  3. Every public symbol carries the `.. warning:: **Experimental.**` docstring admonition.

### T2 — Name-based entity-ID minting seam (`_create_task_id` + explicit-ID invocation)

- **Spec:** §1.1, §4.1–§4.3, §6.2, §6.3
- **Files:** `context.py` (add `_create_task_id`; add private explicit-ID executor-invocation helper that builds an `OperationIdentifier(operation_id=…, parent_id=…, name=…)` and calls `.process()` **without** the `_replay_aware` wrapper).
- **Deps:** T1.
- **Acceptance:**
  1. `_create_task_id(name)` returns `blake2b(f"{prefix}-DAG_NODE_T_{name}")[:64]` (prefix = the container's already-hashed `operation_id`; unprefixed form when no prefix) and never touches `_step_counter`/`_peek_next_operation_id`.
  2. A unit test drives one explicit-ID `StepOperationExecutor` through the seam and confirms it checkpoints under the name-based id and hits its checkpoint fast path on a second call (bypassing `_replay_aware`), mirroring `concurrency.py::_execute_item_in_child_context`.
  3. Per-level hashing verified: no raw multi-level pre-image (`…-DAG_NODE_T_a-DAG_NODE_T_b`) is ever composed.

### T3 — `DagContext` registration + `TaskHandle` + `DepsMap` + `TaskDef`

- **Spec:** §2.2, §2.3, §2.4, §3, §7.4
- **Files:** `dag.py` (public `DagContext` protocol, `TaskHandle`, `DepsMap`); `operation/dag_context.py` (new — `DagContextImpl`, `TaskDef`).
- **Deps:** T1, T2.
- **Acceptance:**
  1. `DepsMap(Mapping[str, Any]).__getitem__` dispatches at runtime on `isinstance(key, TaskHandle)` (extract `_name`) vs. `str`, with `@overload`s so `deps[handle] -> T` type-checks and `deps["name"] -> Any`.
  2. `TaskHandle` is `@dataclass(eq=False)` with `__hash__ = hash(self._name)`; `.after(*handles)` and `.trigger_rule(rule)` mutate the backing `TaskDef` (`all_deps` / `trigger_rule`) and return `self` for chaining.
  3. Each `DagContext` method resolves the name via the real `_resolve_step_name` semantics (`name or func._original_name`), raises `DagInvalidTaskNameError` when it resolves to `None`, stores a `TaskDef` (`inline_deps` vs. `all_deps = inline_deps ∪ after`, native `config`, bound explicit-ID `executor`), and returns a `TaskHandle`; `invoke` accepts the deferred `payload_fn: Callable[[DepsMap], P] | P`.

### T4 — DAG validator

- **Spec:** §9, §10.1
- **Files:** `operation/dag_validator.py` (new).
- **Deps:** T3.
- **Acceptance:**
  1. Rejects invalid names (empty, >100 chars, non-`^[a-zA-Z0-9_]+$` / contains `-`, or contains `DAG_NODE_T_`) with `DagInvalidTaskNameError`; duplicate names with `DagDuplicateTaskError`; deps not registered in the current scope with `DagInvalidDependencyError`.
  2. Cycle detection via Kahn's algorithm over `all_deps` (O(V+E)) raises `DagCyclicDependencyError` listing the cyclic task names; diamond graphs pass.
  3. Runs once, after `register`, and is deterministic (identical result on replay).

### T5 — Dedicated `DagExecutor` scheduler

- **Spec:** §5, §5.1, §6.1, §6.3
- **Files:** `operation/dag_executor.py` (new).
- **Deps:** T3 (consumes T4 output via the handler in T7).
- **Acceptance:**
  1. Topological scheduler: readiness gated on all `all_deps` being terminal; ready waves submitted to `ThreadPoolExecutor(max_workers = max_concurrency or len(tasks))`; downstream re-derived via `add_done_callback`. `max_concurrency <= 0` surfaces `ValidationError` (raised in the handler, T7).
  2. Trigger-rule truth table ported verbatim (incl. empty-upstream row and `ALL_FAILED` `len > 0` guard); `run_if=False` ⇒ `SKIPPED`/`RUN_IF_PREDICATE`; SKIPPED mints no id and writes no checkpoint; skip propagation ported.
  3. **Drains on failure by default** (failure = terminal state, not abort — no fail-fast); computes success/failure/**skip** counts itself and feeds only success+failure into the reused threshold `CompletionConfig`; captures the first `SuspendExecution`/`TimedSuspendExecution`, drains in-flight, and re-raises to suspend the whole invocation; in-flight-at-early-completion tasks reported as `STARTED`, not-yet-started tasks absent.

### T6 — `DagResult` + serialization

- **Spec:** §2.6, §2.7, §8.1
- **Files:** `operation/dag_result.py` (new — `DagResultImpl`, `to_dict`/`from_dict`, `create_dag_result_serdes`, `dag_reason_from_core`); `dag.py` (public `DagResult` surface).
- **Deps:** T1, T5.
- **Acceptance:**
  1. Accessors mirror `BatchResult`: `get_result`/`get_status` (handle `@overload` → `T`, name → `Any`), `succeeded()`/`failed()`/`skipped()`, `success_count`/`failure_count`/`skipped_count`/`total_count`, `completion_reason`, and `throw_if_error()` keyed on `failure_count` (raises `DagExecutionError`).
  2. `to_dict`/`from_dict` round-trip with a `result_kind` discriminator (`"plain"|"batch"|"dag"`, derived from `TaskDef.kind`) restoring `BatchResult`/nested `DagResult` methods recursively; errors round-trip via existing `ErrorObject`.
  3. `completion_reason` semantics: default drain ⇒ `ALL_COMPLETED` (all succeeded/skipped) else `COMPLETED_WITH_FAILURES`; threshold paths bridged from `CompletionReason` via `dag_reason_from_core`.

### T7 — Wire `context.dag()` + `dag_handler` + first-use `FutureWarning`

- **Spec:** ⚠️ header, §2.1, §7.2, §7.3
- **Files:** `context.py` (public `dag()`); `operation/dag.py` (new — `dag_handler`); `lambda_service.py` (subtype/serdes wiring); package export site (`__init__.py` / `context.py` re-exports).
- **Deps:** T2, T3, T4, T5, T6.
- **Acceptance:**
  1. `dag(register, name=None, config=None)` runs `register`→`validate_dag`→`DagExecutor.run()` **inside** a `run_in_child_context`/`child_handler` body (container `sub_type=OperationSubType.DAG`, serdes = `create_dag_result_serdes()`), and **returns `DagResult` synchronously** (no `DurablePromise`); nested `dag` tasks wire the explicit-ID child runner so the container id is `…-DAG_NODE_T_{name}`.
  2. `max_concurrency <= 0` raises `ValidationError` at handler top; a `Dag*Error` thrown in the body is unwrapped from `ChildContextError.__cause__` at the `dag()` boundary and re-raised (matching the `wait_for_callback` precedent — no change to `child.py`).
  3. First call to `context.dag()` emits a one-time `FutureWarning`; `DagContext`, `TaskHandle`, `DagResult`, `DagConfig`, `TriggerRule`, `TaskStatus`, and the `Dag*Error` types are publicly exported.

### T8 — Unit tests (validator / executor / result / context / entity-ID)

- **Spec:** §12
- **Files:** `tests/operation/dag_validator_test.py`, `tests/operation/dag_executor_test.py`, `tests/operation/dag_result_test.py`, `tests/operation/dag_context_test.py` (new); entity-ID cases in `tests/context_test.py`.
- **Deps:** T1–T7.
- **Acceptance:**
  1. Validator: self-loop / 2-cycle / deep-cycle / diamond-no-cycle; name violations (empty, >100, dash, `DAG_NODE_T_`, unresolvable); duplicates across op kinds; missing / foreign-scope deps. Trigger truth table × {all-succ, all-fail, mixed, includes-skip, empty}. `TaskHandle` chaining + `deps[handle]` vs `deps["name"]`.
  2. Executor: readiness/topological order, `max_concurrency` throttling, skip propagation, `run_if` skip, threshold `completion_config` (`min_successful`, tolerated counts), default-drain vs opt-in fail-fast. `DagResult`: accessors for succeeded/failed/skipped/not-run, `throw_if_error`, `to_dict`/`from_dict` round-trip incl. `result_kind` recursion + `ErrorObject`.
  3. Entity-ID: `_create_task_id` prefixed/unprefixed; nested `Hval = blake2b(f"{Hcontainer}-DAG_NODE_T_validation")` then `blake2b(f"{Hval}-DAG_NODE_T_rule_a")` (assert **no** `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` pre-image); no collision with counter ids (`{Hc}-{int}` vs `{Hc}-DAG_NODE_T_{name}`).

### T9 — Runner integration + replay / large-payload tests

- **Spec:** §12, §8.2, §5.7, §5.8
- **Files:** `tests/e2e/dag_int_test.py` (new — deployed/local runner); `tests/operation/dag_test.py` (new — replay/interruption).
- **Deps:** T7.
- **Acceptance:**
  1. Diamond `A→{B,C}→D` runs B,C concurrently (assert via invocation/side-effect counts); mixed op-type tasks each appear as their **native** subtype under a `DAG_NODE_T_`-derived id; compensation pattern (charge fails ⇒ `ALL_FAILED` refund runs, `ALL_SUCCESS` fulfill skips, `ALL_DONE` audit runs); `run_if` branching; nested-DAG scope isolation.
  2. Interrupt after a subset checkpoints, resume: completed tasks hit fast paths (count side effects), remaining run exactly once, `run_if`-skips stay skipped with no checkpoint.
  3. **Large-payload** forces `ReplayChildren` and asserts the DAG **re-executes** to an equal `DagResult` (the Python re-execute model, §8.2) and that a custom `summary_generator` string neither changes the replayed result nor hangs replay (it is never read back).

### T10 — Docs & experimental annotations

- **Spec:** ⚠️ header, §2, §11
- **Files:** `docs/` DAG usage page (new); docstring audit across all public `dag.py` symbols.
- **Deps:** T7.
- **Acceptance:**
  1. Every public symbol (`dag()`, `DagContext` methods, `TaskHandle`, `DagResult`, `DagConfig`, enums) carries the `.. warning:: **Experimental.**` admonition; the first-use `FutureWarning` behavior is documented.
  2. Docs cover the two dependency-declaration styles (inline `deps=` vs `.after()`), handle-keyed vs string-keyed `DepsMap` access, trigger rules / `run_if`, threshold completion, and the re-execute large-payload behavior.
  3. Docs explicitly note the v2-deferred items (below).

---

## Deferred (NOT v1 tasks)

- **Custom result-based completion** (`shouldComplete` predicate + `DagCompletionStatus` + `CompletionDecision`) — **v2-deferred** (spec §2.8, §11.1). No Python counterpart exists (`CompletionConfig` is threshold-only); should land as a cross-SDK feature spanning map/parallel + dag, not DAG-only. v1 reuses threshold `CompletionConfig` verbatim.
- **Faithful STARTED-set replay under large-payload early completion** — deferred (spec §8.2, §11.2); v1 matches existing `map`/`parallel` re-execute behavior.

---

**Task count: 10 ordered subtasks (T1–T10); 0 blocking base-SDK prerequisites; 2 v2-deferred items.**
