# DAG Implementation Task Breakdown — Java (`aws-durable-execution-sdk-java`)

> **Source spec:** [`DAG_SPEC_JAVA.md`](./DAG_SPEC_JAVA.md) (canonical semantics: [`DAG_SPEC.md`](./DAG_SPEC.md); cross-language: [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md))
> **Target repo:** `/Users/parpooya/workplace/aws-durable-execution-sdk-java`, module `sdk/src/main/java/software/amazon/lambda/durable/**`
> **Stability:** ⚠️ **EXPERIMENTAL** in v1 — every public DAG type/method MUST carry the new `@Experimental` marker annotation + Javadoc `@apiNote`.
> **Ordering:** Tasks are strictly ordered. **Task 1 is a GATING base-SDK prerequisite ([A-J2]); nothing else may start until it lands.**
> **v2-deferred:** Custom-predicate completion (§6 Option A / `CustomDagCompletion`) is **NOT in v1** ([A-J6] verified — no SDK seam). v1 ships threshold completion only; the `CUSTOM_COMPLETION_*` reasons are **not present** in `DagCompletionReason` (dropped per API-review C4(b) — they are added when custom completion ships). NOTE: Go, which implements custom completion, does keep those members.

---

## Task 1 — 🚪 GATING PREREQUISITE: name-based operation-ID seam ([A-J2])

- **Title:** Add explicit-ID minting + internal `*AsyncWithId` entry points (base-SDK, pure addition)
- **Spec:** §4.3
- **Files (2, no more):**
  - `execution/OperationIdGenerator.java` — add `public String operationIdForName(String name)` returning `hashOperationId(operationIdPrefix + name)` (reuse existing `operationIdPrefix == contextId + "-"` + SHA-256; `AtomicInteger operationCounter` untouched).
  - `context/DurableContextImpl.java` — add internal explicit-ID variants (`stepAsyncWithId`, `invokeAsyncWithId`, `runInChildContextAsyncWithId`, `mapAsyncWithId`, `parallelWithId`, `callbackWithId`, `waitForConditionAsyncWithId`, `waitAsyncWithId`) that accept a precomputed `operationId` instead of calling private `nextOperationId()` (`:335`). Prefer extracting a private per-op helper called by both the public method (`nextOperationId()`) and the DAG path (name-derived id). Internal SPI only — **NOT** added to the public `DurableContext` interface.
- **Dependencies:** none (blocks everything else)
- **Acceptance criteria:**
  1. `operationIdForName("DAG_NODE_T_x")` is deterministic and equal across calls; distinct names → distinct hashed IDs; **zero** diff to `BaseDurableOperation`, `ExecutionManager`, `OperationIdentifier`, any `*Operation` subclass, `validateReplay`, or serde.
  2. An op launched via a `*AsyncWithId` variant checkpoints/replays under the supplied ID (fast-path returns checkpointed result on replay) and passes `validateReplay` (type/name/subType compared, ID format not inspected).
  3. `mvn verify` green; new methods have unit coverage proving id equality + counter non-interference. (No `@Experimental` yet — this is base-SDK internal.)

---

## Task 2 — `@Experimental` marker annotation

- **Title:** Introduce `@Experimental` annotation (new, SDK-wide primitive)
- **Spec:** §0 (EXPERIMENTAL banner), §2 preamble
- **Files:** `annotations/Experimental.java` (new package `software.amazon.lambda.durable.annotations`; `@Retention(CLASS)`, `@Documented`, targets TYPE + METHOD).
- **Dependencies:** none (can land in parallel with Task 1, but must precede all public DAG types)
- **Acceptance criteria:**
  1. `@Experimental` compiles, is `@Documented`, `@Retention(CLASS)`, applicable to types and methods.
  2. Javadoc on the annotation states the API may change/be removed without a major-version bump.

---

## Task 3 — Public enums & exception hierarchy

