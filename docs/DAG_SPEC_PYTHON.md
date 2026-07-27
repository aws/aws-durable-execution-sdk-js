# DAG Support (`context.dag()`) — Python Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable.
>
> **Required API annotation (Python).** Because Python has no build-time release-tag tooling, experimental status is marked two ways: (1) a `.. warning:: Experimental` admonition on every public symbol in `dag.py`, and (2) a runtime one-time `FutureWarning` emitted on first use of `context.dag()` (`operation/dag.py::emit_experimental_warning_once`).
>
> ```python
> def dag(self, register, name=None, config=None):
>     """Declare and run a DAG of tasks. ...
>
>     .. warning::
>        **Experimental.** This API is experimental and may be changed or
>        removed in future releases.
>     """
> ```

Status: Implementation-ready · **Stability: Experimental** · Target: `aws-durable-execution-sdk-python` · Scope: core package `packages/aws-durable-execution-sdk-python`

**Canonical design source:** [`DAG_SPEC.md`](./DAG_SPEC.md) (JS/TS). **Normative cross-language contract:** [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md). This document describes the Python SDK's implementation. Where the Python SDK expresses the design with different machinery than the canonical JS design (compile-time types, `DurablePromise`, custom-completion predicates), the divergence is called out with a **[PY NOTE]** and grounded in the source.

Source files grounding this spec (under `packages/aws-durable-execution-sdk-python/src/aws_durable_execution_sdk_python/`): `dag.py`, `operation/dag.py`, `operation/dag_context.py`, `operation/dag_executor.py`, `operation/dag_result.py`, `operation/dag_validator.py`, `context.py`, `identifier.py`, `config.py`, `concurrency/models.py`, `concurrency/executor.py`, `operation/child.py`, `operation/step.py`.

---

## 1. Overview

`context.dag()` adds a declarative directed-acyclic-graph primitive to the Python SDK. Tasks are declared once in a _registration phase_; the runtime schedules them topologically, runs independent chains concurrently on the SDK's worker-thread model, evaluates per-task trigger rules and `run_if` predicates, and aggregates results into a `DagResult`.

A DAG is implemented as a **container child context** — one node in the parent's operation tree — whose body runs a **name-based scheduler**. Each task delegates to the **same operation executor** the equivalent standalone `DurableContext` method uses (`StepOperationExecutor`, `InvokeOperationExecutor`, `child_handler`, etc.); the only difference is that a task's entity ID is derived from its **name** instead of the per-context counter.

### 1.1 Why name-based IDs are required

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

`map`/`parallel` are replay-safe **not** because of the counter but because the concurrent executor (`concurrency/executor.py::_execute_item_in_child_context`) derives each item's operation ID directly from its **stable `Executable.index`** via `executor_context._create_step_id_for_logical_step(executable.index)`, explicitly bypassing `_step_counter` so that "the same input always produces the same id regardless of the order branches actually run in." In an arbitrary DAG a downstream task starts when its upstream deps _complete_, and completion order can vary across replays; a **counter-based** ID (which advances at operation _start_) would diverge and the operation would not match its checkpoint. The DAG derives the ID from a stable key that is independent of run-time ordering — the task **name** (§4) in place of a numeric index.

**[PY NOTE — IDs are hashed at _every_ level, so any deterministic string works.]** `_create_step_id_for_logical_step` feeds the composed string through `blake2b(...).hexdigest()[:64]` before it is used as a checkpoint key; the raw string is never parsed by the runtime. Python **re-hashes at each child-context boundary**: `create_child_context(operation_id=…)` sets the child's `_step_id_prefix` to the parent operation's _already-hashed_ `operation_id` (`context.py`), so a nested task's pre-image is `f"{containerHash}-DAG_NODE_T_{name}"`, never a raw multi-level string. Cross-level injectivity therefore rests on **blake2b collision-resistance per level**, and the name charset rules are **defense-in-depth / debug hygiene** (§4.2). This matches the cross-language contract's per-level-re-hashing group (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.1–2.A.2).

### 1.2 Non-goals (v1)

Same as JS §1.3: no dedicated branch operator (covered by `run_if`), no dynamic task creation, no cross-task semaphores, no pre-built operators.

---

## 2. Public API (idiomatic Python)

Public types live in `aws_durable_execution_sdk_python/dag.py` (`DagContext`, `TaskHandle`, `DepsMap`, `DagResult`, `DagConfig`, `TaskExecution`, the enums) with the scheduler/validator/handler/result implementation under `operation/dag*.py`; the public surface is re-exported from `__init__.py`.

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

**[PY NOTE — no `DurablePromise`; blocking return.]** Every Python `DurableContext` operation returns its result **directly** (blocking), suspending the whole invocation via a raised `SuspendExecution` when it must wait. Python has no `DurablePromise`/`await`, so `dag()` **returns a `DagResult` synchronously**, consistent with `run_in_child_context`.

`register` is a **registration-only, synchronous** callback. Tasks are _declared_ but do not execute until it returns.

### 2.2 `DagContext`

An abstract class (does **not** subclass `DurableContext`) exposing only declarative task-registration methods. Each method registers exactly one task and returns a `TaskHandle`. Argument order follows the Python SDK convention: the operation-specific callable/payload first, then `deps`, `name`, `config`, with `trigger_rule` and `run_if` as keyword-only parameters.

```python
class DagContext(ABC):
    def step(
        self,
        func: Callable[..., T],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: StepConfig | None = None,
        *,
        trigger_rule: TriggerRule = TriggerRule.ALL_SUCCESS,
        run_if: Callable[[DepsMap], bool] | None = None,
    ) -> TaskHandle[T]: ...

    def invoke(
        self,
        function_name: str,
        payload_fn: Callable[[DepsMap], Any] | Any,
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: InvokeConfig[Any, Any] | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...

    def wait_for_callback(
        self,
        submitter: Callable[..., None],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: WaitForCallbackConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...

    def wait(
        self,
        seconds: int,
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[None]: ...

    def wait_for_condition(
        self,
        check: Callable[..., T],
        config: WaitForConditionConfig[T],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[T]: ...

    def run_in_child_context(
        self,
        func: Callable[..., T],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: ChildConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[T]: ...

    def map(
        self,
        inputs: Sequence[U] | Callable[[DepsMap], Sequence[U]],
        func: Callable[..., T],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: MapConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...

    def parallel(
        self,
        functions: Sequence[Callable[[DurableContext], Any]],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: ParallelConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...

    def dag(
        self,
        register: Callable[[DagContext], None],
        deps: Sequence[TaskHandle[Any]] | None = None,
        name: str | None = None,
        config: DagConfig | None = None,
        *, trigger_rule=..., run_if=...,
    ) -> TaskHandle[Any]: ...
```

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `ChildConfig`, `MapConfig`, `ParallelConfig`, `WaitForConditionConfig`, and `CompletionConfig` are the **existing** Python SDK types (`config.py`, `waits.py`), reused verbatim so per-task retry/serdes/completion behavior is identical to the standalone operations.

