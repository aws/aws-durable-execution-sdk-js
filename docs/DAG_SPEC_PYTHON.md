# DAG Support (`context.dag()`) — Python Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable.
>
> **Required API annotation (Python).** Since Python has no build-time release-tag tooling, mark experimental status two ways: (1) a prominent Sphinx/docstring admonition on every public symbol, and (2) a runtime `FutureWarning` on first use of `context.dag()`.
>
> ```python
> def dag(self, name, register, config=None):
>     """Declare and run a DAG of tasks. ...
>
>     .. warning::
>        **Experimental.** This API is experimental and may be changed or
>        removed in future releases.
>     """
> ```

Status: Draft (implementation-ready) · **Stability: Experimental** · Target: `aws-durable-execution-sdk-python` · Scope: core package `packages/aws-durable-execution-sdk-python`

**Canonical design source:** [`DAG_SPEC.md`](./DAG_SPEC.md) (JS/TS). This document adapts that design to the Python SDK. Where the JS design relies on machinery Python lacks (compile-time types) or where the Python SDK already behaves differently (large-payload replay, completion vocabulary), this spec **follows the Python SDK's actual code** and calls out the divergence with a **[PY NOTE]** callout, grounded in the source files cited inline.

Source files read to ground this spec (all under `packages/aws-durable-execution-sdk-python/src/aws_durable_execution_sdk_python/`): `context.py`, `identifier.py`, `config.py`, `retries.py`, `threading.py`, `concurrency/models.py`, `concurrency/executor.py`, `operation/child.py`, `operation/step.py`, `__init__.py`.

---

## 1. Overview

`context.dag()` adds a declarative directed-acyclic-graph primitive to the Python SDK, matching the JS design's intent: declare a graph of typed tasks once in a _registration phase_; the runtime schedules tasks topologically, runs independent chains concurrently (on the SDK's existing worker-thread model), evaluates per-task trigger rules and `run_if` predicates, and aggregates results into a `DagResult`.