- **Title:** DAG public enums + `Dag*Exception` hierarchy
- **Spec:** §2.8 (enums), §2.10 (`DagCompletionReason`), §7 (exceptions)
- **Files (new pkg `software.amazon.lambda.durable.dag`):** `TriggerRule.java`, `TaskStatus.java`, `SkipReason.java`, `DagCompletionReason.java`, `DagTaskError.java` (record, `MapError`-shaped); exceptions extending `DurableOperationException`: `DagException`, `DagCyclicDependencyException`, `DagInvalidTaskNameException`, `DagDuplicateTaskException`, `DagInvalidDependencyException`, `DagExecutionException`.
- **Dependencies:** Task 2
- **Acceptance criteria:**
  1. `DagCompletionReason` has 4 members (`ALL_COMPLETED`, `COMPLETED_WITH_FAILURES`, `MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED`) — no `CUSTOM_COMPLETION_*` in v1 (API-review C4(b)); `TriggerRule` has the six rules (`ALL_SUCCESS`, `ANY_SUCCESS`, `ALL_FAILED`, `ANY_FAILED`, `ALL_DONE`, `NONE_FAILED`) as a pure value enum, with evaluation in an internal evaluator (not a public `eval()` method, per API-review C5).
  2. All public types annotated `@Experimental` with `@apiNote`; all `Dag*Exception` extend `DurableOperationException` (→ `DurableExecutionException`, `RuntimeException`).
  3. `DagTaskError` mirrors `MapError` (`errorType`/`errorMessage`/`stackTrace` + optional cause) and is Jackson-serializable.

---

## Task 4 — `DagContext`, `TaskHandle<T>`, `Deps`, functional interfaces, `DagConfig`

- **Title:** DAG public registration surface + typed-dependency accessor
- **Spec:** §2.2–§2.5, §2.7 (sugar), §2.11 (`DagConfig`), §2.12/§3 (`.reads`/`.after`)
- **Files:** `DagContext.java`, `TaskHandle.java`, `Deps.java`, `DagConfig.java` (record + `builder()`), `DagCompletionConfig.java` (sealed; **threshold factories only** in v1), functional interfaces `DagStepFunction/DagPayloadFunction/DagCallbackSubmitter/DagConditionFunction/DagChildFunction.java`. Optional §2.7 arity sugar may be a follow-up PR.
- **Dependencies:** Task 3
- **Acceptance criteria:**
  1. `<T> Optional<T> Deps.get(TaskHandle<T> h)` compiles type-safely (one contained unchecked cast internally, keyed by `handle.name()`); returns `Optional.empty()` for a non-SUCCEEDED upstream under a non-ALL_SUCCESS trigger rule, present on the default ALL_SUCCESS path; every DAG task fn takes `Deps` as first param (uniform, incl. roots).
  2. `TaskHandle<T>` exposes fluent `reads(...)` (typed/inline), `after(...)` (ordering-only), `triggerRule(...)`, `runIf(Predicate<Deps>)`; reuses existing `StepConfig`/`MapConfig`/`ParallelConfig`/`InvokeConfig`/`WaitForConditionConfig`/`TypeToken`/`Duration`/`MapResult`/`ParallelResult` verbatim.
  3. All types/methods annotated `@Experimental`; `DagConfig.builder()` present; `maxConcurrency` documented ≥ 1; `summaryGenerator` **omitted** (non-native, §8.1); `DagCompletionConfig` exposes only the 6 threshold factories (custom path v2-deferred).

---

## Task 5 — Registration validator (`DagValidator`)