**[PY NOTE — `invoke` takes a _deferred_ `payload_fn`.]** The standalone `DurableContext.invoke` takes an **eager `payload` value**, because it has all its inputs at call time. A DAG `invoke` task frequently needs to build its payload from **upstream results that only exist at run time**, so `DagContext.invoke` accepts `payload_fn: Callable[[DepsMap], Any] | Any` — a deps-taking callable _or_ a plain eager value. A plain value is used as-is; a callable is invoked with the resolved `DepsMap` at scheduling time to produce the payload, then handed to the underlying `InvokeOperationExecutor` as an eager value. Because the payload is materialized _before_ the executor runs (deterministically, from checkpointed deps), this does not affect replay. The other task kinds already take callables in the standalone SDK, so only `invoke` carries this shape.

**Name defaulting.** `context.py::_resolve_step_name` is `return name or getattr(func, "_original_name", None)` — it uses the explicit `name` when truthy, else the `_original_name` attribute set by the `@durable_step` / `@durable_with_child_context` / `@durable_wait_for_callback` decorators, else `None`. It does **not** fall back to `func.__name__`, so a bare `lambda` resolves to `None`. Because a DAG task name is load-bearing for its entity ID (§4), if name resolution yields `None` the DAG method raises `DagInvalidTaskNameError` at registration. DAG tasks built from bare lambdas MUST pass an explicit `name`.

### 2.3 Passing deps and the deps-map

**[PY NOTE — Python has no type-level `DepsMap`.]** The JS design's headline typing feature is `DepsMap<TDeps>` — a mapped type capturing each dependency's **literal-string name** and result type at compile time. This depends on TypeScript literal-string generics and mapped types, which have no Python equivalent. Python's model is a runtime name-keyed mapping:

- `deps` is passed as a **list of `TaskHandle`s** — `DepsArg = Sequence[TaskHandle[Any]] | None`.
- Inside a task body the resolved upstream results arrive as a **`DepsMap`**, a `Mapping[str, Any]` keyed by dependency **task name**. `deps["fetch"]` returns the fetch task's result, typed `Any`.
- For static typing, the body pulls typed values off the _handle_: `deps[fetch]` (indexing by the `TaskHandle` object) returns `T | None`.

**[PY NOTE — handle-keyed access dispatches at runtime, not by hashing-to-name.]** `TaskHandle` is `@dataclass(eq=False)`, so it keeps object-**identity** `__eq__`. Although it defines `__hash__ = hash(self._name)`, a `dict` keyed by _string_ names cannot be looked up by a handle: `dict` requires **both** matching hash **and** `key == storedKey`, and `handle == "fetch"` is `False` under identity equality. `DepsMap.__getitem__` therefore branches at runtime on the key type:

```python
class DepsMap(Mapping[str, Any]):
    def __init__(self, by_name: dict[str, Any]) -> None:
        self._by_name = by_name

    @overload
    def __getitem__(self, key: "TaskHandle[T]") -> "T | None": ...
    @overload
    def __getitem__(self, key: str) -> Any: ...
    def __getitem__(self, key: "str | TaskHandle[Any]") -> Any:
        name = key._name if isinstance(key, TaskHandle) else key   # runtime dispatch
        return self._by_name[name]
```

The `@overload`s recover the static type `deps[handle] -> T | None`; the `isinstance` branch makes it work at run time. `__contains__` dispatches the same way. The result is **`T | None`**, not bare `T`: a dependency's result is present only when that upstream task SUCCEEDED. Under a non-`ALL_SUCCESS` trigger rule (`ALL_DONE`, `ANY_FAILED`, `NONE_FAILED`, `ALL_FAILED`) a task body can legitimately run while an upstream dep FAILED or was SKIPPED, in which case its value is `None`.

```python
# handle-keyed access recovers the static type (recommended):
fetch = d.step(fetch_source)                      # TaskHandle[SourceData]
d.step(transform, deps=[fetch])                   # inside: data = deps[fetch]  -> SourceData | None
# string-keyed access is always available but typed Any:
#   data = deps["fetch_source"]
```

**Deps-first argument rule.** The task body always receives `deps` as its first positional argument, followed by the operation's native context/args; a task with no deps receives an empty `DepsMap`. This is uniform (no conditional signature).

```python
# step body:              (deps, step_ctx)
d.step(lambda deps, ctx: transform(deps["fetch"]), deps=[fetch], name="xform")
# invoke payload_fn:      (deps) -> payload
d.invoke("pay:prod", lambda deps: {"amt": deps["validate"]}, deps=[validate], name="charge")
# wait_for_callback:      (deps, callback_id, ctx)
# wait_for_condition:     (deps, state, ctx)
# run_in_child_context:   (deps, child_ctx)
```

**Ordering-only deps** (`TaskHandle.after(*handles)`, §2.4) gate scheduling and trigger-rule evaluation but do **not** appear in the `DepsMap`. `TaskDef` stores `inline_deps` (drive the map) and `all_deps = inline_deps ∪ after-edges` (drive readiness/trigger/cycle).

### 2.4 `TaskHandle`

Registration-time reference + builder. Never serialized. Identity is its **name** (unique within the DagContext scope). It defines `__hash__ = hash(self._name)` so handles can be collected in `set`s / used as dict keys _among handles_ (e.g. the `all_deps` edge set); this hash does **not** make `deps[handle]` resolve against a name-keyed dict — `DepsMap.__getitem__` dispatches on `isinstance(key, TaskHandle)` and extracts `_name` explicitly (§2.3).

```python
@dataclass(eq=False)
class TaskHandle(Generic[T]):
    _name: str
    _dag: Any                        # back-ref to DagContextImpl (Any avoids a circular import)
    def __hash__(self) -> int: return hash(self._name)

    @property
    def name(self) -> str: return self._name

    def after(self, *deps: "TaskHandle[Any]") -> "TaskHandle[T]":
        """Ordering-only deps: wait for these but do not receive their results."""
        self._dag._register_after(self, deps)
        return self

    def trigger_rule(self, rule: "TriggerRule") -> "TaskHandle[T]":
        self._dag._register_trigger_rule(self, rule)
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

`run_if: Callable[[DepsMap], bool] | None` is a **synchronous, deterministic** predicate over resolved upstream results. It is evaluated after the trigger rule passes and before the operation runs. Returns `False` ⇒ task `SKIPPED` with `skip_reason=RUN_IF_PREDICATE`.

A predicate that **raises** aborts the DAG with a typed `DagPredicateError` naming the task and carrying the original error as its `__cause__` — the task gets **no terminal state**, and the raise is neither a task `FAILED` nor a `SKIPPED` (`operation/dag_executor.py::_evaluate_locked`). This is the contract of `DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3: `run_if` is a pure predicate, so a raise is a defect, not a business outcome, and must not silently drive downstream `ALL_FAILED`/`ANY_FAILED`/`ALL_DONE` compensation paths. The full trigger-rule truth table (`_trigger_passes`), including the empty-upstream row and the `ALL_FAILED` `len > 0` guard, ports verbatim (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.2).

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