As in JS, a DAG is implemented as a **child context** (one `run_in_child_context` node in the parent's operation tree, via `child_handler` in `operation/child.py`) whose body runs a **name-based scheduler**. Each task delegates to the **same operation executor** the equivalent `DurableContext` method uses (`StepOperationExecutor`, `InvokeOperationExecutor`, `child_handler`, etc.), the only difference being that the task's entity ID is derived from its **name** instead of the per-context counter.

### 1.1 Why name-based IDs are required (same root cause as JS)

`DurableContext._create_step_id()` (`context.py`) assigns each operation an ID from a per-context monotonic counter:

```python
def _create_step_id_for_logical_step(self, step: int) -> str:
    prefix = self._step_id_prefix
    step_id = f"{prefix}-{step}" if prefix else str(step)
    return hashlib.blake2b(step_id.encode()).hexdigest()[:64]

def _create_step_id(self) -> str:
    new_counter = self._step_counter.increment()   # OrderedCounter, thread-safe
    return self._create_step_id_for_logical_step(new_counter)
```

`map`/`parallel` are replay-safe **not** because of the counter but because the concurrent executor (`concurrency/executor.py::_execute_item_in_child_context`) derives each item's operation ID directly from its **stable `Executable.index`** via `executor_context._create_step_id_for_logical_step(executable.index)` — explicitly bypassing `_step_counter` so that (per its own docstring) "the same input always produces the same id regardless of the order branches actually run in." In an arbitrary DAG a downstream task starts when its upstream deps _complete_, and completion order can vary across replays — a **counter-based** ID (which advances at operation _start_) would diverge and the operation would not match its checkpoint. DAG solves this the same way `map`/`parallel` already do: derive the ID from a stable key that is independent of run-time ordering — here the task **name** (§4) in place of a numeric index.

**[PY NOTE — IDs are hashed at *every* level, so any deterministic string works, and injectivity is grounded differently than JS.]** `_create_step_id_for_logical_step` feeds the composed string through `blake2b(...).hexdigest()[:64]` before it is ever used as a checkpoint key. The raw string is never parsed by the runtime. This is the Python analog of the JS `hashId` property, but with a structural difference that matters for the injectivity argument: **JS composes a single raw multi-level string** (e.g. `1-2-DAG_NODE_T_v-DAG_NODE_T_r`) **and hashes it once at lookup**, so JS _needs_ the reserved-delimiter/no-dash rules to guarantee that one string decomposes uniquely. **Python re-hashes at each child-context boundary** — `create_child_context(operation_id=…)` sets the child's `_step_id_prefix` to the parent operation's _already-hashed_ `operation_id` (verified in `context.py`), so a nested task's pre-image is `f"{containerHash}-DAG_NODE_T_{name}"`, never a raw multi-level string. Cross-level injectivity therefore rests on **blake2b collision-resistance per level**, and the name charset rules are **defense-in-depth / debug hygiene**, not the primary guarantee. Either way, `f"{prefix}-DAG_NODE_T_{name}"` composes and hashes transparently — see §4.

### 1.2 Non-goals (v1)

Same as JS §1.3: no dedicated branch operator (covered by `run_if`), no dynamic task creation, no cross-task semaphores, no pre-built operators.

---

## 2. Public API (idiomatic Python)

New public types live in a new module `aws_durable_execution_sdk_python/dag.py` (types + `DagContext`, `TaskHandle`, `DagResult`, `DagConfig`) with the scheduler/validator/handler under `operation/dag*.py`; re-exported from `__init__.py`.

### 2.1 Entry point (added to `DurableContext`)

```python
def dag(
    self,
    register: Callable[[DagContext], None],
    name: str | None = None,
    config: DagConfig | None = None,
) -> DagResult:
    ...
```

**[PY NOTE — no `DurablePromise`; blocking return.]** Every Python `DurableContext` operation returns its result **directly** (blocking), suspending the whole invocation via a raised `SuspendExecution` when it must wait (`context.py`: `step`, `invoke`, `run_in_child_context`, etc. all `return executor.process()`). Python has no `DurablePromise`/`await`. So `dag()` **returns a `DagResult` synchronously**, consistent with `run_in_child_context`. This is the first structural divergence from JS (which returns `DurablePromise<DagResult>`).

`register` is a **registration-only, synchronous** callback (Python has no cheap `async` story in this SDK; the whole SDK is thread/blocking-based — see §6). Tasks are _declared_ but do not execute until it returns.

### 2.2 `DagContext`

A separate class (does **not** subclass `DurableContext`) exposing only declarative task-registration methods. Each method registers exactly one task and returns a `TaskHandle`. Argument order follows the Python SDK convention seen throughout `context.py`: the **operation-specific callable/payload first, then `deps`, `name`, `config`** as keyword-friendly parameters.

```python
class DagContext:
    def step(
        self,
        func: Callable[..., T],
        deps: DepsArg = None,
        name: str | None = None,
        config: StepConfig | None = None,
        *,
        trigger_rule: TriggerRule = TriggerRule.ALL_SUCCESS,
        run_if: Callable[[DepsMap], bool] | None = None,
    ) -> TaskHandle[T]: ...

    def invoke(
        self,
        function_name: str,
        payload_fn: Callable[[DepsMap], P] | P,
        deps: DepsArg = None,
        name: str | None = None,
        config: InvokeConfig[P, R] | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[R]: ...

    def wait_for_callback(
        self,
        submitter: Callable[..., None],
        deps: DepsArg = None,
        name: str | None = None,
        config: WaitForCallbackConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...

    def wait(
        self,
        duration: Duration,
        deps: DepsArg = None,
        name: str | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[None]: ...

    def wait_for_condition(
        self,
        check: Callable[..., T],
        config: WaitForConditionConfig[T],
        deps: DepsArg = None,
        name: str | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[T]: ...

    def run_in_child_context(
        self,
        func: Callable[..., T],
        deps: DepsArg = None,
        name: str | None = None,
        config: ChildConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[T]: ...

    def map(
        self,
        inputs: Sequence[U] | Callable[[DepsMap], Sequence[U]],
        func: Callable[[DurableContext, U, int, Sequence[U]], T],
        deps: DepsArg = None,
        name: str | None = None,
        config: MapConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[BatchResult[T]]: ...

    def parallel(
        self,
        functions: Sequence[Callable[[DurableContext], T] | ParallelBranch[T]],
        deps: DepsArg = None,
        name: str | None = None,
        config: ParallelConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[BatchResult[T]]: ...

    def dag(
        self,
        register: Callable[[DagContext], None],
        deps: DepsArg = None,
        name: str | None = None,
        config: DagConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[DagResult]: ...
```

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `ChildConfig`, `MapConfig`, `ParallelConfig`, `ParallelBranch`, `Duration`, `BatchResult` are the **existing** Python SDK types (`config.py`, `concurrency/models.py`), reused verbatim so per-task retry/serdes/completion behavior is identical to the standalone operations.

**[PY NOTE — `invoke` takes a *deferred* `payload_fn`, diverging from the real eager `payload`.]** The real `DurableContext.invoke` takes an **eager `payload` value** (`context.py`; cf. `context.invoke(function_name=…, payload={…}, name=…)`), because a standalone invoke has all its inputs available at call time. A DAG `invoke` task, however, frequently needs to build its payload from **upstream results that only exist at run time**, so `DagContext.invoke` accepts `payload_fn: Callable[[DepsMap], P] | P` — a deps-taking callable _or_ a plain eager value. This is a deliberate divergence from the standalone signature (analogous to how `step`/`wait_for_condition` bodies already receive `deps`): a plain value is used as-is; a callable is invoked with the resolved `DepsMap` at scheduling time to produce the payload, then handed to the underlying `InvokeOperationExecutor` as an eager value. Because the payload is materialized _before_ the executor runs (deterministically, from checkpointed deps), this does not affect replay. The other task kinds (`step`, `wait_for_callback`, `wait_for_condition`, `run_in_child_context`) already take callables in the real SDK, so only `invoke` carries this divergence.

**Name defaulting.** `context.py::_resolve_step_name` is exactly `return name or getattr(func, "_original_name", None)` — it uses the explicit `name` when truthy, else the `_original_name` attribute set by the `@durable_step` / `@durable_with_child_context` / `@durable_wait_for_callback` decorators, else `None`. It does **not** fall back to `func.__name__`, so a bare `lambda` (no `_original_name`) resolves to `None`. **Because** a DAG task name is load-bearing for its entity ID (§4), if `_resolve_step_name` yields `None` the DAG method raises `DagInvalidTaskNameError` at registration (unlike standalone ops, which tolerate a `None` name because they are counter-keyed). Practically: DAG tasks built from bare lambdas MUST pass an explicit `name`.

### 2.3 Passing deps and the deps-map — the hard adaptation (JS `DepsMap`)

**[PY NOTE — Python has no type-level `DepsMap`.]** The JS design's headline typing feature is `DepsMap<TDeps>` — a mapped type that captures each dependency's **literal-string name** and result type at compile time, so `deps.fetch` is statically typed. This depends on TypeScript's literal-string generics and mapped types, which **have no Python equivalent** (PEP 646/`TypedDict` cannot key a dict by a value captured from a runtime argument). This is the single largest adaptation.

**Chosen Python model — name-keyed dict, resolved at runtime:**

- `deps` is passed as a **list of `TaskHandle`s** (inline, typed-ish) — `DepsArg = Sequence["TaskHandle"] | None`.
- Inside a task body the resolved upstream results arrive as a **`DepsMap`**, a thin `Mapping[str, Any]` keyed by dependency **task name** (a plain `dict` subclass, or `types.MappingProxyType` for immutability). `deps["fetch"]` returns the fetch task's result.
- **Result typing is best-effort only.** `TaskHandle[T]` is `Generic[T]`, so a handle carries its result type, but because the map is keyed by a _runtime_ string the values surface as `Any`. Recommended ergonomic escape hatch: let the body pull typed values off the _handle_ rather than the string key — `deps[fetch]` (indexing by the `TaskHandle` object) returns `T`.

**[PY NOTE — handle-keyed access needs a real runtime branch in `__getitem__`, not hash-to-name.]** `TaskHandle` is `@dataclass(eq=False)`, so it keeps object-**identity** `__eq__`. Even though we give it `__hash__ = hash(self._name)`, a `dict` keyed by _string_ names cannot be looked up by a handle: `dict` requires **both** matching hash **and** `key == storedKey`, and `handle == "fetch"` is `False` under identity equality. So handle-keying **cannot** work "for free" via hashing-to-name. `DepsMap.__getitem__` must therefore branch **at runtime**:

```python
class DepsMap(Mapping[str, Any]):
    def __init__(self, by_name: dict[str, Any]) -> None:
        self._by_name = by_name

    @overload
    def __getitem__(self, key: "TaskHandle[T]") -> T: ...
    @overload
    def __getitem__(self, key: str) -> Any: ...
    def __getitem__(self, key: "str | TaskHandle") -> Any:
        name = key._name if isinstance(key, TaskHandle) else key   # runtime dispatch
        return self._by_name[name]
```

The `@overload`s recover the static type for `deps[handle] -> T` at type-check time; the `isinstance` branch is what actually makes it work at run time. `deps["fetch_source"]` remains available but is typed `Any`.

```python
# handle-keyed access recovers the static type (recommended):
fetch = d.step(fetch_source)                      # TaskHandle[SourceData]
d.step(transform, deps=[fetch])                   # inside: data = deps[fetch]  -> SourceData
# string-keyed access is always available but typed Any:
#   data = deps["fetch_source"]
```

**Deps-first argument rule (adapted).** JS prepends `deps` as the first fn parameter only when deps are non-empty. Python callables are more flexible; the idiomatic rule is: **the task body always receives `deps` as its first positional argument, followed by the operation's native context/args**, and a task with no deps receives an empty `DepsMap`. This is _uniform_ (no conditional signature) — simpler than JS's empty-vs-nonempty split, at the cost of an always-present (possibly empty) `deps` param.

```python
# step body:              (deps, step_ctx)
d.step(lambda deps, ctx: transform(deps["fetch"]), deps=[fetch], name="xform")
# invoke payload_fn:      (deps) -> payload
d.invoke("pay:prod", lambda deps: {"amt": deps["validate"]}, deps=[validate], name="charge")
# wait_for_callback:      (deps, callback_id, ctx)
# wait_for_condition:     (deps, state, ctx)
# run_in_child_context:   (deps, child_ctx)
```

**Ordering-only deps** (JS builder `.after(...)`): provided via the `TaskHandle.after(*handles)` builder (§2.4). They gate scheduling and trigger-rule evaluation but do **not** appear in the `DepsMap`. `TaskDef` stores `inline_deps` (drive the map) and `all_deps = inline_deps ∪ after-edges` (drive readiness/trigger/cycle), mirroring JS §7.5.

### 2.4 `TaskHandle`

Registration-time reference + builder. Never serialized. Identity is its **name** (unique within the DagContext scope). It defines `__hash__ = hash(self._name)` so handles can be collected in `set`s/used as dict keys _among handles_ (e.g. the `all_deps` edge set), but note this hash does **not** make `deps[handle]` work against a name-keyed dict — `DepsMap.__getitem__` dispatches on `isinstance(key, TaskHandle)` and extracts `_name` explicitly (§2.3).

```python
@dataclass(eq=False)
class TaskHandle(Generic[T]):
    _name: str
    _dag: "DagContextImpl"           # back-ref for builder mutations
    def __hash__(self) -> int: return hash(self._name)

    def after(self, *deps: "TaskHandle") -> "TaskHandle[T]":
        """Ordering-only deps: wait for these but do not receive their results."""
        ...
        return self

    def trigger_rule(self, rule: "TriggerRule") -> "TaskHandle[T]":
        ...
        return self
```

Builder methods mutate the underlying `TaskDef` and return `self` for chaining (`d.step(...).after(a).trigger_rule(TriggerRule.ALL_DONE)`).

### 2.5 `TriggerRule` / `run_if`

```python
class TriggerRule(Enum):
    ALL_SUCCESS = "ALL_SUCCESS"   # default
    ALL_FAILED  = "ALL_FAILED"
    ALL_DONE    = "ALL_DONE"
    ANY_SUCCESS = "ANY_SUCCESS"
    ANY_FAILED  = "ANY_FAILED"
    NONE_FAILED = "NONE_FAILED"
```

`run_if: Callable[[DepsMap], bool] | None` — **synchronous, deterministic** predicate over resolved upstream results. Returns `False` ⇒ task `SKIPPED` with `skip_reason="RUN_IF_PREDICATE"`. A predicate that **throws / raises / panics** aborts the DAG with a typed `DagPredicateError` (`DagPredicateException` in Java) naming the task and carrying the original error as its cause — the task gets **no terminal state** and the throw is neither a task `FAILED` nor a `SKIPPED` (`DAG_SPEC.md` §5.4, `DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3). Ports directly from JS §2.6 (JS already mandates sync; Python is sync everywhere, so this is a natural fit). Evaluated after the trigger rule passes and before the operation runs. The full trigger-rule truth table (JS §5.3), including the empty-upstream row and the `ALL_FAILED` `len > 0` guard, ports verbatim.

### 2.6 `DagResult` / `TaskExecution`

```python
class TaskStatus(Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    STARTED = "STARTED"

class SkipReason(Enum):
    TRIGGER_RULE = "TRIGGER_RULE"
    RUN_IF_PREDICATE = "RUN_IF_PREDICATE"

@dataclass(frozen=True)
class TaskExecution(Generic[T]):
    name: str
    status: TaskStatus
    skip_reason: SkipReason | None = None
    result: T | None = None
    error: ErrorObject | None = None            # existing lambda_service.ErrorObject
    started_at: datetime | None = None
    completed_at: datetime | None = None

class DagResult:
    def get_result(self, task: "str | TaskHandle[T]") -> T | None: ...
    def get_status(self, task: "str | TaskHandle") -> TaskStatus | None: ...
    def succeeded(self) -> list[TaskExecution]: ...
    def failed(self) -> list[TaskExecution]: ...
    def skipped(self) -> list[TaskExecution]: ...
    @property
    def results(self) -> Mapping[str, TaskExecution]: ...
    @property
    def success_count(self) -> int: ...
    @property
    def failure_count(self) -> int: ...
    @property
    def skipped_count(self) -> int: ...
    @property
    def total_count(self) -> int: ...
    @property
    def completion_reason(self) -> "DagCompletionReason": ...
    def throw_if_error(self) -> None:
        """Raise DagExecutionError if any task FAILED."""
```

`get_result(handle)` returns `T` via `@overload`; `get_result(name)` returns `Any`. Mirrors `BatchResult` accessors in `concurrency/models.py` (`succeeded()`, `failed()`, `get_results()`, `throw_if_error()`).

### 2.7 Completion reason — core/superset layering (adapted to Python's smaller enum)

**[PY NOTE — Python's `CompletionReason` has only 3 members and no custom-completion members.]** Verified in `concurrency/models.py`:

```python
class CompletionReason(Enum):
    ALL_COMPLETED = "ALL_COMPLETED"
    MIN_SUCCESSFUL_REACHED = "MIN_SUCCESSFUL_REACHED"
    FAILURE_TOLERANCE_EXCEEDED = "FAILURE_TOLERANCE_EXCEEDED"
```

There is **no** `CUSTOM_COMPLETION_SUCCEEDED` / `CUSTOM_COMPLETION_FAILED` in Python (the JS base has 5 members; Python has 3), because **Python has no custom-completion predicate** (see §2.8). The JS "shared core base + DAG superset" refactor (JS §7.2, Appendix C) still applies structurally, but over the _Python_ 3-member base:

```python
# DAG superset adds the one DAG-specific member (same rationale as JS Appendix C / F13):
class DagCompletionReason(Enum):
    ALL_COMPLETED = "ALL_COMPLETED"
    MIN_SUCCESSFUL_REACHED = "MIN_SUCCESSFUL_REACHED"
    FAILURE_TOLERANCE_EXCEEDED = "FAILURE_TOLERANCE_EXCEEDED"
    COMPLETED_WITH_FAILURES = "COMPLETED_WITH_FAILURES"   # DAG-only
```

Python `Enum`s cannot be "extended" by subclassing with new members, so — unlike JS's `type` union — the DAG defines its **own** enum whose first 3 members are value-compatible with `CompletionReason` (same `.value` strings). A tiny `dag_reason_from_core(core: CompletionReason) -> DagCompletionReason` bridges the batch reasons the DAG reuses. Semantics identical to JS §2.8/§5.8: default drain ⇒ `ALL_COMPLETED` if all reachable tasks succeeded/skipped, else `COMPLETED_WITH_FAILURES`; `throw_if_error()` keys off `failure_count`, not the reason.

### 2.8 `DagConfig` and completion

```python
@dataclass(frozen=True)
class DagConfig:
    max_concurrency: int | None = None                    # None => unlimited
    completion_config: CompletionConfig | None = None     # REUSED from config.py (threshold-only)
    default_retry_strategy: Callable[[Exception, int], RetryDecision] | None = None
    default_trigger_rule: TriggerRule = TriggerRule.ALL_SUCCESS
    serdes: SerDes | None = None                          # for the DagResult container payload
    summary_generator: Callable[[DagResult], str] | None = None   # OBSERVABILITY-ONLY (§8.1)
    nesting_type: NestingType = NestingType.NESTED
```

**[PY NOTE — reuse `CompletionConfig` verbatim (threshold-only); custom-predicate completion is Infeasible-deferred.]** The JS DAG defines its own `DagCompletionConfig` union with a **custom `shouldComplete(status)` predicate** whose `DagCompletionStatus` carries per-task **results** and a `SKIPPED` status, enabling result-based short-circuit (JS §2.9, §13.4). **Python has no custom-completion predicate at all** — `config.py::CompletionConfig` is threshold-only (`min_successful`, `tolerated_failure_count`, `tolerated_failure_percentage`), and `concurrency/models.py::ExecutionCounters` implements only `should_continue`/`is_complete` over those thresholds. There is no `CompletionDecision` / `complete_batch` / `continue_batch` factory in the Python codebase.

Consequences and decision:

- **v1 reuses the existing threshold `CompletionConfig` verbatim** for `DagConfig.completion_config`. This ports directly (JS reuses the threshold half unchanged too) and covers `min_successful` / failure-tolerance early completion.
- **The result-based custom-completion path (JS §13.4) is deferred**, because introducing `DagCompletionStatus` + a `shouldComplete` predicate + `CompletionDecision` factories would be net-new public API with **no existing Python counterpart** — it should land as a cross-cutting SDK feature (map/parallel + dag together), not DAG-only. Flagged as open question §11.1. Until then, result-based short-circuit is expressible by having a task inspect its deps and raise, or by `min_successful`.
- **Skip accounting:** because the reused `CompletionConfig` is result-blind and skip-blind, the DAG scheduler computes `success_count`/`failure_count`/`skipped_count` itself (SKIPPED counts toward neither success nor failure, matching JS §5.7) and feeds only success/failure counts into the threshold logic. No change to `CompletionConfig` is needed.

`max_concurrency <= 0` raises `ValidationError` at the top of the handler (mirroring the `parallel_bad_concurrency` conformance behavior). There is no mutually-exclusive-union runtime guard to port (no union exists in Python).

---

## 3. Two ways to declare dependencies

Same model as JS §3, Python spelling:

```python
c = d.step(process, deps=[a, b])                        # inline => typed-ish access deps[a], deps[b]
a = d.step(fetch_a)                                     # root => empty DepsMap
d.step(notify).after(a)                                 # ordering-only => not in DepsMap
e = d.step(process, deps=[a]).after(b)                  # mixed: deps[a] present, b ordering-only
```

`inline_deps` populate the `DepsMap`; `.after(...)` edges add scheduling/trigger/cycle edges only (§2.3).

---

## 4. Entity-ID strategy & replay correctness (adapts — per-level hashing)

### 4.1 Name-based task IDs

A task's entity ID is `blake2b(f"{prefix}-DAG_NODE_T_{name}")[:64]` where `prefix` is the DAG child context's `_step_id_prefix` — i.e. the DAG container's own `operation_id`, which is **itself an already-blake2b-hashed 64-hex digest** (`create_child_context` sets the child's `_step_id_prefix` to the parent operation's hashed `operation_id`, verified in `context.py`). If unprefixed, `blake2b(f"DAG_NODE_T_{name}")[:64]`.

**Crucially, Python re-hashes at every child-context boundary**, so — unlike JS — no raw multi-level string is ever composed. Writing `H(s) = blake2b(s).hexdigest()[:64]`, and letting `Hcontainer` be the DAG container's (already-hashed) operation id:

```
context.dag(...) container op id:        Hcontainer = H("{parentPrefix}-{counter}")   # a 64-hex digest
  task "fetch_data":                     H("{Hcontainer}-DAG_NODE_T_fetch_data")
  nested dag "validation" container:     Hval = H("{Hcontainer}-DAG_NODE_T_validation")   # re-hashed here
    sub-task "rule_a":                   H("{Hval}-DAG_NODE_T_rule_a")                     # prefix is Hval, NOT a raw path
```

Note there is **no** `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` pre-image anywhere: the nested DAG's container id is hashed to `Hval` _first_ (at the child-context boundary), and its sub-tasks are prefixed with `Hval`. This is the same per-level hashing `map`/`parallel` already rely on (each branch prefix is the map/parallel container's hashed id). Structurally the _shape_ mirrors JS §4.2 (a `DAG_NODE_T_` token per level), but the composition/injectivity mechanics differ (§4.2).

### 4.2 Injectivity — per-level charset injectivity + blake2b collision-resistance (grounded differently than JS)

The JS injectivity proof (JS §4.2 / Appendix D–E) is about a **single raw multi-level string** decomposing uniquely, because JS composes the whole path and hashes it once. **That proof does not apply to Python**, where each child-context level is hashed independently. Python injectivity instead rests on two facts:

1. **Within a level — charset injectivity.** At a fixed container prefix `Hc`, every task pre-image is `f"{Hc}-DAG_NODE_T_{name}"`. Distinct task names give distinct pre-images because `name` is appended verbatim and duplicate names are rejected at registration (§9.2). A task id can never collide with a counter-based sibling id (`f"{Hc}-{int}"`) because the segment after `{Hc}-` is either the literal `DAG_NODE_T_…` (starts with a letter) or a decimal integer — disjoint by construction.
2. **Across levels — blake2b collision-resistance.** A nested task's prefix `Hval = H("{Hc}-DAG_NODE_T_validation")` is a collision-resistant digest of its parent level. Distinct paths through the DAG tree therefore yield distinct prefixes with overwhelming probability, so no cross-level forgery is possible. There is no raw multi-level string for a name to "forge a delimiter" inside.

**Name charset rules are defense-in-depth / debug hygiene, NOT the primary guarantee** (the reverse of the JS framing). Because Python re-hashes per level, the no-dash / no-`DAG_NODE_T_`-substring rules are _not required_ to prevent the JS-style cross-level collision (blake2b already prevents it, and duplicate names are already rejected). They are retained anyway because they (a) keep IDs and logs cleanly greppable and unambiguous, (b) preserve one-to-one parity with the JS/Java/Go specs so cross-language conformance handlers share names, and (c) guard against a future refactor that composes multi-level pre-images. Concretely enforced (§9):

1. **No `-` in task names** — charset `^[a-zA-Z0-9_]+$`.
2. **No `DAG_NODE_T_` substring in names** — keeps the token reserved for readability.

Because IDs are blake2b-hashed to 64 hex chars before storage, token length has **zero** storage cost regardless of nesting depth (the digest is fixed-width; contrast JS's single-hash-at-lookup where the pre-image grows with depth but is also fixed-width after MD5).

### 4.3 `_create_task_id`

New internal helper on `DurableContext` (parallels `_create_step_id`):

```python
def _create_task_id(self, name: str) -> str:
    prefix = self._step_id_prefix    # the DAG container's OWN operation_id — already a blake2b digest
    raw = f"{prefix}-DAG_NODE_T_{name}" if prefix else f"DAG_NODE_T_{name}"
    return hashlib.blake2b(raw.encode()).hexdigest()[:64]
```

It does **not** touch `_step_counter`, so it never desynchronizes the counter-based replay machinery (§6.2). Because `prefix` is already a hashed 64-hex digest (set by `create_child_context`, §4.1), each nesting level is hashed independently and no raw multi-level pre-image is ever built.

### 4.4 Replay-correctness argument (grounded in Python operation executors)

Traversal order may differ run-to-run; correctness depends only on stable IDs + topological ordering. Concretely:

1. Each task ID is a pure function of its name + the DAG context prefix (§4.3) — identical every run.
2. When the scheduler runs task `X`, it invokes `X`'s underlying executor bound to `operation_id = idOf(X)`. If `X` already completed, the executor hits its **checkpoint fast path**: `StepOperationExecutor` / `ChildOperationExecutor.check_result_status()` call `state.get_checkpoint_result(operation_id)` and, on `is_succeeded()`, `deserialize` and return **without re-executing** (`operation/step.py`, `operation/child.py`); on `is_failed()` they re-raise the checkpointed error. These fast paths are keyed on the **explicit `operation_id`**, not on the counter.
3. Operation-consistency checks are likewise keyed on the explicit `operation_id` and inspect only the checkpoint's operation type/name — transparent to the `DAG_NODE_T_` format.
4. The scheduler rebuilds its in-memory `results` map each run by reading each completed task's checkpointed result via the fast path; the `DepsMap` is reconstructed identically, and topological order guarantees a task's deps are in `results` before it runs.

So the only new requirement over `map`/`parallel` is the name-based ID derivation; checkpoint/retry/serdes/replay are the existing machinery.

---

## 5. Scheduler semantics

A topological scheduler over the registered `TaskDef`s, structurally identical to JS §5. It maintains `results: dict[str, TaskExecution]`, an in-flight set, and a ready set.

- **Readiness (§5.1):** a task is ready when every dep (inline + `.after`) is terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`) in `results`. Roots ready immediately.
- **Trigger-rule evaluation (§5.3):** the JS truth table and the `triggerRuleEvaluators` (including the empty-upstream row and `ALL_FAILED`'s `len > 0` guard) port verbatim as a `dict[TriggerRule, Callable[[list[TaskStatus]], bool]]`.
- **`run_if` (§5.4):** after trigger passes, build `DepsMap` from `results`, evaluate sync predicate; `False` ⇒ SKIPPED/`RUN_IF_PREDICATE`.
- **Running a task (§5.5):** invoke `task_def.executor(dag_child_ctx, deps_map)`, which delegates to the operation's explicit-ID executor (§6). Return ⇒ `SUCCEEDED`; raise ⇒ `FAILED` (capture `ErrorObject.from_exception`). Then queue downstream.
- **Skip propagation (§5.6):** ports verbatim.
- **Failure semantics (§5.8):** a failed task is a **terminal state, not an abort** — the DAG drains the reachable graph by default so compensation/fallback trigger rules run. `dag()` does **not** raise on task failure; it returns a `DagResult` with `failure_count > 0` and `completion_reason == COMPLETED_WITH_FAILURES`; callers opt in via `throw_if_error()`.

**[PY NOTE — deliberate divergence from Python `map`/`parallel` default fail-fast.]** `concurrency/models.py::ExecutionCounters.should_continue()` returns `self.failure_count == 0` when no completion config is set — i.e. Python map/parallel default is **fail-fast**, identical to the JS batch handler. The DAG intentionally does **not** adopt this default (it would prevent compensation tasks from running); it uses its own scheduler that treats failure as a terminal state and drains. A customer wanting batch-style fail-fast opts in via `completion_config`. This is the exact JS §5.8 divergence, and because the DAG scheduler is a **separate component** from `ConcurrentExecutor`, it is a local design choice, not a change to shared code.

- **`completion_config` early completion (§5.7):** reuse the threshold logic. When `min_successful` reached ⇒ `MIN_SUCCESSFUL_REACHED`; failure tolerance exceeded ⇒ `FAILURE_TOLERANCE_EXCEEDED`. In-flight tasks are not cancelled; exactly as in `concurrency/executor.py`, a branch whose parent has already completed raises `OrphanedChildException` and is terminated without error, and `_create_result` tags any still-`RUNNING`/`PENDING`/`SUSPENDED` branch as `STARTED`. The DAG mirrors this: in-flight tasks appear as `STARTED`; not-yet-started tasks are **absent** from `results` (`get_status` ⇒ `None`).
- **Empty DAG (§5.9):** resolve immediately, `total_count=0`, `ALL_COMPLETED`.

### 5.1 SKIPPED tasks checkpoint nothing (§9.5)

A skip is a pure function of upstream terminal statuses + a deterministic `run_if`, recomputed identically each run, so it mints no entity ID and writes no checkpoint. Ports verbatim.

---

## 6. Scheduler concurrency & the replay-coupling problem

### 6.1 Concurrency model — threads, not asyncio

**[PY NOTE — the Python SDK is thread-based and cooperatively-suspending; there is no asyncio.]** `concurrency/executor.py` runs branches on a `concurrent.futures.ThreadPoolExecutor`, with a `TimerScheduler` background thread for timed resumes, `OrderedLock`/`OrderedCounter` (`threading.py`) for deterministic ordering, and cooperative suspension via a raised `SuspendExecution` that unwinds the whole invocation. A durable operation that must wait does not block a thread indefinitely — it raises `SuspendExecution`, the invocation ends, and Lambda re-invokes to replay.

The DAG scheduler therefore **reuses the same worker-thread _primitives_** (`ThreadPoolExecutor`, a `TimerScheduler`-style background thread for timed resumes, `OrderedCounter`/`OrderedLock`, and the `SuspendExecution`/`TimedSuspendExecution` protocol), but runs them from a **dedicated `DagExecutor`**, not the existing `ConcurrentExecutor`.

**Why a dedicated `DagExecutor` (primary path), not `ConcurrentExecutor` reuse.** `ConcurrentExecutor` (verified in `concurrency/executor.py`) is structurally hard-wired for the flat map/parallel shape and cannot host a DAG without invasive changes:

- **Fixed, up-front executables.** `__init__` takes a complete `executables: list[Executable]` and `execute()` submits _all_ of them at once (`futures = [submit_task(es) for es in self.executables_with_state]`). A DAG must submit tasks **wave by wave** as upstream deps become terminal — there is no hook to gate submission on readiness.
- **Index-keyed IDs.** `_execute_item_in_child_context` derives every child id from `executable.index` via `_create_step_id_for_logical_step(index)` and names it `get_iteration_name(index) = f"{name_prefix}{index}"`. A DAG needs **name-based** ids (`…-DAG_NODE_T_{name}`, §4), not positional indices.
- **One `sub_type` for all items.** The ctor takes a single `sub_type_iteration`; every branch is checkpointed under that one subtype. A DAG's tasks are **heterogeneous** (step, invoke, child, map, nested dag…), each needing its **native** subtype.
- **One global completion event/counters per `execute()`.** A single `_completion_event`, one `ExecutionCounters`, and one `completion_config` govern the whole batch. A DAG needs **DAG-global** completion accounting that also understands **SKIPPED** (result-blind `ExecutionCounters` cannot) and drains-on-failure by default (§5.8).
- **§7.2 constraint.** Bending `ConcurrentExecutor` to fit would mean editing `concurrency/executor.py`, which §7.2 explicitly keeps unchanged. Making it the "preferred" path directly contradicted §5.8's statement that the DAG scheduler is a _separate component_.

**Decision: the dedicated `DagExecutor` is the sole v1 implementation.** It:

1. maintains the ready/in-flight/terminal sets and topological gating (§5), submitting each ready wave to a `ThreadPoolExecutor(max_workers = max_concurrency or len(tasks))`;
2. runs each task by constructing its operation executor / `child_handler` with a **name-based `OperationIdentifier`** and its **native `sub_type`** (§6.3), so heterogeneous task kinds and per-task retry/serdes are inherited unchanged;
3. re-derives readiness as futures resolve (via `add_done_callback`), evaluates trigger rules + `run_if` for newly-ready tasks, and computes DAG-global success/failure/skip counts itself (feeding only success/failure into the reused threshold `CompletionConfig`, §2.8);
4. captures the first `SuspendExecution`/`TimedSuspendExecution` raised by any task, drains in-flight work, and re-raises it to suspend the whole invocation — mirroring `ConcurrentExecutor`'s own `should_execution_suspend`/`_on_task_complete` logic, but re-implemented locally so no shared code changes.

This deliberately **re-implements** (rather than reuses) the ~200 lines of `ConcurrentExecutor` orchestration. That duplication is the accepted cost of keeping `concurrency/executor.py` untouched (§7.2) and is small relative to bending the flat executor into a graph scheduler. The subtle `SuspendExecution`/timer-resume handling is the main thing being re-implemented; §12 calls out replay/suspend tests specifically to de-risk it. `TimerScheduler` itself is reused as-is (it is generic over `ExecutableWithState`) or trivially re-created; it is not the part that conflicts with the DAG shape.

Either way the scheduler runs **inside the DAG child context body** (a `child_handler` call), exactly like `map`/`parallel` bodies run inside their child context (`context.py::map`/`parallel` → `child_handler`).

### 6.2 The replay-coupling problem (Python analog of JS §7.3.1)

**[PY NOTE — `_replay_aware` is counter-coupled, exactly like JS `withDurableModeManagement`.]** Every public `DurableContext` operation wraps its body in `with self._replay_aware():` (`context.py`). `_replay_aware` calls `_peek_next_checkpoint()` → `_peek_next_operation_id()` → `_create_step_id_for_logical_step(self._step_counter.get_current() + 1)` — i.e. it **peeks the next counter-based ID**. A DAG task checkpoints under `…-DAG_NODE_T_{name}`, never under the counter, so wrapping an explicit-ID task call in `_replay_aware` would peek a counter ID with no checkpoint and mis-drive the context's replay status.

**Resolution (mirrors JS §7.3.1):** the DAG's explicit-ID task calls **bypass `_replay_aware`** and invoke the operation executors directly with `operation_id = self._create_task_id(name)`. Task-level replay correctness comes entirely from counter-independent machinery already in the executors:

- the checkpoint fast paths keyed on the explicit `operation_id` (`StepOperationExecutor`, `ChildOperationExecutor.check_result_status`, `InvokeOperationExecutor`, the `Callback` future's `state.get_checkpoint_result`);
- operation-consistency validation keyed on the explicit `operation_id`.

**[PY NOTE — this bypass is not novel; `map`/`parallel` already do exactly it.]** `concurrency/executor.py::_execute_item_in_child_context` derives each branch's `operation_id` via `executor_context._create_step_id_for_logical_step(executable.index)` and calls `child_handler` **directly** with a hand-built `OperationIdentifier`; its own comment states it is doing so "bypassing `context.run_in_child_context` and therefore the parent's `_replay_aware`." Its sibling `replay()` re-derives the same index-based IDs and reads each child's checkpoint to rebuild the `BatchResult` without touching the counter. So the DAG's "bypass `_replay_aware`, construct an explicit-ID `OperationIdentifier`, call the executor / `child_handler` directly" pattern is the **established Python mechanism** for order-independent child IDs — the DAG only swaps the numeric index key for a name key. This is stronger grounding than the JS §7.3.1 analogy: the exact code path already exists and ships.

Neither touches `_step_counter` or `_peek_next_operation_id`. The **context-level** replay decision (run the scheduler vs. return the checkpointed `DagResult`) is made once at the **DAG container boundary** by the parent's `run_in_child_context`/`child_handler` (a real counter slot in the parent, so its counter-based replay handling is correct). Within the DAG body the counter is never advanced (only `register` + explicit-ID task calls run), so leaving it untouched cannot desynchronize anything. Nested `map`/`parallel`/`dag` tasks each create their **own** child context whose replay status is computed independently (`create_child_context` inherits+refines), so they are unaffected.

### 6.3 Explicit-ID executor invocation (grounded)

Unlike JS (where handlers take an injectable `createStepId` callback), the Python executors take a fully-formed `OperationIdentifier` at construction (`identifier.py`, and every executor ctor in `operation/*.py` and `context.py`). This is **cleaner** for the DAG: the explicit-ID variant simply constructs the executor with an `OperationIdentifier(operation_id=self._create_task_id(name), sub_type=…, parent_id=self._parent_id, name=name)` and calls `.process()` — no callback injection, no `_replay_aware` wrapper. For example, the step task executor:

```python
def _run_step_task(self, name, func, config, deps_map):
    executor = StepOperationExecutor(
        func=lambda step_ctx: func(deps_map, step_ctx),
        config=config or StepConfig(),
        state=self.state,
        operation_identifier=OperationIdentifier(
            operation_id=self._create_task_id(name),      # name-based, no counter
            sub_type=OperationSubType.STEP,
            parent_id=self._parent_id,
            name=name,
        ),
        context_logger=self.logger,
    )
    return executor.process()      # NOT wrapped in _replay_aware
```

- **invoke / wait / wait_for_condition:** same pattern — construct the executor with the name-based `OperationIdentifier`, call `.process()`.
- **run_in_child_context / map / parallel / nested dag / wait_for_callback:** run through `child_handler` with the name-based `OperationIdentifier` as the container id; the per-item/branch children created _inside_ a `map`/`parallel` task get **index-derived** IDs via `_create_step_id_for_logical_step(index)` — whose pre-hash pre-image is `f"{containerHash}-{index}"`, where `containerHash` is the map/parallel task's own (already-hashed) `operation_id` used as the branch child context's `_step_id_prefix` (verified in `concurrency/executor.py::_execute_item_in_child_context`). It is **not** `…-DAG_NODE_T_{name}-{index}`; the `DAG_NODE_T_{name}` token is already folded into `containerHash` at the child-context boundary. These branch IDs are **not** counter increments — that index derivation is precisely what makes them replay-safe, and it is unchanged from standalone `map`/`parallel` (see §6.2 PY NOTE). `wait_for_callback` is child-context-based in Python too (`context.py::wait_for_callback` → `run_in_child_context`), so it needs no special `createStepId` handling — this is _simpler_ than JS's Family A/B split (JS §7.3), because Python callbacks are already child-context-wrapped uniformly.

**[PY NOTE — the JS Family A/B handler split does not exist in Python.]** JS spends most of §7.3 reconciling handlers that take `createStepId` vs. `waitForCallback` which takes `peekStepId`+`runInChildContext`. Python has no such split: **all** operations construct an `OperationIdentifier` directly and callbacks are already child-context-based. The Python adaptation is therefore materially simpler — every task kind reduces to "construct executor/child_handler with a name-based `OperationIdentifier`, skip `_replay_aware`."

---

## 7. Handler & registration

### 7.1 File structure

```
src/aws_durable_execution_sdk_python/
  dag.py                      # public: DagContext (protocol), TaskHandle, DagResult, DagConfig, TriggerRule, enums
  operation/dag.py            # dag_handler: wraps register+validate+schedule in child_handler
  operation/dag_context.py    # DagContextImpl: registers TaskDefs, returns TaskHandles
  operation/dag_executor.py   # topological scheduler (+ reconstruction helper, §8)
  operation/dag_validator.py  # name / duplicate / missing-dep / cycle validation
  operation/dag_result.py     # DagResultImpl + serdes (to_dict/from_dict, resultKind tagging)
  exceptions.py               # (extend) Dag*Error classes
```

### 7.2 Changes to existing files

- `context.py` — add `dag(...)` method + `_create_task_id` + the internal explicit-ID task runners (`_run_step_task`, etc., all private).
- `lambda_service.py` (`OperationSubType`) — add `DAG = "Dag"` for the container subtype; task subtypes stay native.
- `exceptions.py` — add `DagExecutionError(DurableOperationError)`, `DagCyclicDependencyError`, `DagInvalidTaskNameError`, `DagDuplicateTaskError`, `DagInvalidDependencyError` (all subclasses of `DurableExecutionsError`/`ValidationError` as appropriate); register `DagExecutionError` in the `ErrorObject` reconstruction registry so nested-DAG failures rebuild across `child_handler` boundaries.
- `__init__.py` — re-export `DurableContext.dag` is automatic; export `DagContext`, `TaskHandle`, `DagResult`, `DagConfig`, `TriggerRule`, `TaskStatus`, `DagExecutionError`, etc.

No changes to `operation/step.py`, `invoke.py`, `wait.py`, `wait_for_condition.py`, `child.py`, `concurrency/executor.py`, `concurrency/models.py`.

### 7.3 `dag_handler` flow

```python
def dag_handler(run_in_child_context, make_ctx, state, name, register, config):
    config = config or DagConfig()
    if config.max_concurrency is not None and config.max_concurrency <= 0:
        raise ValidationError(f"Invalid max_concurrency: {config.max_concurrency}")

    def body(dag_child_ctx: DurableContext) -> DagResult:
        dag_ctx = DagContextImpl(dag_child_ctx, config)
        register(dag_ctx)                          # registration phase (sync)
        tasks = dag_ctx.get_tasks()
        validate_dag(tasks)                        # §9 — raises Dag*Error inside this body
        executor = DagExecutor(dag_child_ctx, tasks, config)
        return executor.run()                      # returns DagResult (may raise SuspendExecution)

    return run_in_child_context(
        body,
        name=name,
        config=ChildConfig(
            sub_type=OperationSubType.DAG,
            serdes=config.serdes or create_dag_result_serdes(),
            summary_generator=lambda result: build_dag_summary_envelope(
                result, config.summary_generator or default_dag_summary_generator),
        ),
    )
```

`context.dag()` wires `dag_handler` with `self.run_in_child_context` (top-level container is a real counter slot). A **nested** `dag` task wires it with the explicit-ID child runner so the nested container gets `…-DAG_NODE_T_{name}` (§6.3).

**[PY NOTE — no `errorMapper` in Python `run_in_child_context`.]** JS wires `errorMapper: (e) => e` so raw `Dag*Error`s escape unwrapped (JS §7.4/§5.10). Python's `child_handler` has **no `errorMapper` parameter**: `ChildOperationExecutor.execute` always does `error_object.raise_as_operation_error(ChildContextError)` on failure (`operation/child.py`), so a `Dag*Error` thrown inside the body would surface **wrapped in `ChildContextError`** (with the original on `__cause__` / `error_type`). Two options:

- **(a) Accept the wrap (v1 recommended, matches SDK idiom):** validation errors surface as `ChildContextError` whose `__cause__` is the `Dag*Error` — identical to how `wait_for_callback` already unwraps `ChildContextError.__cause__` at its call site (`context.py::wait_for_callback` catches `ChildContextError` and re-raises the typed inner). `dag()` catches `ChildContextError` and re-raises `e.__cause__` when it is a `Dag*Error`, giving the same clean throw as JS.
- **(b) Add an `error_mapper` param to `ChildConfig`/`child_handler`** to match JS exactly (larger change to shared code).

v1 uses **(a)** — a `try/except ChildContextError` in `dag()`/nested-dag executor that re-raises a `Dag*Error` cause unwrapped. This is grounded in the existing `wait_for_callback` precedent and requires no change to `child.py`. Deterministic `register` throws follow the same path (JS §5.10 "Register-callback throws" ports, modulo the wrap-then-unwrap).

### 7.4 `DagContextImpl` registration & `TaskDef`

Each method: resolve+validate name (§9.1) → assert-not-duplicate (§9.2) → build `TaskDef` → store → return `TaskHandle`. `TaskDef` mirrors JS §7.5:

```python
@dataclass
class TaskDef:
    name: str
    kind: str                                  # "step"|"invoke"|...|"dag"
    inline_deps: list[TaskHandle]              # drives DepsMap
    all_deps: list[TaskHandle]                 # inline ∪ .after edges; drives readiness/trigger/cycle
    trigger_rule: TriggerRule
    run_if: Callable[[DepsMap], bool] | None
    config: Any
    executor: Callable[[DurableContext, DepsMap], Any]   # binds the explicit-ID runner
```

`.after(...)` appends to `all_deps` only; `deps=[...]` populates both. The scheduler builds `deps_map` from `inline_deps` (looking each name up in `results`).

---

## 8. Serialization & large-payload replay

### 8.1 `DagResult` serialization

Mirror `BatchResult.to_dict`/`from_dict` (`concurrency/models.py`). Each task's serialized entry carries a `result_kind` discriminator (`"plain"|"batch"|"dag"`) so heterogeneous, method-bearing results (a `map`/`parallel` task's `BatchResult`, a nested `dag` task's `DagResult`) round-trip with their methods restored recursively — the Python analog of JS §8 F5. `result_kind` is derived from the task's static `kind` on its `TaskDef` (deterministic, no `isinstance` probing). Errors serialize via the existing `ErrorObject.to_dict()`/`from_dict()`.

### 8.2 Large-payload replay — **the biggest behavioral divergence from JS**

**[PY NOTE — Python's ReplayChildren already RE-EXECUTES; it does not reconstruct from a summary. The JS "design-B reconstruct, don't re-schedule" does not match Python's platform behavior.]** Verified in `operation/child.py`:

- When a child result exceeds `CHECKPOINT_SIZE_LIMIT_BYTES`, `ChildOperationExecutor.execute` sets `replay_children=True` and checkpoints `self.config.summary_generator(raw_result)` **only if a generator is set, else the empty string `""`** — never a structured envelope that is read back.
- On replay, `check_result_status` sees `is_succeeded() and is_replay_children()` and returns `create_is_ready_to_execute` → the child body is **re-executed**; inner operations hit their own per-operation checkpoint fast paths; the final result is rebuilt by _re-running the deterministic body_, then returned **without** re-checkpointing.

So in Python the `summary_generator` output is **already genuinely observability-only** — it is checkpointed but **never parsed on replay** (contrast JS map/parallel, where the summary string is load-bearing and parsed for `totalCount`, the root of issue #751). **Issue #751 does not reproduce in the Python SDK's model** because Python re-runs rather than parses.

**Decision for the Python DAG:** adopt the platform-consistent **re-execute** behavior rather than JS's reconstruct-from-envelope:

- On the large-payload `ReplayChildren` path, the DAG body **re-runs**: `register` rebuilds the graph, the scheduler re-runs, and every completed task hits its name-based checkpoint fast path (§4.4). This is _exactly_ the interrupted-mid-DAG resume path (§5), so no separate reconstruction code is needed — a significant simplification over JS.
- `DagConfig.summary_generator: (DagResult) -> str` remains **observability-only by construction** (Python never reads it back), so the JS "SDK-owned envelope quarantines the customer string" machinery (JS §8.1) is **not required for correctness** in Python. v1 may still wrap it in a small `DagSummary` JSON envelope (`build_dag_summary_envelope`) for **console/log readability parity** with JS, but this is optional and non-load-bearing.

**[PY NOTE — the STARTED-under-early-completion faithfulness concern is inherited, not solved.]** JS's envelope carries `startedTaskNames` because those checkpoints were dropped at early completion and cannot be re-derived (JS §5.7/§8.1). Under Python's re-execute model, re-running the scheduler after an early completion would **restart** those in-flight tasks rather than faithfully reporting them as `STARTED`. This is precisely the same fidelity limitation Python's existing `map`/`parallel` + `min_successful` already have under `ReplayChildren` (they re-run too). v1 **matches the existing platform behavior** (consistency over JS-parity) and documents it; a faithful STARTED-set replay would require the JS envelope approach and should be a **cross-SDK** change if desired (open question §11.2). This is the clearest place where "port the JS design" is **infeasible without also changing Python map/parallel**, so it is deferred.

---

## 9. Validation

Runs once, after `register`, before the scheduler (inside the child body). Ports JS §6 directly:

- **`DagInvalidTaskNameError`:** non-empty, ≤100 chars, `^[a-zA-Z0-9_]+$` (no `-`), no `DAG_NODE_T_` substring. Also raised when no name can be resolved for a task (§2.2).
- **`DagDuplicateTaskError`:** duplicate name in the scope's `dict[str, TaskDef]`.
- **`DagInvalidDependencyError`:** a dep handle not registered in this DAG scope (enforces scope isolation — a handle from a parent/other DAG fails).
- **`DagCyclicDependencyError`:** Kahn's algorithm over `all_deps`, O(V+E), listing cyclic task names.

Validation errors are **registration-time and deterministic** (§10), so they reproduce identically on replay. They are raised inside the child body and unwrapped from `ChildContextError` at the `dag()` boundary (§7.3 option a).

---

## 10. Scoping & determinism

- **Name uniqueness** is scoped to the immediate `DagContext`; nested DAGs open a fresh scope; a dep handle must belong to the same scope (§9). Ports JS §10.1.
- **`register` must be deterministic** on replay (same names, deps, trigger rules, `run_if`). It is **synchronous** in Python (no `async`), which actually _reduces_ the JS non-determinism surface (no awaited IO in registration). Non-deterministic registration produces a different graph on replay and surfaces as operation-consistency failures on task IDs. Ports JS §10.2.

---

## 11. Open questions & recommendations

1. **Custom result-based completion (JS §13.4).** No Python counterpart exists (`CompletionConfig` is threshold-only). _Recommendation:_ defer; introduce a `shouldComplete` predicate + `DagCompletionStatus` + `CompletionDecision` factories as a **cross-cutting** SDK feature (map/parallel + dag), not DAG-only, to avoid drift.
2. **Faithful STARTED set under large-payload early completion (§8.2).** Python's re-execute model cannot reproduce the in-flight set. _Recommendation:_ match existing `map`/`parallel` behavior in v1; revisit with a cross-SDK envelope if fidelity is required.
3. **Handle-keyed `DepsMap` typing (§2.3).** `deps[handle] -> T` recovers static types; `deps["name"] -> Any`. _Recommendation:_ ship both, document handle-keying as the typed path.
4. **`error_mapper` on `child_handler` (§7.3).** v1 unwraps `ChildContextError.__cause__` at the `dag()` boundary (no shared-code change). _Recommendation:_ revisit adding `error_mapper` to `ChildConfig` if other callers want it.
5. **Async registration.** Not applicable — the SDK has no asyncio surface. `register` stays sync.

---

## 12. Testing outline

Follows the repo's `conformance-tests/handlers/<op>/` + pytest pattern (mirrors `map/`, `parallel/`, `child/` handler suites).

- **`test_dag_validator.py`:** cycle detection (self-loop, 2-cycle, deep, diamond=no-cycle); invalid names (empty, >100, dash, `DAG_NODE_T_` substring, unresolvable); duplicates across op kinds; missing/foreign-scope deps.
- **`test_trigger_rules.py`:** full truth table (§5) × {all-succ, all-fail, mixed, includes-skip, empty}.
- **`test_task_handle.py`:** `.after()`/`.trigger_rule()` chaining mutates `TaskDef`; `deps[handle]` vs `deps["name"]` access.
- **`test_dag_executor.py`** (mock/local context): readiness/topological order; `max_concurrency` throttling; skip propagation; `run_if` skip; threshold `completion_config` (`min_successful`, tolerated counts); drain-vs-fail-fast (default drains).
- **`test_dag_result.py`:** `get_result`/`get_status` for succeeded/failed/skipped/not-run; `throw_if_error`; `to_dict`/`from_dict` round-trip incl. `result_kind` recursion (batch/dag) and `ErrorObject` reconstruction.
- **Entity-ID tests:** `_create_task_id` for prefixed/unprefixed; nested recursion where a nested DAG's sub-task is prefixed by the nested container's **hashed** id (assert `id(rule_a) == blake2b(f"{Hval}-DAG_NODE_T_rule_a")` with `Hval = blake2b(f"{Hcontainer}-DAG_NODE_T_validation")`, i.e. **no** `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` pre-image ever exists); no collision with counter IDs (`{Hc}-{int}` vs `{Hc}-DAG_NODE_T_{name}`).
- **Conformance handlers** (deployed-runner + local): diamond `A→{B,C}→D` (assert B,C concurrent via invocation counts); mixed op-type tasks (each appears as native subtype under a `DAG_NODE_T_`-derived id); compensation (charge fails ⇒ refund `ALL_FAILED` runs, fulfill `ALL_SUCCESS` skips, audit `ALL_DONE` runs); `run_if` branching; nested DAG scope isolation.
- **Replay/interruption:** interrupt after a subset checkpoint; resume; assert completed tasks hit fast paths (count side effects) and remaining run once; `run_if`-skip stays skipped across replay without a checkpoint; **large-payload** forces `ReplayChildren` and asserts the DAG **re-executes** to an equal `DagResult` (the Python behavior, §8.2) — and that a custom `summary_generator` string neither changes the replayed result nor hangs replay (trivially true in Python since it is never read).

---

## Appendix A. JS-decision → Python mapping (Ports directly / Adapts / Infeasible-deferred)

| #   | JS design decision                                                      | Python disposition      | How / why                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Type-level `DepsMap` / literal-string name capture                      | **Adapts**              | No Python type machinery for value-captured keys. Use a runtime name-keyed `Mapping` (`deps["name"]`) + handle-keyed overload `deps[handle] -> T` for static typing. §2.3                                                                                                                                                                                                                                       |
| b   | `TaskHandle` as reference + builder                                     | **Ports**               | `@dataclass(eq=False)`, hashable by name; `.after()`/`.trigger_rule()` chaining. §2.4                                                                                                                                                                                                                                                                                                                           |
| c   | Name-based entity IDs + reserved `DAG_NODE_T_` + no-dash names          | **Adapts**              | Same _shape_ (a `DAG_NODE_T_` token per level) but different mechanics: Python re-hashes at **each** child-context boundary (prefix = already-hashed container id), so injectivity rests on per-level charset injectivity + blake2b collision-resistance, **not** unique decomposition of one raw multi-level string. Name charset rules become defense-in-depth / debug hygiene, not the primary guarantee. §4 |
| d   | Trigger rules + `run_if` (sync predicate)                               | **Ports verbatim**      | Full truth table + evaluators; Python is sync everywhere, so `run_if` is a natural fit. §2.5, §5                                                                                                                                                                                                                                                                                                                |
| e   | Completion-reason core/superset                                         | **Adapts**              | Python base enum has 3 members (no `CUSTOM_*`); DAG defines its own 4-member enum (adds `COMPLETED_WITH_FAILURES`), value-compatible with the base. §2.7                                                                                                                                                                                                                                                        |
| e′  | Custom result-based completion (`shouldComplete`/`DagCompletionStatus`) | **Infeasible-deferred** | No custom-completion predicate exists in Python (`CompletionConfig` threshold-only; no `CompletionDecision`). Reuse threshold config; defer custom path to a cross-SDK feature. §2.8, §11.1                                                                                                                                                                                                                     |
| f   | SDK summary envelope + design-B reconstruct-don't-reschedule            | **Adapts (diverges)**   | Python `ReplayChildren` **re-executes** the child body (grounded in `operation/child.py`), so summary is already observability-only and #751 does not reproduce. DAG re-runs (= its interrupt-resume path) instead of reconstructing. Faithful STARTED-set replay is **infeasible-deferred** (would need cross-SDK envelope). §8.2, §11.2                                                                       |
| g   | Heterogeneous task types + nested DAGs                                  | **Ports**               | Reuse existing per-op executors + `child_handler`; `result_kind` tagging for batch/dag results; nested container gets `…-DAG_NODE_T_{name}`. §6.3, §8.1, §9                                                                                                                                                                                                                                                     |
| —   | Return type `DurablePromise<DagResult>`                                 | **Adapts**              | Python returns `DagResult` **synchronously** (blocking); no `DurablePromise`/`await`. §2.1                                                                                                                                                                                                                                                                                                                      |
| —   | Family A/B handler split (`createStepId` vs `waitForCallback`)          | **Ports (simpler)**     | Python executors take a full `OperationIdentifier`; callbacks are already child-context-based. No split needed. §6.3                                                                                                                                                                                                                                                                                            |
| —   | `withDurableModeManagement` bypass                                      | **Ports**               | Bypass the counter-coupled `_replay_aware`; rely on explicit-ID checkpoint fast paths. §6.2                                                                                                                                                                                                                                                                                                                     |
| —   | `errorMapper: (e)=>e` pass-through                                      | **Adapts**              | No `error_mapper` in Python `child_handler`; unwrap `ChildContextError.__cause__` at the `dag()` boundary (the existing `wait_for_callback` precedent). §7.3                                                                                                                                                                                                                                                    |

---

## Appendix B. Review resolutions (loop iteration 1 — py_review)

All 5 points were **accepted and fixed**; none rejected. Each was re-verified against real Python SDK source before editing.

- **MAJOR-1 (entity-ID injectivity, §1.1/§4.1/§4.2/§4.3/Appendix A(c)).** Fixed. Verified in `context.py` that `create_child_context(operation_id=…)` sets the child's `_step_id_prefix` to the parent operation's **already-blake2b-hashed** `operation_id`, and `_create_step_id_for_logical_step` re-hashes `f"{prefix}-{step}"`. So Python hashes **per level** and never composes a raw multi-level string. Redrew the §4.1 diagram to show hashed prefixes (`Hcontainer`, `Hval`) with the true form `blake2b(f"{containerHash}-DAG_NODE_T_{name}")`, explicitly noting `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` never exists. Regrounded §4.2 injectivity on **per-level charset injectivity + blake2b collision-resistance**, recharacterized the no-dash / no-token rules as **defense-in-depth / debug hygiene / cross-language parity** (reversing the JS framing), retitled §4 "adapts", updated §1.1 PY NOTE, §4.3, Appendix A(c), and the §12 entity-ID test.

- **MAJOR-2 (§6.1 ConcurrentExecutor "preferred").** Fixed. Verified in `concurrency/executor.py` that `ConcurrentExecutor` takes fixed up-front `executables`, submits all at once, keys IDs on `executable.index`, uses a single `sub_type_iteration`, and one global `_completion_event`/`ExecutionCounters`/`completion_config` — incompatible with wave readiness, name-based IDs, heterogeneous subtypes, DAG-global + skip-aware completion, and with §7.2's "no changes to `concurrency/executor.py`". Rewrote §6.1 to make the **dedicated `DagExecutor` the sole v1 path**, reusing only the thread primitives (`ThreadPoolExecutor`, `TimerScheduler`, suspend protocol), enumerating the four incompatibilities, and accepting the ~200-line orchestration re-implementation as the cost of leaving shared code untouched. Now consistent with the §5.8 "separate component" statement.

- **MINOR-3 (§6.3 pre-hash string).** Fixed. Corrected `…-DAG_NODE_T_{name}-{index}` → `f"{containerHash}-{index}"`, matching `_execute_item_in_child_context`'s `_create_step_id_for_logical_step(executable.index)` where the branch child context's prefix is the map/parallel task's already-hashed container id.

- **MINOR-4 (§2.3/§2.4 handle-keyed deps).** Fixed. Because `TaskHandle` is `@dataclass(eq=False)` (identity `__eq__`), hashing-to-name is insufficient for dict lookup. Added an explicit **runtime `isinstance(key, TaskHandle)` branch** in `DepsMap.__getitem__` (with `@overload`s for typing only), and clarified in §2.4 that `TaskHandle.__hash__` supports handle-keyed _sets_ but not name-keyed lookup.

- **MINOR-5 (§2.2/§2.3 invoke payload_fn).** Fixed. Added a PY NOTE flagging that the real `invoke` takes an **eager `payload`**, whereas `DagContext.invoke` accepts a deferred `payload_fn: Callable[[DepsMap], P] | P` so payloads can depend on upstream results; the callable is materialized deterministically from checkpointed deps before the executor runs, so replay is unaffected.

**Reviewer-confirmed-TRUE claims left intact:** both "infeasible" claims (custom result-based completion, §2.8/§11.1; design-B STARTED-set under re-execute / #751, §8.2/§11.2) and the deps-map type adaptation (§2.3) were verified TRUE against real source by the reviewer and are unchanged except where the above edits touch surrounding prose.