- **Title:** Registration-time graph validation
- **Spec:** §3 (`TaskDef`), §4.2 (charset/reserved-delimiter), §7 (validation), §5 readiness precheck
- **Files:** `dag/internal/TaskDef.java` (record: name, `TaskKind`, `inlineDeps`, `allDeps`, triggerRule, runIf, options, executor), `dag/internal/DagValidator.java`.
- **Dependencies:** Task 4
- **Acceptance criteria:**
  1. Enforces name `^[a-zA-Z0-9_]+$`, ≤100 chars, no `DAG_NODE_T_` substring (stricter than base `ParameterValidator`) → `DagInvalidTaskNameException`; duplicate names → `DagDuplicateTaskException`; foreign/unregistered dep handle → `DagInvalidDependencyException`.
  2. Cycle detection via Kahn's algorithm over `allDeps` (`O(V+E)`) → `DagCyclicDependencyException`; diamond is NOT a cycle; validation runs once after `register` returns, before any task launches.
  3. `maxConcurrency < 1` → `IllegalArgumentException`; all validation throws surface at the `dag(...)` call site (before scheduler start).

---

## Task 6 — Scheduler / executor (`DagExecutor`, thread-backed via `DurableFuture`)

- **Title:** Topological scheduler over `DurableFuture` with explicit-ID launch
- **Spec:** §5 (readiness/trigger/runIf/skip/failure-drain/empty), §5.1 (zero-cost skips), §9 (concurrency)
- **Files:** `dag/internal/DagExecutor.java` (+ `TaskExecutor<T>` closure interface, `dag/internal/DagScheduler` helpers if split).
- **Dependencies:** Task 1 (uses `*AsyncWithId` + `operationIdForName`), Task 5
- **Acceptance criteria:**
  1. Launches each ready task through the matching `*AsyncWithId` variant under `idOf(name) = operationIdForName("DAG_NODE_T_"+name)`; enforces `maxConcurrency` by **deferring the `*Async` call** (no scheduler-owned threads/`ExecutorService`); awaits via `DurableFuture.get()`/`allOf`/`anyOf`.
  2. Trigger-rule truth table (§5.3, incl. empty-upstream vacuous rules) + `runIf` skip (`RUN_IF_PREDICATE`) evaluated correctly; skips are terminal, cascade downstream, and checkpoint nothing.
  3. Failure is a terminal task state, not an abort: default drains reachable graph (compensation `ALL_FAILED`/`ALL_DONE` run); `dag()` does not throw; `completionReason` = `ALL_COMPLETED` or `COMPLETED_WITH_FAILURES`; empty DAG resolves immediately (`totalCount=0`, `ALL_COMPLETED`).

---

## Task 7 — `DagResult` + serialization & re-execute reconstruction (NO envelope)

- **Title:** `DagResult`/`TaskExecution`, `resultKind`-tagged serde, native large-result path
- **Spec:** §2.9 (`DagResult`/`TaskExecution`), §8 (serialization), §8.1 (re-execute; **no `DagSummary`**)
- **Files:** `DagResult.java` (interface), `dag/internal/DagResultImpl.java`, `TaskExecution.java` (record), serde records `SerializedTaskExecution`/`SerializedDagResult` + `SerializedResultKind` enum.
- **Dependencies:** Task 6
- **Acceptance criteria:**
  1. Typed `getResult(TaskHandle<T>)→Optional<T>` + untyped `getResult(String)`; `throwIfError()` throws `DagExecutionException` iff `failureCount>0` (keys off count, not reason); `Optional` distinguishes SKIPPED/never-started from `null` success.
  2. Serde round-trips heterogeneous results via `resultKind` (`MAP`/`PARALLEL`→MAP, nested `DAG`→DAG, else PLAIN); `MapResult`/`DagResult` recursively rehydrate to fully-methoded instances; errors serialize `MapError`-style.
  3. Large aggregate (≥256KB) uses the **native child-context re-execution** path (`replayChildren`): re-running the scheduler hits every task's per-task checkpoint fast-path (no task-body re-execution) and rebuilds an identical `DagResult`; **no summary envelope / `summaryGenerator` exists**. Public types `@Experimental`.

---

## Task 8 — Wire `dag()` / `dagAsync()` into `DurableContext`