class DagResult(ABC):
    @overload
    def get_result(self, task: TaskHandle[T]) -> T | None: ...
    @overload
    def get_result(self, task: str) -> Any: ...
    def get_result(self, task: str | TaskHandle[Any]) -> Any: ...
    def get_status(self, task: str | TaskHandle[Any]) -> TaskStatus | None: ...
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

`get_result(handle)` returns `T | None` via `@overload` (the same `T | None` rationale as `DepsMap`, §2.3): a missing, FAILED, or SKIPPED task has no result and yields `None`. `get_result(name)` returns `Any`. Both resolve by task name at runtime. `get_status` returns `None` for a task that never ran. The accessor surface mirrors `BatchResult` (`concurrency/models.py`).

### 2.7 Completion reason

Python's core `CompletionReason` (`concurrency/models.py`) has three members and no custom-completion members:

```python
class CompletionReason(Enum):
    ALL_COMPLETED = "ALL_COMPLETED"
    MIN_SUCCESSFUL_REACHED = "MIN_SUCCESSFUL_REACHED"
    FAILURE_TOLERANCE_EXCEEDED = "FAILURE_TOLERANCE_EXCEEDED"
```

The DAG defines its own enum whose first three members are value-compatible with `CompletionReason` and adds the single DAG-specific member:

```python
class DagCompletionReason(Enum):
    ALL_COMPLETED = "ALL_COMPLETED"
    MIN_SUCCESSFUL_REACHED = "MIN_SUCCESSFUL_REACHED"
    FAILURE_TOLERANCE_EXCEEDED = "FAILURE_TOLERANCE_EXCEEDED"
    COMPLETED_WITH_FAILURES = "COMPLETED_WITH_FAILURES"   # DAG-only
```

Python `Enum`s cannot be extended by subclassing with new members, so the DAG declares its own enum rather than a union; `dag_reason_from_core(core: CompletionReason) -> DagCompletionReason` (`operation/dag_result.py`) bridges the batch reasons the DAG reuses. Semantics match `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.3/§2.B.5: default drain ⇒ `ALL_COMPLETED` if every reachable task succeeded/skipped, else `COMPLETED_WITH_FAILURES`; `throw_if_error()` keys off `failure_count`, not the reason.

### 2.8 `DagConfig` and completion

```python
@dataclass(frozen=True)
class DagConfig:
    max_concurrency: int | None = None                 # None => DEFAULT_DAG_MAX_CONCURRENCY (40)
    completion_config: CompletionConfig | None = None  # reused from config.py (threshold-only)
    default_trigger_rule: TriggerRule = TriggerRule.ALL_SUCCESS
    serdes: SerDes | None = None                       # for the DagResult container payload
```

**`max_concurrency`.** When `None`, the scheduler caps concurrency at `DEFAULT_DAG_MAX_CONCURRENCY` (40, `operation/dag_executor.py`) rather than running unbounded; an explicit value always wins, including a value above 40. The only validation is that an explicit value must be `>= 1` (`<= 0` raises `ValidationError` at the top of the handler and in `DagExecutor.__init__`). The bound governs the **DAG scheduler only** — the top-level tasks of _this_ DAG. It is deliberately **not** inherited by a task's own internal fan-out: a `map` or `parallel` task keeps its own default (unlimited) unless configured on that task, and a nested `dag` task gets its own independent default of 40 (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3a). This is a resource bound — in Python the `ThreadPoolExecutor` is sized from the same number, so an unbounded 500-task DAG would spawn 500 OS threads inside the Lambda sandbox.

**`completion_config`.** The DAG reuses the existing threshold-only `CompletionConfig` (`config.py`: `min_successful`, `tolerated_failure_count`, `tolerated_failure_percentage`) verbatim for early completion. Python's `CompletionConfig` is threshold-only; there is no result-based custom-completion predicate in the Python SDK (no `shouldComplete` / `CompletionDecision` analog), so `DagConfig` exposes no such hook. Result-based short-circuit is expressible today by having a task inspect its deps and raise, or by `min_successful`.

**Skip accounting.** Because the reused `CompletionConfig` is result-blind and skip-blind, the DAG scheduler computes `success_count`/`failure_count`/`skipped_count` itself (SKIPPED counts toward neither success nor failure, `DAG_SPEC_CROSS_LANGUAGE.md` §2.B.2) and feeds only success/failure counts into the threshold logic (§5.7). No change to `CompletionConfig` is needed.

There is no customer-facing summary generator on `DagConfig`. The container's checkpoint payload is the self-describing converged envelope (§8), which is readable without any customer-supplied string — this is the construction that closes the corruption vector described in `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4.

---

## 3. Two ways to declare dependencies

```python
c = d.step(process, deps=[a, b])                        # inline => typed-ish access deps[a], deps[b]
a = d.step(fetch_a)                                     # root => empty DepsMap
d.step(notify).after(a)                                 # ordering-only => not in DepsMap
e = d.step(process, deps=[a]).after(b)                  # mixed: deps[a] present, b ordering-only
```

`inline_deps` populate the `DepsMap`; `.after(...)` edges add scheduling/trigger/cycle edges only (§2.3).

---

## 4. Entity-ID strategy & replay correctness (per-level hashing)

### 4.1 Name-based task IDs

A task's entity ID is `blake2b(f"{prefix}-DAG_NODE_T_{name}")[:64]` where `prefix` is the DAG child context's `_step_id_prefix` — i.e. the DAG container's own `operation_id`, which is **itself an already-blake2b-hashed 64-hex digest** (`create_child_context` sets the child's `_step_id_prefix` to the parent operation's hashed `operation_id`, `context.py`). If unprefixed, the ID is `blake2b(f"DAG_NODE_T_{name}")[:64]`.

Python re-hashes at every child-context boundary, so no raw multi-level string is ever composed. Writing `H(s) = blake2b(s).hexdigest()[:64]`, and letting `Hcontainer` be the DAG container's (already-hashed) operation id:

```
context.dag(...) container op id:        Hcontainer = H("{parentPrefix}-{counter}")   # a 64-hex digest
  task "fetch_data":                     H("{Hcontainer}-DAG_NODE_T_fetch_data")
  nested dag "validation" container:     Hval = H("{Hcontainer}-DAG_NODE_T_validation")   # re-hashed here
    sub-task "rule_a":                   H("{Hval}-DAG_NODE_T_rule_a")                     # prefix is Hval, NOT a raw path
```