- **Title:** Public entry points on the context
- **Spec:** §2.1, §12 (backward compat)
- **Files:** `DurableContext.java` (add 4 signatures), `context/DurableContextImpl.java` (implement; run DAG as one `runInChildContext` node whose body = validate → schedule → aggregate).
- **Dependencies:** Task 7
- **Acceptance criteria:**
  1. `dag(name, register[, config])→DagResult` and `dagAsync(...)→DurableFuture<DagResult>` added, mirroring `map`/`mapAsync` sync/async convention; all 4 annotated `@Experimental` with `@apiNote`.
  2. DAG runs as a single child-context node; nested `dag` recurses under `DAG_NODE_T_{name}` with its own `maxConcurrency` scope.
  3. Pure addition — no changes to existing `DurableContext` types/behavior; existing apps compile unchanged; `mvn verify` green.

---

## Task 9 — Unit tests

- **Title:** JUnit 5 unit suite
- **Spec:** §11 (`DagValidatorTest`, `TriggerRuleTest`, `TaskHandleTest`, `DagExecutorTest`, `DagResultTest`, entity-ID tests)
- **Files:** `sdk/src/test/java/software/amazon/lambda/durable/dag/*Test.java`.
- **Dependencies:** Task 8
- **Acceptance criteria:**
  1. Validator (cycles: self/2-cycle/deep/diamond-ok; bad names; duplicates; foreign deps), full parameterized trigger-rule truth table, `TaskHandle` mutation + `Deps.get` typed `Optional<T>` return (empty for non-SUCCEEDED upstream) + undeclared-handle `IllegalStateException`.
  2. `DagExecutor` (readiness/topo order, `maxConcurrency` throttle, skip propagation, `runIf` skip, threshold completion, drain-with-compensation); `DagResult` typed accessors + `throwIfError` + serde round-trip incl. error reconstruction and recursive `MapResult`/`DagResult` restore.
  3. Entity-ID tests: `DAG_NODE_T_{name}` prefixed/unprefixed + nested recursion + no collision with counter IDs; suite green under `mvn verify`.

---

## Task 10 — Integration + replay tests

- **Title:** Local-runner integration & replay determinism
- **Spec:** §11 (local-runner integration + replay bullets)
- **Files:** `sdk-integration-tests/src/test/java/.../dag/*IT.java` (+ `sdk-testing` local runner usage).
- **Dependencies:** Task 9
- **Acceptance criteria:**
  1. Diamond `A→{B,C}→D` (B,C concurrent via `DurableFuture`); mixed op-type tasks each appear as their native subtype under a `DAG_NODE_T_`-derived id; compensation + `runIf` branching + nested-DAG scope isolation.
  2. **Order-independence:** force B-before-C then C-before-B → identical `DagResult`, no `NonDeterministicExecutionException` (proves name-based IDs); interruption/resume replays completed tasks via fast-path (side-effect count unchanged).
  3. **Large-`DagResult`:** force aggregate ≥256KB → DAG child body re-executes on replay, every task hits per-task checkpoint fast-path (no task-body re-exec), reconstructs identical `DagResult` (no envelope).

---

## Task 11 — Docs

- **Title:** DAG reference docs + experimental notice
- **Spec:** §0 banner, §1–§10 surface
- **Files:** `docs/core/dag.md` (new), cross-links from `docs/design.md` / README; example under `examples/`.
- **Dependencies:** Task 8 (docs can draft earlier; finalize after API frozen)
- **Acceptance criteria:**
  1. Documents `dag()`/`dagAsync()`, `.reads`/`.after`, `Deps.get`, trigger rules, threshold completion, and the EXPERIMENTAL/`@Experimental` status prominently.
  2. States v2-deferred custom completion and the no-`summaryGenerator` decision (§8.1); examples compile against the shipped API.

---

**Task count: 11.** ⚠️ **Task 1 is the gating base-SDK prerequisite ([A-J2]) — it must land first; no other task may begin until the `operationIdForName` + `*AsyncWithId` seam is merged.** Custom-predicate completion is **v2-deferred** (§6 Option A / [A-J6]).