There is **no** `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` pre-image anywhere: the nested DAG's container id is hashed to `Hval` first (at the child-context boundary), and its sub-tasks are prefixed with `Hval`. This is the same per-level hashing `map`/`parallel` already rely on. The observable wire shape (one `DAG_NODE_T_` token per level, hashed before storage) matches `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.1.

### 4.2 Injectivity — per-level charset injectivity + blake2b collision-resistance

Because each child-context level is hashed independently, Python injectivity rests on two facts (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.2, per-level-re-hashing group):

1. **Within a level — charset injectivity.** At a fixed container prefix `Hc`, every task pre-image is `f"{Hc}-DAG_NODE_T_{name}"`. Distinct task names give distinct pre-images because `name` is appended verbatim and duplicate names are rejected at registration (§9). A task id can never collide with a counter-based sibling id (`f"{Hc}-{int}"`) because the segment after `{Hc}-` is either the literal `DAG_NODE_T_…` (starts with a letter) or a decimal integer — disjoint by construction.
2. **Across levels — blake2b collision-resistance.** A nested task's prefix `Hval = H("{Hc}-DAG_NODE_T_validation")` is a collision-resistant digest of its parent level. Distinct paths through the DAG tree yield distinct prefixes with overwhelming probability, so no cross-level collision is possible; there is no raw multi-level string in which a name could forge a delimiter.

**Name charset rules are defense-in-depth / debug hygiene**, not the primary guarantee. They are enforced at registration anyway because they (a) keep IDs and logs cleanly greppable, (b) preserve one-to-one parity with the JS/Java/Go specs for cross-language conformance, and (c) guard against a future refactor that composes multi-level pre-images. Concretely enforced (§9):

1. **No `-` in task names** — charset `^[a-zA-Z0-9_]+$`.
2. **No `DAG_NODE_T_` substring in names** — keeps the token reserved for readability.

Because IDs are blake2b-hashed to 64 hex chars before storage, token length has **zero** storage cost regardless of nesting depth.

### 4.3 `_create_task_id`

Internal helper on `DurableContext` (parallels `_create_step_id`):

```python
def _create_task_id(self, name: str) -> str:
    prefix = self._step_id_prefix    # the DAG container's OWN operation_id — already a blake2b digest
    raw = f"{prefix}-DAG_NODE_T_{name}" if prefix else f"DAG_NODE_T_{name}"
    return hashlib.blake2b(raw.encode()).hexdigest()[:64]
```

It does **not** touch `_step_counter`, so it never desynchronizes the counter-based replay machinery (§6.2). Because `prefix` is already a hashed 64-hex digest, each nesting level is hashed independently and no raw multi-level pre-image is ever built.

### 4.4 Replay-correctness argument

Traversal order may differ run-to-run; correctness depends only on stable IDs + topological ordering:

1. Each task ID is a pure function of its name + the DAG context prefix (§4.3) — identical every run.
2. When the scheduler runs task `X`, it invokes `X`'s underlying executor bound to `operation_id = idOf(X)`. If `X` already completed, the executor hits its **checkpoint fast path**: `StepOperationExecutor` / `ChildOperationExecutor.check_result_status` call `state.get_checkpoint_result(operation_id)` and, on `is_succeeded()`, `deserialize` and return **without re-executing** (`operation/step.py`, `operation/child.py`); on `is_failed()` they re-raise the checkpointed error. These fast paths key on the explicit `operation_id`, not on the counter.
3. Operation-consistency checks are likewise keyed on the explicit `operation_id`.
4. The scheduler rebuilds its in-memory `results` map each run by reading each completed task's checkpointed result via the fast path; topological order guarantees a task's deps are in `results` before it runs.

The only new requirement over `map`/`parallel` is the name-based ID derivation; checkpoint/retry/serdes/replay are the existing machinery.

---

## 5. Scheduler semantics

`DagExecutor` (`operation/dag_executor.py`) is a topological scheduler over the registered `TaskDef`s. It maintains `_results: dict[str, TaskExecution]`, an in-flight set, a scheduled set, and running success/failure/skip counters.

- **Readiness (§5.1):** a task is ready when every dep (inline + `.after`) is terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`) in `_results` (`_deps_terminal_locked`). Roots are ready immediately.
- **Trigger-rule evaluation (§5.3):** `_trigger_passes` ports the truth table verbatim, including the empty-upstream row and `ALL_FAILED`'s `len > 0` guard.
- **`run_if` (§5.4):** after the trigger passes, `_evaluate_locked` builds the `DepsMap` from `_results` and evaluates the sync predicate; `False` ⇒ SKIPPED / `RUN_IF_PREDICATE`. A predicate that raises ⇒ `DagPredicateError`, aborting the DAG (§2.5).
- **Running a task (§5.5):** `_run_task` calls `task_def.executor(dag_child_ctx, deps_map)`, which delegates to the operation's explicit-ID executor (§6). Return ⇒ `SUCCEEDED`; raise ⇒ `FAILED` (capturing `ErrorObject.from_exception`). Each terminal record stamps `started_at`/`completed_at`.
- **Skip propagation (§5.6):** a skip is a terminal transition; downstream tasks evaluate their own trigger rule against it.
- **Failure semantics (§5.8):** a failed task is a **terminal state, not an abort** — the DAG drains the reachable graph by default so compensation/fallback trigger rules run. `dag()` does **not** raise on task failure; it returns a `DagResult` with `failure_count > 0` and `completion_reason == COMPLETED_WITH_FAILURES`; callers opt in via `throw_if_error()`.

**[PY NOTE — deliberate divergence from Python `map`/`parallel` default fail-fast.]** `concurrency/models.py::ExecutionCounters.should_continue()` returns `self.failure_count == 0` when no completion config is set — Python map/parallel default is **fail-fast**. The DAG does not adopt this default (it would prevent compensation tasks from running); `DagExecutor` treats failure as a terminal state and drains. A caller wanting batch-style fail-fast opts in via `completion_config`. Because `DagExecutor` is a **separate component** from `ConcurrentExecutor`, this is a local design choice, not a change to shared code (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.5).

- **`completion_config` early completion (§5.7):** `_threshold_reason_locked` mirrors `ExecutionCounters.should_complete` ordering: success threshold first (`min_successful` reached ⇒ `MIN_SUCCESSFUL_REACHED`), then failure-tolerance count/percentage (⇒ `FAILURE_TOLERANCE_EXCEEDED`), then the impossible-to-succeed early stop (reachable successes < `min_successful` ⇒ `FAILURE_TOLERANCE_EXCEEDED`). The failure-percentage denominator excludes SKIPPED tasks. In-flight tasks are not cancelled; when the DAG stops early, still-running tasks appear as `STARTED` and not-yet-started tasks are **absent** from `_results` (`get_status` ⇒ `None`, counting only toward `total_count`).
- **Empty DAG (§5.9):** resolve immediately with `total_count=0`, `ALL_COMPLETED`.

### 5.1 SKIPPED tasks checkpoint nothing

A skip is a pure function of upstream terminal statuses + a deterministic `run_if`, recomputed identically each run, so it mints no entity ID and writes no checkpoint (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.4).

---

## 6. Scheduler concurrency & the replay-coupling problem

### 6.1 Concurrency model — threads, not asyncio

**[PY NOTE — the Python SDK is thread-based and cooperatively-suspending; there is no asyncio.]** `concurrency/executor.py` runs branches on a `concurrent.futures.ThreadPoolExecutor`, with a background timer thread for timed resumes, `OrderedLock`/`OrderedCounter` (`threading.py`) for deterministic ordering, and cooperative suspension via a raised `SuspendExecution` that unwinds the whole invocation. A durable operation that must wait raises `SuspendExecution`; the invocation ends and Lambda re-invokes to replay.

`DagExecutor` reuses the same worker-thread primitives (`ThreadPoolExecutor`, the `SuspendExecution`/`TimedSuspendExecution` protocol) but is a **dedicated scheduler**, not `ConcurrentExecutor`. It owns its own `TimerScheduler` (a self-contained in-process timed-resume mechanism, `operation/dag_executor.py`) so a **timed** suspend (e.g. `wait`) resumes _in-process_ — the DAG keeps making progress on other tasks and re-runs the timed task at its scheduled timestamp within the same invocation — while an **indefinite** suspend (e.g. `wait_for_callback`) stops scheduling and bubbles to the platform for replay.

**Why a dedicated `DagExecutor`, not `ConcurrentExecutor` reuse.** `ConcurrentExecutor` (`concurrency/executor.py`) is structurally hard-wired for the flat map/parallel shape:

- **Fixed, up-front executables.** Its `__init__` takes a complete `executables: list[Executable]` and `execute()` submits all of them at once. A DAG must submit tasks **wave by wave** as upstream deps become terminal.
- **Index-keyed IDs.** It derives every child id from `executable.index`. A DAG needs **name-based** ids (`…-DAG_NODE_T_{name}`, §4).
- **One `sub_type` for all items.** A DAG's tasks are **heterogeneous** (step, invoke, child, map, nested dag…), each needing its **native** subtype.
- **One global completion event/counters per `execute()`.** A DAG needs **DAG-global** completion accounting that also understands **SKIPPED** (result-blind `ExecutionCounters` cannot) and drains-on-failure by default (§5.8).

Bending `ConcurrentExecutor` to fit would also require editing `concurrency/executor.py`, which §7.2 keeps unchanged. `DagExecutor` therefore:

1. maintains the ready/in-flight/terminal sets and topological gating (`_pump`), submitting each ready wave to a `ThreadPoolExecutor(max_workers = max_concurrency or min(len(tasks), 40))`;
2. runs each task by constructing its operation executor / `child_handler` with a **name-based `OperationIdentifier`** and its **native `sub_type`** (§6.3);
3. re-derives readiness as futures resolve (via `add_done_callback` → `_on_done` → `_safe_pump`), evaluates trigger rules + `run_if` for newly-ready tasks, and computes DAG-global success/failure/skip counts (feeding only success/failure into the reused threshold `CompletionConfig`, §2.8);
4. records every `SuspendExecution`/`TimedSuspendExecution` raised by a task; resumes timed suspends in-process via its `TimerScheduler`, and when it stops (an indefinite suspend, an early-completion threshold, or a `run_if` raise) drains in-flight work and resolves which suspend to surface via `_resolve_suspend` (earliest timed wins over indefinite, matching `ConcurrentExecutor.should_execution_suspend`).

The scheduler runs **inside the DAG container child context body**, exactly like `map`/`parallel` bodies run inside their child context.

### 6.2 The replay-coupling problem

**[PY NOTE — `_replay_aware` is counter-coupled.]** Every public `DurableContext` operation wraps its body in `with self._replay_aware():` (`context.py`). `_replay_aware` peeks the next counter-based ID via `_peek_next_operation_id()` → `_create_step_id_for_logical_step(self._step_counter.get_current() + 1)`. A DAG task checkpoints under `…-DAG_NODE_T_{name}`, never under the counter, so wrapping an explicit-ID task call in `_replay_aware` would peek a counter ID with no checkpoint and mis-drive the context's replay status.

**Resolution:** the DAG's explicit-ID task calls **bypass `_replay_aware`** and invoke the operation executors directly with `operation_id = self._create_task_id(name)`. Task-level replay correctness comes entirely from counter-independent machinery already in the executors:

- the checkpoint fast paths keyed on the explicit `operation_id` (`StepOperationExecutor`, `ChildOperationExecutor.check_result_status`, `InvokeOperationExecutor`, the callback future's `state.get_checkpoint_result`);
- operation-consistency validation keyed on the explicit `operation_id`.

**[PY NOTE — this bypass is the same mechanism `map`/`parallel` already use.]** `concurrency/executor.py::_execute_item_in_child_context` derives each branch's `operation_id` via `_create_step_id_for_logical_step(executable.index)` and calls `child_handler` **directly** with a hand-built `OperationIdentifier`, bypassing `context.run_in_child_context` and therefore the parent's `_replay_aware`. Its sibling `replay()` re-derives the same index-based IDs and reads each child's checkpoint to rebuild the `BatchResult` without touching the counter. The DAG swaps the numeric index key for a name key; the pattern is otherwise identical.

Neither touches `_step_counter` or `_peek_next_operation_id`. The **context-level** replay decision (run the scheduler vs. return the checkpointed `DagResult`) is made at the **DAG container boundary** by `DagContainerExecutor` (§7.3), which for a top-level DAG occupies a real counter slot in the parent (via `_replay_aware` + `_create_step_id()`), and for a nested DAG uses a name-based id (`_create_task_id`). Within the DAG body the counter is never advanced (only `register` + explicit-ID task calls run), so leaving it untouched cannot desynchronize anything. Nested `map`/`parallel`/`dag` tasks each create their own child context whose replay status is computed independently.

### 6.3 Explicit-ID executor invocation

The Python executors take a fully-formed `OperationIdentifier` at construction (`identifier.py`, every executor ctor in `operation/*.py` and `context.py`). The DAG's explicit-ID variant constructs the executor with an `OperationIdentifier(operation_id=self._create_task_id(name), sub_type=…, parent_id=self._parent_id, name=name)` and calls `.process()` — no callback injection, no `_replay_aware` wrapper. For example, the step task runner:

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
- **run_in_child_context / map / parallel / nested dag / wait_for_callback:** run through `child_handler` with the name-based `OperationIdentifier` as the container id. The per-item/branch children created _inside_ a `map`/`parallel` task get **index-derived** IDs via `_create_step_id_for_logical_step(index)`, whose pre-hash pre-image is `f"{containerHash}-{index}"` where `containerHash` is the map/parallel task's own (already-hashed) `operation_id` used as the branch child context's `_step_id_prefix` (`concurrency/executor.py`). It is **not** `…-DAG_NODE_T_{name}-{index}`; the `DAG_NODE_T_{name}` token is already folded into `containerHash` at the child-context boundary. These branch IDs are index derivations, not counter increments, and are unchanged from standalone `map`/`parallel`.

**[PY NOTE — no JS Family A/B handler split in Python.]** JS reconciles handlers that take `createStepId` versus `waitForCallback` which takes `peekStepId`+`runInChildContext`. Python has no such split: **all** operations construct an `OperationIdentifier` directly, and `wait_for_callback` is already child-context-based (`context.py::wait_for_callback` → `run_in_child_context`). Every task kind reduces to "construct executor/`child_handler` with a name-based `OperationIdentifier`, skip `_replay_aware`." Per the cross-language callback shape (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5), a callback task materializes as a container context with SubType `Callback` carrying the name-based task id, whose body runs the native wait-for-callback operation.

---

## 7. Handler & registration

### 7.1 File structure

```
src/aws_durable_execution_sdk_python/
  dag.py                      # public: DagContext (ABC), TaskHandle, DepsMap, DagResult,
                              #         DagConfig, TaskExecution, TriggerRule, TaskStatus,
                              #         SkipReason, DagCompletionReason
  operation/dag.py            # dag_handler / run_nested_dag; DagContainerExecutor (checkpoint
                              #   orchestration + degradation ladder + reconstruct); unwrap_dag_error
  operation/dag_context.py    # DagContextImpl: registers TaskDefs, returns TaskHandles; TaskDef
  operation/dag_executor.py   # DagExecutor (topological scheduler) + TimerScheduler
  operation/dag_result.py     # DagResultImpl + DagResultSerDes (converged-envelope to_dict/from_dict)
  operation/dag_validator.py  # name / duplicate / missing-dep / cycle validation
  exceptions.py               # (extend) Dag* error classes
```

### 7.2 Changes to existing files

- `context.py` — add `dag(...)` + `_create_task_id` + the internal explicit-ID task runners (`_run_step_task`, etc., all private).
- `lambda_service.py` (`OperationSubType`) — add `DAG = "Dag"` for the container subtype; task subtypes stay native.
- `exceptions.py` — add `DagExecutionError`, `DagPredicateError`, `DagCyclicDependencyError`, `DagInvalidTaskNameError`, `DagDuplicateTaskError`, `DagInvalidDependencyError`; register them in the `ErrorObject` reconstruction registry so nested-DAG failures rebuild across the container boundary.
- `__init__.py` — re-export the public `dag.py` surface.

No changes to `operation/step.py`, `invoke.py`, `wait.py`, `wait_for_condition.py`, `child.py`, `concurrency/executor.py`, `concurrency/models.py`.

### 7.3 Container handler flow

The DAG container is orchestrated by a dedicated `DagContainerExecutor` (`operation/dag.py`), an `OperationExecutor[DagResult]` that mirrors `ChildOperationExecutor`'s START/SUCCEED/FAIL contract (so a nested DAG's error unwraps identically and replay of a FAILED container is unchanged) but replaces the generic size branch with the DAG **degradation ladder** and the generic `ReplayChildren` re-execute with the DAG **reconstruct** strategy (§8).

```python
def dag_handler(ctx, name, register, config):
    config = config or DagConfig()
    _check_max_concurrency(config)                       # <= 0 raises ValidationError

    with ctx._replay_aware():
        operation_id = ctx._create_step_id()             # top-level: real counter slot
        identifier = OperationIdentifier(
            operation_id=operation_id, sub_type=OperationSubType.DAG,
            parent_id=ctx._parent_id, name=name,
        )

        def run_body(reconstruct):
            child = ctx.create_child_context(operation_id=operation_id)
            return _run_dag_body(child, register, config, reconstruct)

        executor = DagContainerExecutor(
            run_body=run_body, state=ctx.state, operation_identifier=identifier,
        )
        try:
            return executor.process()
        except ChildContextError as e:
            unwrap_dag_error(e)                           # re-raises the typed Dag* cause
            raise                                        # pragma: no cover
```

`_run_dag_body` runs the registration phase (`register`), validates the graph (`validate_dag`, §9), then runs `DagExecutor`. A **nested** `dag` task uses `run_nested_dag`, which is identical except the container id is name-based (`ctx._create_task_id(name)`) with no `_replay_aware` wrapper (§6.2). The container subtype is `OperationSubType.DAG` in both cases, so a nested DAG checkpoints as `Dag`, not `RunInChildContext` (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.5).

`DagContainerExecutor.check_result_status` decides replay behavior from the checkpoint:

- **succeeded, `tasks` present (not offloaded):** deserialize the inline envelope and return; do not read children, do not re-run the body.
- **succeeded, offloaded (`ReplayChildren` set):** reconstruct from the retained child checkpoints plus the envelope (§8.2).
- **failed:** surface as `ChildContextError` (unwrapped to the typed `Dag*` error), identical on first run and replay.
- **not started:** write the fire-and-forget START checkpoint, then run the body.

**[PY NOTE — no `errorMapper` in Python `child_handler`.]** The JS design wires `errorMapper: (e) => e` so raw `Dag*Error`s escape unwrapped. Python has no such parameter, so a body exception surfaces **wrapped in `ChildContextError`** (with the original on `__cause__` on the first run, and `error_type` set to the original class name on both first run and replay). `unwrap_dag_error` restores the clean typed throw: it re-raises the typed `Dag*` cause (from `__cause__` on the first run, reconstructed from `error_type` on replay), preserving the inner error's own cause so a `DagPredicateError` still exposes the raising predicate's exception. This mirrors the existing `wait_for_callback` precedent (which unwraps `ChildContextError.__cause__` at its call site) and requires no change to `child.py`. Per `DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3, the typed identity and a message naming the offending task survive the boundary; the structured `task_name` field reconstructs as `None` on replay and the cause chain is baked into the message.

### 7.4 `DagContextImpl` registration & `TaskDef`

Each registration method: resolve+validate name (§9.1) → assert-not-duplicate (§9.2) → build `TaskDef` → store → return `TaskHandle`.

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

`.after(...)` appends to `all_deps` only; `deps=[...]` populates both. The scheduler builds `deps_map` from `inline_deps` (looking each name up in `_results`).

---

## 8. Serialization & large-payload replay

### 8.1 The converged DAG container envelope

`DagResultImpl.to_dict`/`from_dict` (`operation/dag_result.py`) serialize the single converged cross-language envelope normatively defined in `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4. One shape serves both the inline and offloaded cases; every field is always present (explicit `null`, never omitted) except `tasks`, whose absence is the offload signal.

```jsonc
{
  "type": "DagResult",
  "totalCount": <int>,
  "successCount": <int>,
  "failureCount": <int>,
  "skippedCount": <int>,
  "completionReason": "<DagCompletionReason>",
  "startedTaskNames": [<string>, ...],
  "failedTaskNames": [<string>, ...],
  "tasks": [ ... ] // OPTIONAL — absence IS the offload signal
}
```

Each task entry carries `name`, `status`, `skipReason`, `resultKind`, `result`, `error`, `startedAt`, `completedAt`:

- **`resultKind`** is a discriminator (`"plain"|"batch"|"dag"`) derived from the task's static `TaskDef.kind` (deterministic, no `isinstance` probing), so heterogeneous method-bearing results round-trip with their methods restored recursively — a `map`/`parallel` task's `BatchResult` (`"batch"`) and a nested `dag` task's `DagResult` (`"dag"`) rebuild via `BatchResult.from_dict` / `DagResultImpl.from_dict`. `resultKind` is `null` unless the task SUCCEEDED (a FAILED/SKIPPED task has no result to interpret).
- **`error`** serializes via canonical PascalCase keys (`ErrorType`, `ErrorMessage`, `StackTrace` always present, `null` when unset; extra platform fields like `ErrorData` preserved), scoped to the DAG envelope (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4 rule 5).
- **`startedAt`/`completedAt`** are UTC ISO-8601 with millisecond precision and a `Z` suffix; `None` stays `null`.

The aggregate counts and `completionReason` are always serialized even though they are derivable from `tasks`, so the offloaded payload keeps the same shape after `tasks` is dropped. `from_dict` honors the stored counts when present (an offloaded, tasks-less envelope still carries them) and derives from the map otherwise. `DagResultSerDes` (returned by `create_dag_result_serdes()`) wraps `to_dict`/`from_dict` for the inline case.

### 8.2 Large-payload replay — degradation ladder + reconstruct

When the serialized envelope exceeds `CHECKPOINT_SIZE_LIMIT_BYTES`, `DagContainerExecutor._checkpoint_with_ladder` degrades the payload in a fixed contract order (`DAG_SPEC_CROSS_LANGUAGE.md` §2.A.4 rule 3):

1. **Full envelope with `tasks`** — checkpoint, `ReplayChildren` unset.
2. **Too large:** drop `tasks`, set `ReplayChildren` so the backend retains the child operations that hold the per-task results.
3. **Still too large:** drop `failedTaskNames`.

The four counts, `completionReason` and `startedTaskNames` are **never** dropped, so a DAG can never fail to checkpoint because its own summary did not fit. `startedTaskNames` is bounded by `max_concurrency`.

On replay of an **offloaded** container (`is_succeeded()` and `is_replay_children()`), `DagContainerExecutor.execute` takes the **reconstruct** path rather than a blind re-execute (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.6):

- It reads the retained envelope into a `_ReconstructInfo` (`started_task_names`, `completion_reason`, `total_count`) and re-runs `_run_dag_body` with that info.
- `DagExecutor.run(reconstruct_started=…, reconstruct_reason=…, reconstruct_total=…)` re-runs the deterministic register graph exactly as a first run would — rebuilding registration, recomputing skip/trigger decisions — but **every completed task fast-paths from its own retained child checkpoint (§4.4), so task bodies never re-execute**. It reads each task's result from that checkpoint and rebuilds the per-task detail.
- A task named in `started_task_names` is **seeded `STARTED` and never scheduled**, so an in-flight task recorded in the offloaded envelope is reproduced as `STARTED` rather than restarted. The completion reason and total are taken from the envelope, not re-derived (a re-derivation over fast-pathed results could disagree at an early-completion boundary).
- The reconstruct path does **not** re-checkpoint the container: it is already SUCCEEDED with the offloaded envelope.

If a **nested** `dag` task's own container also offloaded, its result is read back from that inner container's tasks-less envelope; the reader preserves the inner envelope's counts and `completionReason` and recurses into the inner container's child checkpoints for per-task detail (`DAG_SPEC_CROSS_LANGUAGE.md` §2.B.6 rule 3). A missing or malformed envelope degrades to deriving from the per-task checkpoints with an empty STARTED set; `_deserialize_inline` treats an empty payload as an empty DAG (`ALL_COMPLETED`).

Because `startedTaskNames` always rides in the envelope and never drops, the STARTED set is faithful across a large-payload early-completion replay — the reconstruct path reproduces the in-flight snapshot exactly instead of restarting those tasks.

---

## 9. Validation

`validate_dag` (`operation/dag_validator.py`) runs once, after `register`, before the scheduler (inside the container body):

- **`DagInvalidTaskNameError`:** non-empty, ≤100 chars, `^[a-zA-Z0-9_]+$` (no `-`), no `DAG_NODE_T_` substring. Also raised when no name can be resolved for a task (§2.2).
- **`DagDuplicateTaskError`:** duplicate name in the scope's task map.
- **`DagInvalidDependencyError`:** a dep handle not registered in this DAG scope (enforces scope isolation — a handle from a parent/other DAG fails).
- **`DagCyclicDependencyError`:** Kahn's algorithm over `all_deps`, O(V+E), listing the cyclic task names.

Validation errors are registration-time and deterministic (§10), so they reproduce identically on replay. They are raised inside the container body and unwrapped from `ChildContextError` at the container boundary (§7.3).

---

## 10. Scoping & determinism

- **Name uniqueness** is scoped to the immediate `DagContext`; nested DAGs open a fresh scope; a dep handle must belong to the same scope (§9).
- **`register` must be deterministic** on replay (same names, deps, trigger rules, `run_if`). It is synchronous in Python (no `async`), which reduces the non-determinism surface (no awaited IO in registration). Non-deterministic registration produces a different graph on replay and surfaces as operation-consistency failures on task IDs.

---

## 11. Scope notes (v1)

1. **Result-based custom completion.** Python's `CompletionConfig` is threshold-only; there is no `shouldComplete`/`CompletionDecision` predicate in the Python SDK, so `DagConfig` reuses the threshold config and exposes no custom-completion hook. Result-based short-circuit is expressible via a task inspecting its deps and raising, or via `min_successful`. Cross-language disposition: `DAG_SPEC_CROSS_LANGUAGE.md` §3.1 row 15.
2. **Async registration.** Not applicable — the SDK has no asyncio surface. `register` is synchronous.
3. **Error fidelity across the container boundary.** The typed identity and a task-naming message survive; the structured `task_name` field reconstructs as `None` on replay and the cause chain is folded into the message (§7.3, `DAG_SPEC_CROSS_LANGUAGE.md` §2.B.3). This is the same erasure the whole `Dag*Error` family already has, not specific to the predicate error.

---

## 12. Testing outline

Follows the repo's `conformance-tests/handlers/<op>/` + pytest pattern (mirrors `map/`, `parallel/`, `child/` suites).

- **`test_dag_validator.py`:** cycle detection (self-loop, 2-cycle, deep, diamond=no-cycle); invalid names (empty, >100, dash, `DAG_NODE_T_` substring, unresolvable); duplicates across op kinds; missing/foreign-scope deps.
- **`test_trigger_rules.py`:** full truth table × {all-succ, all-fail, mixed, includes-skip, empty}.
- **`test_task_handle.py`:** `.after()`/`.trigger_rule()` chaining mutates `TaskDef`; `deps[handle]` vs `deps["name"]` access, including `T | None` for a non-succeeded upstream.
- **`test_dag_executor.py`:** readiness/topological order; `max_concurrency` throttling and the default-40 bound; skip propagation; `run_if` skip; `run_if`-raise ⇒ `DagPredicateError` abort (task left with no terminal state); threshold `completion_config` (`min_successful`, tolerated count/percentage, impossible-to-succeed early stop); drain-vs-fail-fast (default drains); timed-suspend in-process resume vs. indefinite-suspend bubble; `_resolve_suspend` earliest-timed precedence.
- **`test_dag_result.py`:** `get_result`/`get_status` for succeeded/failed/skipped/not-run; `throw_if_error`; converged-envelope `to_dict`/`from_dict` round-trip incl. `resultKind` recursion (batch/dag), canonical error keys, ISO-millis timestamps, and tasks-less (offloaded) restore preserving counts/`completionReason`.
- **Entity-ID tests:** `_create_task_id` for prefixed/unprefixed; nested recursion where a nested DAG's sub-task is prefixed by the nested container's **hashed** id (assert `id(rule_a) == blake2b(f"{Hval}-DAG_NODE_T_rule_a")` with `Hval = blake2b(f"{Hcontainer}-DAG_NODE_T_validation")` — no `…-DAG_NODE_T_validation-DAG_NODE_T_rule_a` pre-image ever exists); no collision with counter IDs (`{Hc}-{int}` vs `{Hc}-DAG_NODE_T_{name}`).
- **Conformance handlers** (deployed-runner + local): diamond `A→{B,C}→D` (assert B,C concurrent via invocation counts); mixed op-type tasks (each appears as its native subtype under a `DAG_NODE_T_`-derived id); nested DAG checkpoints as `Dag`; callback task materializes as a `Callback` container over the native `WaitForCallback`; compensation (charge fails ⇒ refund `ALL_FAILED` runs, fulfill `ALL_SUCCESS` skips, audit `ALL_DONE` runs); `run_if` branching; nested DAG scope isolation.
- **Replay/interruption:** interrupt after a subset checkpoint; resume; assert completed tasks hit fast paths (count side effects) and remaining run once; `run_if`-skip stays skipped across replay without a checkpoint; **large-payload** forces the degradation ladder and asserts the container reconstructs to an equal `DagResult`, that task bodies do not re-execute, and that a task recorded `STARTED` in the offloaded envelope is reproduced as `STARTED` (never restarted).

---

## Appendix A. JS-decision → Python mapping

Legend: **Ports** = carries over essentially unchanged · **Adapts** = same observable contract, different language mechanism.

| #   | JS design decision                                             | Python disposition  | How / why                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Type-level `DepsMap` / literal-string name capture             | **Adapts**          | No Python type machinery for value-captured keys. Runtime name-keyed `Mapping` (`deps["name"] -> Any`) + handle-keyed overload `deps[handle] -> T \| None` for static typing. §2.3                          |
| b   | `TaskHandle` as reference + builder                            | **Ports**           | `@dataclass(eq=False)`, hashable by name; `.after()`/`.trigger_rule()` chaining. §2.4                                                                                                                       |
| c   | Name-based entity IDs + reserved `DAG_NODE_T_` + no-dash names | **Adapts**          | Same wire shape (one `DAG_NODE_T_` token per level) with per-level blake2b re-hashing (prefix = already-hashed container id). Injectivity rests on per-level charset injectivity + collision-resistance. §4 |
| d   | Trigger rules + `run_if` (sync predicate)                      | **Ports verbatim**  | Full truth table + evaluators; Python is sync everywhere. `run_if`-raise ⇒ `DagPredicateError`. §2.5, §5                                                                                                    |
| e   | Completion-reason core/superset                                | **Adapts**          | Python base enum has 3 members (no `CUSTOM_*`); DAG declares its own 4-member enum (adds `COMPLETED_WITH_FAILURES`), value-compatible with the base. §2.7                                                   |
| f   | SDK-owned converged envelope + reconstruct-don't-re-execute    | **Ports**           | `DagResultImpl.to_dict`/`from_dict` write the converged envelope; `DagContainerExecutor` runs the degradation ladder and the reconstruct path, which fast-paths every task and seeds the STARTED set. §8    |
| g   | Custom result-based completion                                 | **Adapts**          | Python `CompletionConfig` is threshold-only; the DAG reuses it and exposes no custom-completion predicate. §2.8, §11.1                                                                                      |
| h   | Heterogeneous task types + nested DAGs                         | **Ports**           | Reuse existing per-op executors + `child_handler`; `resultKind` tagging for batch/dag results; nested container checkpoints as `Dag`. §6.3, §8.1                                                            |
| —   | Return type `DurablePromise<DagResult>`                        | **Adapts**          | Python returns `DagResult` synchronously (blocking); no `DurablePromise`/`await`. §2.1                                                                                                                      |
| —   | Family A/B handler split (`createStepId` vs `waitForCallback`) | **Ports (simpler)** | Python executors take a full `OperationIdentifier`; callbacks are already child-context-based. No split needed. §6.3                                                                                        |
| —   | `withDurableModeManagement` bypass                             | **Ports**           | Bypass the counter-coupled `_replay_aware`; rely on explicit-ID checkpoint fast paths — the same mechanism `map`/`parallel` already use. §6.2                                                               |
| —   | `errorMapper: (e)=>e` pass-through                             | **Adapts**          | No `error_mapper` in Python `child_handler`; `unwrap_dag_error` re-raises the typed `Dag*` cause at the container boundary (the `wait_for_callback` precedent). §7.3                                        |
