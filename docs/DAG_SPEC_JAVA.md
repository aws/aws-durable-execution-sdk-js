# DAG Support (`context.dag()`) — Java Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable.
>
> **Required API annotation (Java).** The SDK has no existing preview/experimental annotation, so introduce a marker annotation (e.g. `software.amazon.lambda.durable.annotations.Experimental`, `@Retention(CLASS)`, `@Documented`) and apply it to every public DAG type/method, plus a Javadoc `@apiNote`:
>
> ```java
> /**
>  * Declares and runs a DAG of tasks. ...
>  *
>  * @apiNote <b>Experimental.</b> This API is experimental and may be changed
>  *          or removed in future releases.
>  */
> @Experimental
> DagResult dag(String name, Consumer<DagContext> register, DagConfig config);
> ```

Status: Draft (design proposal) · **Stability: Experimental** · Target: `aws-durable-execution-sdk-java` (`software.amazon.lambda.durable`) · Canonical source: [`DAG_SPEC.md`](./DAG_SPEC.md) (JS/TS)

> This document adapts the **canonical JS/TS DAG design** ([`DAG_SPEC.md`](./DAG_SPEC.md)) to the AWS Lambda Durable Execution **Java** SDK. The JS spec is the source of truth for _semantics_; this spec proposes an _idiomatic Java surface_ that preserves the normative core (name-based entity IDs, reserved delimiter, trigger rules, `runIf`, replay-safe reconstruction) while diverging where Java's type system, concurrency model, and large-result handling demand it (notably: no JS-style summary envelope — see §8.1).
>
> See [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md) for the shared normative core vs. per-language divergence matrix.

---

## 0. SDK existence & grounding

**The Java SDK exists and is GA** (AWS Lambda Durable Execution SDK for Java, GA April 2026 — [whats-new](https://aws.amazon.com/about-aws/whats-new/2026/04/lambda-durable-execution-java-ga/), repo [`aws/aws-durable-execution-sdk-java`](https://github.com/aws/aws-durable-execution-sdk-java)). This spec is therefore grounded in the **real, shipped Java API surface**, not a hypothetical one. Confirmed primitives (from the repo README, the AWS docs, and the `docs/core/*.md` reference pages):

| Concern                | Java surface (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler                | `abstract class DurableHandler<I, O>` → `O handleRequest(I input, DurableContext ctx)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Package                | `software.amazon.lambda.durable`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Step (sync)            | `<T> T step(String name, Class<T> type, StepFunction<T> fn[, StepConfig])`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Step (generic type)    | `<T> T step(String name, TypeToken<T> type, StepFunction<T> fn[, StepConfig])`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Step (async)           | `<T> DurableFuture<T> stepAsync(String name, Class<T>\|TypeToken<T> type, StepFunction<T> fn[, StepConfig])`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Wait                   | `void wait(String name, Duration duration)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Invoke                 | `<T> T invoke(String name, String functionName, Object payload, Class<T> type[, InvokeConfig])`; `invokeAsync(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Callback               | `<T> DurableCallbackFuture<T> createCallback(String name, Class<T> type[, CallbackConfig])`; `<T> T waitForCallback(String name, Class<T> type, BiConsumer<String,StepContext> fn[, WaitForCallbackConfig])` (submitter is `BiConsumer<callbackId, StepContext>` — **verified** `docs/design.md`)                                                                                                                                                                                                                                                                                                                                                                                       |
| Child context          | `<T> T runInChildContext(String name, ChildFunction<T> fn[, ...])`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Map                    | `<I,O> MapResult<O> map(String name, Collection<I> items, Class<O>\|TypeToken<O> type, MapFunction<I,O> fn[, MapConfig])`; `mapAsync(...)` → `DurableFuture<MapResult<O>>`. `MapFunction<I,O>` = `O apply(I item, int index, DurableContext ctx)` (item-first). Input must have **deterministic iteration order** (`List`/`LinkedList`/`TreeSet` OK; `HashSet` → `IllegalArgumentException`).                                                                                                                                                                                                                                                                                           |
| Parallel               | `ParallelDurableFuture parallel(String name[, ParallelConfig])`; `.branch(String name, Class<T> type, BranchFunction<T> fn[, ParallelBranchConfig])` → `DurableFuture<T>`; `.get()` → `ParallelResult` (**verified** `docs/core/parallel.md`; branch fn is `Function<DurableContext,T>`)                                                                                                                                                                                                                                                                                                                                                                                                |
| Wait-for-condition     | `<T> T waitForCondition(String name, Class<T>\|TypeToken<T> type, BiFunction<T,StepContext,WaitForConditionResult<T>> check[, WaitForConditionConfig<T>])` (**verified** `docs/design.md`: check is `BiFunction<state,StepContext>`; there is **no** `WaitForConditionContext` type)                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Concurrency model**  | **`DurableFuture<T>`** — a durable, replay-safe future returned by every `*Async`/branch call; `.get()` blocks (and may suspend the execution). Statics `DurableFuture.allOf(...)`/`anyOf(...)` aggregate. **It is _not_ thread-free**: internally each `*Async` op runs on the **user executor** (`CompletableFuture.runAsync(fn, userExecutor)`; default cached daemon pool, configurable via `DurableConfig.withExecutorService`), and suspension is driven by an active-thread-count race in `ExecutionManager` (verified in `docs/design.md`). `DurableFuture` is the durable/replay-safe _wrapper_ over that threaded substrate — the correct fan-out primitive for the DAG (§9). |
| Result typing          | `Class<T>` (simple) and `TypeToken<T>` (parameterized, `new TypeToken<List<X>>(){}`) — reified type tokens, the Java answer to type erasure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Config                 | Builders: `StepConfig.builder()`, `MapConfig.builder()`, `ParallelConfig.builder()`, `InvokeConfig.builder()`, `CallbackConfig.builder()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Retry                  | `RetryStrategies.exponentialBackoff(maxAttempts, initial, max, mult, JitterStrategy.FULL)`, `RetryStrategies.Presets.NO_RETRY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Completion             | `CompletionConfig.allCompleted()/allSuccessful()/firstSuccessful()/minSuccessful(n)/toleratedFailureCount(n)/toleratedFailurePercentage(p)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Completion status enum | `ConcurrencyCompletionStatus { ALL_COMPLETED, MIN_SUCCESSFUL_REACHED, FAILURE_TOLERANCE_EXCEEDED }` — **only 3 members; no `CUSTOM_COMPLETION_*`** (a hard divergence, §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Batch result           | `MapResult<O>` / `MapResultItem<O>` / `MapError` (record: `errorType`, `errorMessage`, `stackTrace`); item status `SUCCEEDED\|FAILED\|SKIPPED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Exceptions             | Rich hierarchy rooted at `DurableExecutionException` (RuntimeException); see §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Runtime                | Java 17+ (Corretto 21 in examples) → **records and sealed interfaces are available**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**`context.dag()` does NOT exist in the Java SDK today** (no `dag` in the operations list, README, or docs reference as of authoring). This spec proposes it as a **pure addition**, exactly as the JS spec proposes it for JS.

> **✅ VERIFICATION STATUS — NOW GROUNDED IN PRIVATE SOURCE (flagged prominently).** These were originally carried from the JS design, then checked against the Java SDK's public docs, and have **now been verified line-by-line against the real private source** at `aws-durable-execution-sdk-java/sdk/src/main/java/software/amazon/lambda/durable/**` (224 `.java` files). **All six are resolved.** The single load-bearing blocker **[A-J2] is resolved as `CAN-BE-ADDED`** (a trivial, surgical seam — the caller-supplied-ID path is already threaded through the entire operation/execution stack; only _name-based minting_ is missing). File:line citations below and in §4.3 / Appendix A.
>
> - **[A-J1] — ✅ SOURCE-VERIFIED.** `OperationIdGenerator` (`execution/OperationIdGenerator.java:12-13,44-47`) owns an `AtomicInteger operationCounter` and an `operationIdPrefix = contextId + "-"`; `nextOperationId()` returns `hashOperationId(operationIdPrefix + counter)` (SHA-256, `:20-35`). `DurableContextImpl` holds one `OperationIdGenerator` per context (`context/DurableContextImpl.java:59,66`), seeded with the child's `contextId`. So IDs are per-context monotonic counters, hashed + context-path-prefixed (`hash("execId-1")` at root, `hash("<parentHash>-2")` nested). Counter-based IDs are real ⇒ the name-based-ID motivation (§4) holds.
> - **[A-J2] — ✅ RESOLVED · VERDICT: `CAN-BE-ADDED` (minimal, surgical).** The caller-supplied-ID seam is **already present through the whole stack below `DurableContextImpl`**: `OperationIdentifier.operationId` is an **opaque String** (`model/OperationIdentifier.java:16-24`); every `*Operation` constructor accepts an arbitrary `OperationIdentifier` and uses `getOperationId()` verbatim as the checkpoint/replay key (`operation/BaseDurableOperation.java:56-92,155` → `executionManager.getOperationAndUpdateReplayState(getOperationId())`); `ExecutionManager` keys `operationStorage`/`registeredOperations` purely by that string (`execution/ExecutionManager.java:98-101,207-217`); child contexts already **run under a supplied ID** (`operation/ChildContextOperation.java:118-135` → `contextId = getOperationId(); createChildContext(contextId, getName())`); and `validateReplay` compares **type/name/subType only — never ID format** (`operation/BaseDurableOperation.java:298-330`). The counter is coupled to operations at **exactly one line per method** in `DurableContextImpl` (`var operationId = nextOperationId();`, e.g. `:138,150,171,195,231,283,301` → private `nextOperationId()` `:335`). **Precedent that operations already run under an explicitly-supplied, non-top-level prefix:** `ConcurrencyOperation` constructs `new OperationIdGenerator(getOperationId())` and `durableContext.createChildContext(getOperationId(), getName())` (`operation/ConcurrencyOperation.java:73-86`) and `createItem(...)` takes an explicit `operationId` param (`:96-118`) — proving the machinery runs ops under a caller-controlled prefix; it simply mints per-item IDs by _counter_ (`operationIdGenerator.nextOperationId()`, `:137`), deterministic by **order**, not by **name**. ⇒ The only missing piece is a name→id minting function + internal entry points that use it. Minimal change specified in §4.3 and Appendix A (one new method on `OperationIdGenerator`; explicit-ID internal variants on `DurableContextImpl`; **zero** changes to `BaseDurableOperation`/`ExecutionManager`/`OperationIdentifier`/replay validation/serde).
> - **[A-J3] — ✅ SOURCE-VERIFIED (FALSIFIED · §8.1 rewritten).** `ChildContextOperation` (`operation/ChildContextOperation.java:39,88-107,150-176`) implements the large-result path: `LARGE_RESULT_THRESHOLD = 256*1024`; large success checkpoints an **empty payload + `ContextOptions.replayChildren(true)`**, and on replay of a `SUCCEEDED` child with `replayChildren==true` it **re-executes the child body** (`:90-98`). `map` reconstructs from per-item child checkpoints. `RunInChildContextConfig` (`config/RunInChildContextConfig.java`) exposes **only `serDes`** — **no customer summary-generator hook** and no `*Summary` envelope anywhere. The JS `DagSummary`/`summaryGenerator` design does **not** map to Java; §8.1 and §10-row-f are corrected accordingly.
> - **[A-J4] — ✅ SOURCE-VERIFIED (REFINED).** Replay mode is **execution-global**: `ExecutionMode {REPLAY, EXECUTION}` (`execution/ExecutionMode.java`), one-way REPLAY→EXECUTION transition in `ExecutionManager.getOperationAndUpdateReplayState` (`execution/ExecutionManager.java:207-217`). Note: `BaseContextImpl` _also_ tracks a **per-context** `isReplaying` flag (`context/BaseContextImpl.java:41,~140`, seeded from `hasOperationsForContext`) flipped one-way via `setExecutionMode()`. Both are one-way and monotone; neither blocks the design; only the reconstruction-path detail in §8.1 changes.
> - **[A-J5] — ✅ SOURCE-VERIFIED (CORRECTED).** `DurableFuture` is **backed by real threads** on the user executor: `BaseDurableOperation.runUserHandler` runs work via `CompletableFuture.runAsync(wrapped, getContext().getDurableConfig().getExecutorService())` (`operation/BaseDurableOperation.java:~230-260`). Suspension is driven by an **active-thread-count race**: `ExecutionManager.deregisterActiveThread` calls `suspendExecution()` when `activeThreads.isEmpty()` (`execution/ExecutionManager.java:~250-275`). Determinism comes from operation-ID-keyed replay + the one-way `ExecutionMode` transition, **not** from avoiding threads. The DAG scheduler still controls concurrency by **deferring the `*Async` call**; §9's earlier "threads would break replay" framing was wrong and is rewritten.
> - **[A-J6] — ✅ SOURCE-VERIFIED.** `ConcurrencyCompletionStatus` is closed at **exactly 3 members** (`ALL_COMPLETED`, `MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED` — `model/ConcurrencyCompletionStatus.java:6-9`, plus a helper `isSucceeded()`). Completion is **factory-method-only**: `CompletionConfig` is a record with `allSuccessful/allCompleted/firstSuccessful/minSuccessful/toleratedFailureCount/toleratedFailurePercentage` (`config/CompletionConfig.java:15-52`) and `ConcurrencyOperation.canComplete` hardcodes the three outcomes (`operation/ConcurrencyOperation.java:~250-280`) — **no customer predicate hook**. ⇒ v1 should **defer custom completion (§6 Option B)**; Option A is feasible _only_ because the DAG owns its own scheduler.

---

## 1. Overview

`ctx.dag(...)` adds a first-class primitive for declaring a **directed acyclic graph of tasks** with typed dependencies. Customers describe the graph once in a declarative _registration phase_ (a `Consumer<DagContext>`); the runtime schedules tasks topologically, runs independent chains concurrently via `DurableFuture`, evaluates per-task trigger rules and `runIf` predicates, and aggregates results into a `DagResult`.

As in JS, a DAG is a **child context** (one `runInChildContext` node in the parent tree) whose body runs a **name-based scheduler**. Each task delegates to the **same operation machinery** the equivalent `DurableContext` method uses; the only difference is the task's entity ID is derived from its **name** (`{parentId}-DAG_NODE_T_{name}`) instead of the monotonic counter — the property that makes arbitrary graph shapes replay-safe.

### 1.1 Motivation (identical to JS)

Counter-based IDs are assigned at operation _start_. `map`/`parallel` are replay-safe because items start in deterministic order. In an arbitrary DAG a downstream task starts when its upstream deps _complete_, and completion order can vary across replays — so counter IDs would diverge and trigger `NonDeterministicExecutionException`. Name-based IDs (§4) solve this. Per [A-J1] (**source-verified**), Java does use per-context counter IDs, so this motivation holds; the explicit-ID seam that lets a task run under `idOf(name)` ([A-J2]) is **resolved as `CAN-BE-ADDED`** — a minimal, surgical addition (§4.3, Appendix A), because the caller-supplied-ID path is already threaded through the whole operation/execution stack.

### 1.2 Goals / Non-goals

Same as JS §1.2/§1.3: declarative typed data-flow, replay-safe for any shape, reuse existing checkpoint/replay/retry/serdes, per-task `triggerRule`+`runIf`, heterogeneous task kinds + nested DAGs, backward compatible (pure addition). Non-goals: dedicated branch operator, dynamic task creation, cross-task semaphores, pre-built operators/cron/UI.

---

## 2. Public API (proposed Java surface)

New public types live in `software.amazon.lambda.durable.dag`. Only `DurableContext.dag(...)` is added to the existing interface.

### 2.1 Entry point (added to `DurableContext`)

```java
// Addition to interface DurableContext
DagResult dag(String name, Consumer<DagContext> register);
DagResult dag(String name, Consumer<DagContext> register, DagConfig config);

// Async variant, consistent with stepAsync/mapAsync:
DurableFuture<DagResult> dagAsync(String name, Consumer<DagContext> register);
DurableFuture<DagResult> dagAsync(String name, Consumer<DagContext> register, DagConfig config);
```

`register` is **registration-only**: tasks are _declared_ but do not execute until it returns. Unlike JS (which returns a `DurablePromise` for every op), Java's existing style is **sync-by-default with an explicit `*Async` twin** (cf. `step`/`stepAsync`, `map`/`mapAsync`). We follow that convention: `dag(...)` blocks and returns `DagResult`; `dagAsync(...)` returns `DurableFuture<DagResult>`.

> **[CODE NOTE — divergence from JS]** JS `register` may be `void | Promise<void>`. Java uses a plain `Consumer<DagContext>` (synchronous). Async registration (JS open question §11.3) is intentionally **not** offered: Java registration is pure graph-building and has no idiomatic async need. If a customer needs to `await` config, they compute it _before_ calling `dag()`.

### 2.2 The typed-dependency problem — Java's answer to `DepsMap`

**This is the central adaptation.** JS expresses data-flow with a mapped type `DepsMap<TDeps>` keyed on _literal task-name string types_ — `deps.fetch` is statically typed as `fetch`'s result. **Java generics cannot express this**: there are no literal-string type keys and no heterogeneous typed maps. Three JS features collapse into this problem:

1. `deps: [a, b]` inline array with per-name typed access `deps.a`, `deps.b`.
2. `TaskHandle<TName, TResult>` carrying both the name literal and result type.
3. `DepsMap<TDeps>` reconstructing `{ a: Ra, b: Rb }`.

**Java resolution: typed `TaskHandle<T>` + a `Deps` accessor keyed by handle (not by name-string).** A task's function receives a `Deps` object; it reads an upstream result by passing that upstream's _handle_, which carries the result type via generics:

```java
public interface Deps {
    /** Typed result of an upstream task. Returns the checkpointed result of `handle`.
     *  Throws IllegalStateException if `handle` is not an inline dependency of this task
     *  (ordering-only deps added via .dependsOn(...) are NOT retrievable here — mirrors JS
     *  "only inline deps populate DepsMap"). Returns null if the upstream did not SUCCEED
     *  (see the non-ALL_SUCCESS caveat, §2.6). */
    <T> T get(TaskHandle<T> handle);

    /** Optional<T> convenience for non-ALL_SUCCESS trigger rules where an upstream
     *  may be FAILED/SKIPPED and thus have no result. */
    <T> Optional<T> getOptional(TaskHandle<T> handle);
}
```

This is **type-safe without literal-string types**: `deps.get(fetchHandle)` returns exactly `fetchHandle`'s `T`. It is the direct Java analog of the JS spec's own fallback suggestion (`DepsAccessor.getResult(TaskHandle<T>) -> T`) and matches the ergonomics Java developers already know from `parallel().branch(...).get()` (a `DurableFuture<T>` typed by its declared class).

> **Type-soundness note (✅ source-verified pattern).** `<T> T get(TaskHandle<T> handle)` is fully sound: it is the same **typed-key heterogeneous container** pattern proven in the JDK/ecosystem — `ClassToInstanceMap<T>`, Netty `AttributeMap`/`AttributeKey<T>`, and gRPC `Context.Key<T>`. Internally the results are stored in a `Map<String, Object>` keyed by `handle.name()`, and `get` performs one **contained, provably-safe** unchecked cast to `T` because the `(handle → result type)` binding is fixed at registration and handles are unique per task. No unchecked warning or `ClassCastException` risk leaks to the caller. The Java SDK itself relies on the same reified-type discipline via `TypeToken<T>` for serde — **verified in source**: `SerializableDurableOperation.deserializeResult` calls `resultSerDes.deserialize(result, resultTypeToken)` and `deserializeException` uses `TypeToken.get(exceptionClass.asSubclass(Throwable.class))` (`operation/SerializableDurableOperation.java`), and every `DurableContextImpl.*Async` op carries a `TypeToken<T>`/`Class<T>` result type. So `Deps.get(handle)` is idiomatic and consistent with the existing API.

> **Why not a positional-arity `zip` overload (`.dependsOn(a, b) -> (A, B) -> R`)?** Considered (Reactor `Mono.zip` / Airflow-style). Rejected as the _primary_ API because: (a) it caps at a fixed arity (typically 2–8 overloads) and degrades to `Object[]`/`Tuple` past that; (b) it does not compose with the _ordering-only_ deps distinction; (c) it forces a different call shape per dep count. It is offered as **optional sugar** for the common 1–3 typed-dep case (§2.7), but `Deps.get(handle)` is the canonical, arity-unbounded form.

### 2.3 `TaskHandle<T>`

Registration-time reference + builder. Carries the result type `T` via generics (this part of JS `TaskHandle<TName, TResult>` **ports directly** — Java generics handle `TResult` fine; only the `TName` _literal_ is dropped, since Java has no use for a name-as-type).

```java
public interface TaskHandle<T> {
    /** Task name (runtime string; NOT a type-level literal). */
    String name();

    /** Inline (typed) deps: wait for these AND receive their results via Deps.get(...).
     *  Only handles declared here are retrievable in this task's fn (§3). */
    TaskHandle<T> reads(TaskHandle<?>... deps);

    /** Ordering-only deps: wait for these but do not receive their results in Deps. */
    TaskHandle<T> dependsOn(TaskHandle<?>... deps);

    /** Trigger rule (default from DagConfig.defaultTriggerRule, else ALL_SUCCESS). */
    TaskHandle<T> triggerRule(TriggerRule rule);

    /** Conditional skip predicate over resolved upstream results (§2.6). */
    TaskHandle<T> runIf(Predicate<Deps> predicate);
}
```

The in-memory identity is an SDK-internal object reference (Java's answer to JS's `symbol _id`) — never serialized. `TaskHandle` is used only during registration/scheduling.

> **[CODE NOTE]** Builder methods return `this` (typed `TaskHandle<T>`) for chaining, e.g. `d.step(...).dependsOn(a).triggerRule(TriggerRule.ALL_DONE)`. This matches the fluent `parallel().branch(...)` and `*Config.builder()` styles already in the Java SDK.

### 2.4 `DagContext` — declarative task registration

Separate interface (does **not** extend `DurableContext`), so only declarative task methods are visible inside `register`. Each method registers one task and returns a `TaskHandle<T>`. Result typing uses the SDK's existing `Class<T>` / `TypeToken<T>` convention.

```java
public interface DagContext {

    // ── step ────────────────────────────────────────────────────────────────
    <T> TaskHandle<T> step(String name, Class<T> type, DagStepFunction<T> fn);
    <T> TaskHandle<T> step(String name, TypeToken<T> type, DagStepFunction<T> fn);
    <T> TaskHandle<T> step(String name, Class<T> type, DagStepFunction<T> fn, StepConfig config);
    <T> TaskHandle<T> step(String name, TypeToken<T> type, DagStepFunction<T> fn, StepConfig config);

    // ── invoke ───────────────────────────────────────────────────────────────
    <T> TaskHandle<T> invoke(String name, String functionName, Class<T> type,
                             DagPayloadFunction payloadFn);
    <T> TaskHandle<T> invoke(String name, String functionName, Class<T> type,
                             DagPayloadFunction payloadFn, InvokeConfig config);

    // ── callback (submitter-based) ────────────────────────────────────────────
    <T> TaskHandle<T> callback(String name, Class<T> type, DagCallbackSubmitter submitter);
    <T> TaskHandle<T> callback(String name, Class<T> type, DagCallbackSubmitter submitter,
                               WaitForCallbackConfig config);

    // ── wait ──────────────────────────────────────────────────────────────────
    TaskHandle<Void> wait(String name, Duration duration);

    // ── waitForCondition ───────────────────────────────────────────────────────
    <S> TaskHandle<S> waitForCondition(String name, Class<S> type,
                                       DagConditionFunction<S> check, WaitForConditionConfig<S> config);

    // ── runInChildContext ──────────────────────────────────────────────────────
    <T> TaskHandle<T> runInChildContext(String name, Class<T> type, DagChildFunction<T> fn);
    <T> TaskHandle<T> runInChildContext(String name, TypeToken<T> type, DagChildFunction<T> fn);

    // ── map ─────────────────────────────────────────────────────────────────────
    // NOTE: `MapFunction<I,O>` is the existing SDK type `O apply(I item, int index, DurableContext ctx)`
    // (item-first, no Deps). Upstream data enters a map task via the `Function<Deps, Collection<I>>`
    // items-producer overload. `items` must have deterministic iteration order (List/LinkedList/TreeSet).
    <I, O> TaskHandle<MapResult<O>> map(String name, Collection<I> items, Class<O> type,
                                        MapFunction<I, O> fn);
    <I, O> TaskHandle<MapResult<O>> map(String name, Collection<I> items, Class<O> type,
                                        MapFunction<I, O> fn, MapConfig config);
    <I, O> TaskHandle<MapResult<O>> map(String name, Function<Deps, Collection<I>> items, Class<O> type,
                                        MapFunction<I, O> fn);
    <I, O> TaskHandle<MapResult<O>> map(String name, Function<Deps, Collection<I>> items, Class<O> type,
                                        MapFunction<I, O> fn, MapConfig config);

    // ── parallel ──────────────────────────────────────────────────────────────
    TaskHandle<ParallelResult> parallel(String name, Consumer<ParallelBuilder> branches);
    TaskHandle<ParallelResult> parallel(String name, Consumer<ParallelBuilder> branches, ParallelConfig config);

    // ── nested dag ──────────────────────────────────────────────────────────────
    TaskHandle<DagResult> dag(String name, Consumer<DagContext> register);
    TaskHandle<DagResult> dag(String name, Consumer<DagContext> register, DagConfig config);
}
```

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `MapConfig`, `ParallelConfig`, `MapFunction`, `MapResult`, `ParallelResult`, `TypeToken`, `Duration` are the **existing** Java SDK types, reused verbatim so per-task retry/serdes/semantics are identical to standalone operations.

### 2.5 Task functional interfaces (deps-first rule)

JS varies the function shape based on whether `TDeps` is empty (conditional types). **Java cannot do conditional signatures**, and overloading on erased functional interfaces is ambiguous. Resolution: **every DAG task function takes a `Deps` as its first parameter, always** — even for root tasks (where `Deps` is empty and `.get()` on any non-dep throws). This trades JS's zero-arg ergonomics for a _single uniform, unambiguous_ signature, which is the idiomatic Java choice. `Deps` for a root task is simply empty.

```java
@FunctionalInterface public interface DagStepFunction<T>   { T apply(Deps deps, StepContext ctx); }
@FunctionalInterface public interface DagPayloadFunction    { Object apply(Deps deps); }
@FunctionalInterface public interface DagCallbackSubmitter  { void apply(Deps deps, String callbackId, StepContext ctx); }
@FunctionalInterface public interface DagConditionFunction<S>{ WaitForConditionResult<S> apply(Deps deps, S state, StepContext ctx); }
@FunctionalInterface public interface DagChildFunction<T>   { T apply(Deps deps, DurableContext childCtx); }
```

Each interface's non-`Deps` parameters preserve the **native** shape of the underlying operation — all verified against `docs/design.md`: step `StepContext ctx`; callback `(String callbackId, StepContext ctx)` (native `BiConsumer<String,StepContext>`); waitForCondition `(S state, StepContext ctx)` returning `WaitForConditionResult<S>` = value + isDone (native `BiFunction<S,StepContext,WaitForConditionResult<S>>`); child `DurableContext` — so per-op behavior is unchanged; the DAG only prepends `Deps`. The polling/backoff strategy for `waitForCondition` comes from the native `WaitForConditionConfig` (`WaitStrategies`/`initialState`), not from the function.

> **[CODE NOTE — divergence from JS]** JS collapses the deps parameter away entirely when `deps: []`. Java keeps `Deps` as a mandatory first parameter uniformly (empty for roots). This is a deliberate ergonomic tradeoff: a single non-conditional signature is far more idiomatic and tractable in Java than trying to fake conditional arity via overloads.

### 2.6 `runIf` and non-`ALL_SUCCESS` typing caveat

`runIf` is a `Predicate<Deps>` (§2.3), synchronous and deterministic (async predicates invite non-deterministic IO on replay). Evaluated **after** the trigger rule passes, **before** the operation runs; `false` ⇒ task is `SKIPPED` with `skipReason = RUN_IF_PREDICATE`.

Same runtime caveat as JS §2.5: under trigger rules other than `ALL_SUCCESS`, an upstream can be `FAILED`/`SKIPPED` and still let this task run, so `deps.get(handle)` may be `null`. Java offers `deps.getOptional(handle)` for those paths. `Deps.get` returns the declared `T` on the common `ALL_SUCCESS` path.

### 2.7 Optional positional-arity sugar (non-normative)

For the common 1–3 typed-dep case, offer typed convenience overloads that avoid the `Deps` accessor, mirroring `Mono.zip`:

```java
// Sugar layer — desugars to Deps.get() internally; capped at a small arity.
<A, T> TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, BiFunction<A, StepContext, T> fn);
<A, B, T> TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, TaskHandle<B> b, TriFunction<A, B, StepContext, T> fn);
```

This is **additive sugar**, not the canonical path (§2.2). `Deps.get(handle)` remains the arity-unbounded form and the one this spec normatively describes.

### 2.8 `TriggerRule`, `TaskStatus`, `SkipReason`

Java enums (JS uses string-literal unions). Direct port — enums are the idiomatic Java form and serialize cleanly.

```java
public enum TriggerRule { ALL_SUCCESS, ALL_FAILED, ALL_DONE, ONE_SUCCESS, ONE_FAILED, NONE_FAILED }
public enum TaskStatus  { SUCCEEDED, FAILED, SKIPPED, STARTED }
public enum SkipReason  { TRIGGER_RULE, RUN_IF_PREDICATE }
```

Default is `ALL_SUCCESS` (or `DagConfig.defaultTriggerRule`). Empty-upstream semantics identical to JS §5.3 (success/done-family run vacuously; failure-family skip). The evaluator table (§5) is ported verbatim.

### 2.9 `DagResult` and `TaskExecution`

```java
public record TaskExecution<T>(
    String name,
    TaskStatus status,
    Optional<SkipReason> skipReason,      // present only when status == SKIPPED
    Optional<T> result,                   // present only when status == SUCCEEDED
    Optional<DagTaskError> error,         // present only when status == FAILED
    Optional<Instant> startedAt,
    Optional<Instant> completedAt
) {}

public interface DagResult {
    /** Typed accessor by handle — Java's answer to JS getResult<T>(handle). */
    <T> Optional<T> getResult(TaskHandle<T> handle);
    /** Untyped accessor by name. */
    Optional<Object> getResult(String name);

    Optional<TaskStatus> getStatus(TaskHandle<?> handle);
    Optional<TaskStatus> getStatus(String name);

    List<TaskExecution<?>> succeeded();
    List<TaskExecution<?>> failed();
    List<TaskExecution<?>> skipped();

    Map<String, TaskExecution<?>> results();   // unmodifiable

    int successCount();
    int failureCount();
    int skippedCount();
    int totalCount();

    DagCompletionReason completionReason();

    /** Throws DagExecutionException if failureCount > 0. (Also fires on CUSTOM_COMPLETION_FAILED,
     *  but that reason is unreachable under the recommended v1 Option B — §6 defers custom
     *  completion; the clause is inert until/unless Option A ships.) */
    void throwIfError();
}
```

`DagTaskError` is a serializable record analogous to `MapError` (`errorType`, `errorMessage`, `stackTrace`, and an optional reconstructed cause). Reusing the `MapError` shape keeps error serialization consistent with the existing batch machinery.

> **[CODE NOTE — divergence from JS]** JS uses `getResult(): T | undefined`. Java uses `Optional<T>` throughout, matching modern Java conventions and avoiding `null` ambiguity (a `null` result vs. absent task). `MapResult` in the Java SDK returns bare `null` for failed items, but `DagResult` deliberately prefers `Optional` for the _aggregate_ accessor because a DAG additionally distinguishes SKIPPED/never-started (both absent) from a genuine `null` success value.

### 2.10 Completion-reason: core enum + Java-side superset

JS layers a shared `CompletionReason` (5 members) in `core.ts` and defines `DagCompletionReason = CompletionReason | "COMPLETED_WITH_FAILURES"`. **Java cannot union enums.** The Java SDK's existing enum is `ConcurrencyCompletionStatus` with **only 3 members** (`ALL_COMPLETED`, `MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED`) — it has **no `CUSTOM_COMPLETION_*`** members at all (verified in map/parallel docs). This is a **material divergence** from the JS 5-member core.

Resolution: define a **dedicated DAG enum** that is a _conceptual superset_ of the batch enum (Java has no enum inheritance, so it is a fresh enum whose members are a deliberate superset):

```java
public enum DagCompletionReason {
    ALL_COMPLETED,                 // default drain, all reachable tasks succeeded/skipped
    COMPLETED_WITH_FAILURES,       // DAG-specific: default drain, >=1 task FAILED (resolves the JS F13 footgun)
    MIN_SUCCESSFUL_REACHED,        // via completionConfig
    FAILURE_TOLERANCE_EXCEEDED,    // via completionConfig
    CUSTOM_COMPLETION_SUCCEEDED,   // via custom predicate — see §6 (may be deferred)
    CUSTOM_COMPLETION_FAILED       // via custom predicate — see §6 (may be deferred)
}
```

> **[CODE NOTE — divergence]** Because the Java batch enum lacks `CUSTOM_COMPLETION_*`, `DagCompletionReason` is NOT a strict extension of an existing Java enum — it is a new DAG-local enum. Semantics match JS: default drain distinguishes clean (`ALL_COMPLETED`) from drained-with-failures (`COMPLETED_WITH_FAILURES`), so the reason itself disambiguates. `throwIfError()` keys off `failureCount`, not the reason. The two `CUSTOM_COMPLETION_*` members appear **only if** the custom-predicate path (§6) is implemented; if v1 defers custom completion (see [A-J6]), they are reserved-but-unreachable.

### 2.11 `DagConfig`

```java
public record DagConfig(
    Optional<Integer> maxConcurrency,          // default: unlimited; must be >= 1 if present (matches map/parallel)
    Optional<DagCompletionConfig> completionConfig,
    Optional<RetryStrategy> defaultRetryStrategy,
    Optional<TriggerRule> defaultTriggerRule,   // default ALL_SUCCESS
    Optional<SerDes<DagResult>> serDes,
    Optional<Function<DagResult, String>> summaryGenerator  // NON-NATIVE, v1-DROP CANDIDATE — no SDK precedent (§8.1)
) {
    public static Builder builder() { ... }
}
```

Built via `DagConfig.builder()` to match the SDK's pervasive builder style. `maxConcurrency` validation mirrors `MapConfig`/`ParallelConfig`: **must be ≥ 1** if set (note: the Java SDK docs say map/parallel require `>= 1`, a slightly different guard shape than JS's `<= 0 throws` — Java throws `IllegalArgumentException`, §7/§9).

### 2.12 Two ways to declare dependencies

Identical model to JS §3, expressed with handles:

```java
ctx.dag("etl", d -> {
    var a = d.step("a", A.class, (deps, s) -> fetchA());              // root: empty Deps
    var b = d.step("b", B.class, (deps, s) -> fetchB());
    var c = d.step("c", C.class, (deps, s) ->                          // inline deps => typed access
                process(deps.get(a), deps.get(b)))
             .reads(a, b);                                             // declare inline (typed) deps: retrievable via Deps.get
    d.step("notify", Void.class, (deps, s) -> notifyDone())
             .dependsOn(c);                                            // ordering-only: waits for c, no result access
});
```

Inline deps are declared explicitly via `.reads(...)`; only those handles are retrievable via `Deps.get(...)` inside the fn. `.dependsOn(...)` adds ordering-only edges (scheduling/trigger/cycle only, not in `Deps`).

> **[CODE NOTE — divergence from JS]** JS distinguishes inline deps (`deps: [a,b]` array param) from builder deps (`.deps(...)`) _syntactically_. Java has no separate deps array param and cannot introspect a lambda body to discover which handles it calls `deps.get(...)` on; instead **a task's inline deps must be declared explicitly on the builder via `.reads(a, b)`**, so the scheduler knows the full graph (and the retrievable-deps set) without executing the body. Only handles passed to `.reads(...)` are retrievable via `Deps.get`; passing an undeclared handle throws `IllegalStateException` (§3). See §3 for the concrete `TaskDef`/registration mechanics.

---

## 3. Registration mechanics & the explicit-inline-deps rule

**Reconciliation of the §2.12 wrinkle.** Java cannot introspect a lambda body to learn which handles it calls `deps.get(...)` on. So — unlike JS, where `deps: [a,b]` is a literal array param feeding the type system — **Java requires inline deps to be declared explicitly** on the builder, and only declared handles are retrievable via `Deps.get`. The canonical, statically-analyzable form:

```java
var c = d.step("c", C.class, (deps, s) -> process(deps.get(a), deps.get(b)))
         .reads(a, b);         // <-- inline (typed) deps: retrievable via Deps.get, populate DepsMap-equivalent
```

- `.reads(TaskHandle<?>... deps)` — declares **inline** deps: they gate scheduling AND are retrievable via `Deps.get`. (Runtime guard: `Deps.get(h)` throws `IllegalStateException` if `h` was not declared via `.reads(...)`.)
- `.dependsOn(TaskHandle<?>... deps)` — declares **ordering-only** deps: gate scheduling but NOT retrievable via `Deps`.

`TaskDef` (internal) stores both sets, exactly like JS `inlineDeps` vs `allDeps`:

```java
record TaskDef<T>(
    String name,
    TaskKind kind,                       // STEP, INVOKE, CALLBACK, WAIT, WAIT_FOR_CONDITION, CHILD, MAP, PARALLEL, DAG
    List<TaskHandle<?>> inlineDeps,      // from .reads(...)  -> drives Deps
    List<TaskHandle<?>> allDeps,         // inlineDeps ∪ .dependsOn(...) -> readiness, trigger, cycle, missing-dep
    Optional<TriggerRule> triggerRule,
    Optional<Predicate<Deps>> runIf,
    Object options,
    TaskExecutor<T> executor             // closure binding op kind + deps-first rule
) {}
```

| Consumer                                                                   | Uses         |
| -------------------------------------------------------------------------- | ------------ |
| `Deps` construction (typed result access)                                  | `inlineDeps` |
| Readiness / trigger-rule status / cycle detection / missing-dep validation | `allDeps`    |

> **[CODE NOTE — the cleaner alternative + why not]** A deps-in-signature form (`d.step("c", C.class, List.of(a,b), (deps,s)->...)`) makes inline deps a required positional argument (closest to JS). Rejected as canonical because it fixes an awkward `List<TaskHandle<?>>` param in every overload and reads worse than fluent `.reads(...)`. The `.reads(...)`/`.dependsOn(...)` builder pair is the idiomatic Java choice and keeps the method overload set small. The positional-arity sugar (§2.7) is the escape hatch for those who want the deps _and_ their types inline.

---

## 4. Entity-ID strategy & replay correctness

**Ports directly from JS §4** ([A-J1] source-verified: Java uses per-context counter IDs, hashed + context-path-prefixed; [A-J2] resolved `CAN-BE-ADDED` — the explicit-ID seam is a minimal addition, §4.3). The design is language-agnostic: IDs are opaque strings, hashed before checkpoint storage; a task's ID is `{parentId}-DAG_NODE_T_{name}`.

### 4.1 Name-based task IDs

```
context.dag(...) child context:   1-2
  task "fetch_data":              1-2-DAG_NODE_T_fetch_data
  nested dag "validation":        1-2-DAG_NODE_T_validation
    sub-task "rule_a":            1-2-DAG_NODE_T_validation-DAG_NODE_T_rule_a
```

### 4.2 Charset rules (ported verbatim — normative core)

- Name pattern `^[a-zA-Z0-9_]+$`, ≤ 100 chars. **No `-`** (dash is structural-only in IDs).
- Name MUST NOT contain the reserved sequence `DAG_NODE_T_` (defense-in-depth).

> **Source note (SDK base vs DAG rule).** The base SDK validation is _looser_: `ParameterValidator.validateOperationName` allows **any printable ASCII up to `MAX_OPERATION_NAME_LENGTH = 256`** and does **not** forbid `-` (`util/ParameterValidator.java:22,~150-185`). The DAG's `^[a-zA-Z0-9_]+$` / ≤100 / no-`DAG_NODE_T_` rule is therefore a **stricter DAG-layer constraint** enforced additionally at registration (via `DagInvalidTaskNameException`), not a restatement of the SDK guard — this is exactly what the injectivity proof requires (no `-` in names ⇒ the `-DAG_NODE_T_` delimiter is unforgeable).

The injectivity argument (no `-` in names ⇒ the `-DAG_NODE_T_` delimiter is unforgeable ⇒ the `(scope-path, name) → entityId` map is a bijection) is **identical to JS §4.2** and language-independent. Enforced at registration via `DagInvalidTaskNameException`. This is part of the **shared normative core** (see cross-language doc).

### 4.3 Replay-correctness argument (Java-specific grounding — [A-J2] resolved `CAN-BE-ADDED`)

The scheduler's traversal order may vary run-to-run; correctness depends only on (a) stable IDs and (b) topological ordering. Concretely, the Java analog of the JS argument:

1. Each task's ID is a pure function of its name + DAG context prefix — identical every run.
2. When the scheduler runs task `X`, it invokes `X`'s underlying operation **under the explicit ID `idOf(X)`** ([A-J2], resolved — via `OperationIdGenerator.operationIdForName("DAG_NODE_T_"+name)` feeding the explicit-ID `*AsyncWithId` variant, §4.3). If `X` already completed, the operation's replay fast-path returns the checkpointed result (or rethrows the checkpointed error) without re-executing — the same fast path `step`/`invoke`/`runInChildContext` already use, keyed on the entity ID (`BaseDurableOperation.getOperation()` → `ExecutionManager.getOperationAndUpdateReplayState(getOperationId())`).
3. Replay-consistency validation (Java's `NonDeterministicExecutionException` guard) compares operation type/name/subtype against the checkpoint; the same name always maps to the same op type, so it passes. It does not inspect ID format.
4. The scheduler rebuilds its in-memory `results` map each run via the fast path; `Deps` is reconstructed identically; topological order guarantees deps are present before a task runs.

The **only** new requirement over `map`/`parallel` is ID derivation; everything downstream (checkpoint, retry, serdes, replay validation, termination) is existing machinery.

> **[CODE NOTE — Java mode-management coupling, cf. JS §7.3.1 — ✅ SOURCE-VERIFIED].** JS's core risk is that `withDurableModeManagement` is coupled to the counter via `peekStepId()`. **Verified Java analog:** the one-way `ExecutionMode` REPLAY→EXECUTION transition is driven by `ExecutionManager.getOperationAndUpdateReplayState(operationId)` (`execution/ExecutionManager.java:207-217`), which is keyed **purely on the operation-ID string** — it flips to EXECUTION when the id is absent or non-terminal, and is agnostic to _how_ the id was produced. `BaseDurableOperation.getOperation()` (`operation/BaseDurableOperation.java:155`) calls it with `getOperationId()`. So a DAG task launched under an explicit `idOf(name)` slots into this lookup with **no change to the replay/mode machinery**. `map`/`parallel`/child per-item ops already run under **non-top-level, explicitly-_prefixed_ IDs** (`ConcurrencyOperation` seeds `new OperationIdGenerator(getOperationId())` and `createChildContext(getOperationId(), ...)`, `operation/ConcurrencyOperation.java:73-86,96-118,137`) — proving the stack runs ops under a caller-controlled prefix; they simply mint the _suffix_ by counter, not by name.
>
> **✅ [A-J2] VERDICT — `CAN-BE-ADDED` (minimal, surgical; names given).** The caller-supplied-ID seam is already threaded through the entire stack (opaque `OperationIdentifier.operationId`; ID-agnostic `BaseDurableOperation`/`ExecutionManager`/`validateReplay`; child contexts run under `getOperationId()`). The **only** missing piece is a name→id minting function and internal entry points that use it in place of the counter. Precise minimal change:
>
> 1. **`OperationIdGenerator`** (`execution/OperationIdGenerator.java`): add one method reusing the existing prefix + SHA-256 discipline, counter untouched —
>    ```java
>    /** Mints an operation ID from a caller-supplied name suffix instead of the monotonic counter. */
>    public String operationIdForName(String name) {
>        return hashOperationId(operationIdPrefix + name);   // operationIdPrefix already == contextId + "-"
>    }
>    ```
>    The DAG passes `"DAG_NODE_T_" + taskName`, yielding `hash(dagContextId + "-DAG_NODE_T_" + taskName)` — exactly the normative `{parentId}-DAG_NODE_T_{name}` scheme (pre-hash).
> 2. **`DurableContextImpl`** (`context/DurableContextImpl.java`): add internal explicit-ID variants of the op-launch methods (`stepAsyncWithId`, `invokeAsyncWithId`, `runInChildContextAsyncWithId`, `mapAsyncWithId`, `parallelWithId`, `callbackWithId`, `waitForConditionAsyncWithId`, `waitAsyncWithId`) — each **identical** to the existing method except it takes a precomputed `operationId` (from `operationIdGenerator.operationIdForName(...)`) instead of calling the private `nextOperationId()` (`:335`). Cleanest form: extract a private helper per op that both the public method (passing `nextOperationId()`) and the DAG (passing the name-derived id) call. These live on the concrete `DurableContextImpl` as an **internal SPI**, _not_ on the public `DurableContext` interface.
> 3. **Zero changes** to `BaseDurableOperation`, `ExecutionManager`, `OperationIdentifier`, any `*Operation` subclass, `validateReplay`, or serde — they already accept and thread an arbitrary caller-controlled `operationId`.
>
> **Packaging caveat (not a semantic blocker).** The scheduler (`DagExecutor`) must reach these internal methods. Either place it in the `software.amazon.lambda.durable.context`/`operation` package (package-internal access) or give the explicit-ID variants wider-but-internal visibility. The proposed public `software.amazon.lambda.durable.dag` package for the _surface_ types is unaffected.

---

## 5. Scheduler semantics

Ported from JS §5. The Java scheduler (`DagExecutor`) is a topological scheduler over `List<TaskDef>` maintaining `Map<String, TaskExecution<?>> results`, `Set<String> inFlight`, and a ready set.

- **Readiness (§5.1):** a task is ready when every dep in `allDeps` is terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`) in `results`. Roots are ready immediately.
- **Concurrency (§5.2):** start ready tasks while `inFlight.size() < maxConcurrency`. The scheduler controls concurrency by **deferring the `*Async` call** (which returns a `DurableFuture`) until the task is ready and under the cap — the Java analog of JS deferring the handler call ([A-J5]).
- **Trigger-rule evaluation (§5.3):** the six-rule truth table and the empty-upstream semantics are **ported verbatim**. Java evaluator:
  ```java
  enum TriggerRule {
      ALL_SUCCESS  { boolean eval(List<TaskStatus> s){ return s.stream().allMatch(x->x==SUCCEEDED); } },      // [] -> true (Run)
      ALL_FAILED   { boolean eval(List<TaskStatus> s){ return !s.isEmpty() && s.stream().allMatch(x->x==FAILED); } }, // [] -> false (Skip)
      ALL_DONE     { boolean eval(List<TaskStatus> s){ return true; } },                                        // [] -> true (Run)
      ONE_SUCCESS  { boolean eval(List<TaskStatus> s){ return s.stream().anyMatch(x->x==SUCCEEDED); } },        // [] -> false (Skip)
      ONE_FAILED   { boolean eval(List<TaskStatus> s){ return s.stream().anyMatch(x->x==FAILED); } },           // [] -> false (Skip)
      NONE_FAILED  { boolean eval(List<TaskStatus> s){ return s.stream().noneMatch(x->x==FAILED); } };          // [] -> true (Run)
      abstract boolean eval(List<TaskStatus> statuses);
  }
  ```
  Not satisfied ⇒ record `SKIPPED / TRIGGER_RULE`, propagate downstream.
- **`runIf` (§5.4):** if trigger rule passed, build `Deps` from `results` and evaluate `Predicate<Deps>`. `false` ⇒ `SKIPPED / RUN_IF_PREDICATE`.
- **Running a task (§5.5):** invoke `taskDef.executor(childCtx, deps)` → the explicit-ID `*Async` op → `SUCCEEDED{result}` / `FAILED{error}`, then queue downstream.
- **Skip propagation (§5.6):** a skip is terminal; downstream evaluates its own rule against the skip. Skips cascade.
- **Failure semantics (§5.8):** a failed task is a **normal terminal state, not an abort**. Default (no `completionConfig`): scheduler **drains the reachable graph** so compensation tasks (`ALL_FAILED`/`ALL_DONE`) run; `completionReason` = `ALL_COMPLETED` (all ok) or `COMPLETED_WITH_FAILURES` (≥1 failed). `dag()` does **not** throw; caller opts in via `throwIfError()`. This intentionally diverges from the Java batch default — see §6.
- **Empty DAG (§5.9):** resolve immediately, `totalCount=0`, `ALL_COMPLETED`.

### 5.1 SKIPPED tasks checkpoint nothing (§9.5)

A skip is a pure function of upstream terminal statuses + deterministic `runIf`, recomputed identically each run — no entity ID, no checkpoint. Ported verbatim (zero-cost skips, replay-safe).

---

## 6. Completion config & the Java custom-completion gap

`DagCompletionConfig` reuses the Java SDK's threshold factories where possible:

```java
public sealed interface DagCompletionConfig
    permits ThresholdDagCompletion, CustomDagCompletion {

    // Threshold path — maps to existing CompletionConfig factories (verified names):
    static DagCompletionConfig allCompleted();
    static DagCompletionConfig allSuccessful();
    static DagCompletionConfig firstSuccessful();               // = minSuccessful(1); present in the SDK
    static DagCompletionConfig minSuccessful(int n);
    static DagCompletionConfig toleratedFailureCount(int n);
    static DagCompletionConfig toleratedFailurePercentage(double p);   // see caveat below
}
```

> **Verified factory-name parity.** These six mirror the SDK's `CompletionConfig` factories exactly (`allCompleted`, `allSuccessful`, `firstSuccessful`, `minSuccessful`, `toleratedFailureCount`, `toleratedFailurePercentage`). **Caveat (VERIFIED, `docs/core/parallel.md`):** that doc states verbatim _"`toleratedFailurePercentage` is not supported for parallel operations"_ (it is available for `map`). The DAG owns its own scheduler, so it _can_ implement percentage semantics itself — but implementers should treat percentage as a DAG-scheduler computation, not a delegation to a native parallel config.

> **Status→reason translation.** The threshold path delegates counting to the SDK's `ConcurrencyCompletionStatus` (3 members), which the DAG maps into `DagCompletionReason` (§2.10): `MIN_SUCCESSFUL_REACHED`→`MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED`→`FAILURE_TOLERANCE_EXCEEDED`, and `ALL_COMPLETED`→`ALL_COMPLETED` _or_ `COMPLETED_WITH_FAILURES` depending on `failureCount` (the DAG-local distinction the batch enum cannot express).

**Threshold path (Ports):** `minSuccessful`/`toleratedFailureCount`/`toleratedFailurePercentage` map onto the SDK's existing `CompletionConfig` factories and `ConcurrencyCompletionStatus`. `SKIPPED` counts toward neither success nor failure. Reason ⇒ `MIN_SUCCESSFUL_REACHED` / `FAILURE_TOLERANCE_EXCEEDED`.

**Custom-predicate path (Adapts, DAG-owned; JS ships it in v1, Java should defer to v2 — [A-J6] VERIFIED):** JS exposes `shouldComplete(status: DagCompletionStatus): CompletionDecision` with per-task **results** for value-based short-circuit (e.g. "stop when any rule returns REJECT"). **The Java SDK's public completion surface has no custom-predicate hook and no `CUSTOM_COMPLETION_*` status** — this is now **verified**, not assumed (`ConcurrencyCompletionStatus` is closed at 3 members; completion is factory-method-only). Two options:

- **Option A (recommended if a source seam exists):** define a DAG-specific custom-completion interface (the batch layer need not gain it), because the DAG scheduler is a **separate component** and can evaluate a predicate itself:
  ```java
  public sealed interface DagCompletionConfig permits ThresholdDagCompletion, CustomDagCompletion {}
  public record CustomDagCompletion(Predicate<DagCompletionSnapshot> shouldComplete,
                                    CompletionOutcomeOnStop outcome) implements DagCompletionConfig {}
  public record DagCompletionSnapshot(int successCount, int failureCount, int skippedCount,
                                      int completedCount, int totalCount,
                                      Map<String, TaskExecution<?>> results) {}   // results = value-based short-circuit
  ```
  This is feasible **without touching the batch enum** because the DAG owns its scheduler and its own `DagCompletionReason` (§2.10) already reserves `CUSTOM_COMPLETION_*`.
- **Option B (recommended for v1):** ship only the threshold path in v1 and mark result-based short-circuit (JS §13.4) as **deferred**. Since [A-J6] is verified (the SDK has no custom-completion machinery to reuse), custom completion is a **net-new DAG-owned feature** either way; deferring it keeps v1 minimal and avoids committing to Option A before the scheduler internals are built.

> **[CODE NOTE — divergence]** This is the single largest _feature_ divergence from JS: JS ships value-based custom completion in v1; Java should ship threshold completion in v1 and gate custom completion on verifying an internal predicate seam. The DAG-owned scheduler makes Option A tractable, but it is flagged as an assumption.

**Deliberate divergence from Java batch default (ported from JS §5.8 [CODE NOTE]).** The Java `map`/`parallel` default is `allCompleted()` (run all) — but note the JS spec's concern is fail-fast; the Java batch default is already drain-all (`allCompleted`), so the DAG's drain-by-default is **more naturally aligned with Java than with JS**. The DAG still treats a failed task as terminal (not abort) and reports `COMPLETED_WITH_FAILURES`, which the Java batch enum cannot express — hence the DAG-local enum.

---

## 7. Validation & exceptions

Validation runs once, **after** `register` returns, **before** the scheduler starts (JS §6). Java exceptions slot into the existing hierarchy (rooted at `DurableExecutionException extends RuntimeException`, with `DurableOperationException` for operation errors — verified §0):

```
DurableExecutionException (RuntimeException)
 └── DurableOperationException
      └── DagException (new, general DAG operation exception)
           ├── DagCyclicDependencyException      // cycle at registration
           ├── DagInvalidTaskNameException        // bad name (charset / DAG_NODE_T_ / length)
           ├── DagDuplicateTaskException          // duplicate name
           ├── DagInvalidDependencyException      // dep handle not registered in this scope
           └── DagExecutionException              // thrown by throwIfError(); wraps first failed task's cause
```

- **Name/duplicate/missing-dep/cycle** — deterministic registration-time checks. Cycle detection = Kahn's algorithm over `allDeps`, `O(V+E)`, ported verbatim from JS §6.4. Throw the corresponding `Dag*Exception` from inside the DAG child-context body.
- **`maxConcurrency`** — mirror the Java batch guard: `map`/`parallel` require `>= 1` and throw `IllegalArgumentException`. The DAG throws `IllegalArgumentException` for `maxConcurrency < 1` (this is a _cleaner_ alignment than JS, which throws `Error` for `<= 0` and terminates only for the completion-config union; Java's uniform `IllegalArgumentException` for bad config is idiomatic).
- **Mutually-exclusive completion config** — Java's `sealed interface DagCompletionConfig` + factory methods make the threshold-vs-custom union **statically exclusive** (you cannot construct an ambiguous config), so the JS runtime `validateCompletionConfig` terminate-path is **largely unnecessary** in Java — the type system enforces it. A residual runtime guard (e.g. `minSuccessful(-1)`) throws `IllegalArgumentException`.
- **`NonDeterministicExecutionException`** on a task ID terminates the whole execution (unrecoverable), same as any operation.
- A task's **normal failure** is not a termination — it is a terminal task state (§5.8).

> **[CODE NOTE — ✅ SOURCE-VERIFIED, simplification over JS]** JS relies on an `errorMapper: (e) => e` pass-through wired into `runInChildContext` so raw `Dag*Error`s escape the automatic `ChildContextError` re-wrap. **Java needs no such hook.** Verified in source: `ChildContextOperation.get()` (`operation/ChildContextOperation.java:~215-245`) on a `FAILED` child calls `deserializeException(errorObject)`; **if the original reconstructs, it is re-thrown transparently** via `ExceptionHelper.sneakyThrow(original)`, and **only if reconstruction returns `null`** does it fall back to `throw new ChildContextFailedException(op)`. `SerializableDurableOperation.deserializeException` (`operation/SerializableDurableOperation.java:~120-160`) reconstructs by `Class.forName(errorType)` → `resultSerDes.deserialize(errorData, TypeToken.get(...))` → `setStackTrace(...)`, returning `null` (⇒ `ChildContextFailedException`) on `ClassNotFoundException` or `SerDesException`. `ChildContextFailedException` (`exception/ChildContextFailedException.java`) extends `DurableOperationException` and carries `errorType` + `errorMessage`. Because the `Dag*Exception` classes are ordinary `RuntimeException` subclasses on the classpath, they reconstruct and propagate out of the DAG child body — the JS pass-through problem does not exist in Java. **Fidelity caveat (source-grounded):** reconstruction preserves the exception **type, message, and stack trace**, and requires the class on the classpath plus SerDes-deserializable error data; **custom fields survive only if they are serialized into `errorData` and are Jackson-reconstructible by the SerDes** (e.g. `DagCyclicDependencyException`'s cyclic-name list may be lost otherwise). Implementers should carry any diagnostic detail that must survive replay **in the exception message**, not in bespoke fields. If the original cannot be reconstructed, the SDK falls back to `ChildContextFailedException` (type/message-only). (The DAG should still throw its validation `Dag*Exception`s _before_ launching any task so they surface at the `dag(...)` call site, not from inside a task's child context.)

---

## 8. Serialization of `DagResult`

Mirror the `MapResult` serialization machinery. `DagResultImpl` serializes to a JSON-safe shape with each task's result tagged by a `resultKind` discriminator so heterogeneous, method-bearing results (`MapResult` from map/parallel tasks, `DagResult` from nested-dag tasks) survive the round-trip (JS §8 F5):

```java
enum SerializedResultKind { PLAIN, MAP, DAG }

record SerializedTaskExecution(
    String name, TaskStatus status, SkipReason skipReason,
    SerializedResultKind resultKind, Object result, DagTaskError error,
    String startedAt, String completedAt) {}

record SerializedDagResult(List<SerializedTaskExecution> tasks, DagCompletionReason completionReason) {}
```

- `resultKind` from the task's `TaskKind`: `MAP`/`PARALLEL` ⇒ `MAP`, nested `DAG` ⇒ `DAG`, else `PLAIN`.
- On restore, `MAP`/`DAG` results are recursively rehydrated to fully-methoded `MapResult`/`DagResult` instances (the "completed DAG" replay path returns the deserialized container without re-running the scheduler, so results must be reconstructable). `TaskHandle` identity is not serialized; `DagResult.getResult(handle)` resolves by `handle.name()`.
- Errors serialize via the `MapError`-style record (`errorType`/`errorMessage`/`stackTrace`), reusing the batch cause-serialization path.

### 8.1 Large-`DagResult` handling — Java uses re-execution / per-task reconstruction (NOT a summary envelope)

> **⚠️ CORRECTION ([A-J3] falsified — ✅ now source-verified).** The original draft ported the JS `DagSummary` **SDK-owned summary envelope** + customer `summaryGenerator` hook. **Verification against the real source shows the Java SDK does not work this way and has no such hook.** Java's large-result strategy is:
>
> - **Child contexts:** `ChildContextOperation` (`operation/ChildContextOperation.java:39,88-107,150-176`) defines `LARGE_RESULT_THRESHOLD = 256*1024`; a large success is checkpointed with an **empty payload + `ContextOptions.replayChildren(true)`**, and `replay()` on a `SUCCEEDED` child whose `contextDetails().replayChildren()==TRUE` **re-executes the child body** (`replayChildren.set(true); executeChildContext();`) to reconstruct the result in memory rather than storing it in the checkpoint payload.
> - **Map:** large results are **reconstructed from individual child-context checkpoints** on replay (`MapOperation`, same per-item `ChildContextOperation` machinery).
> - There is **no** customer summary-generator hook on `runInChildContext`/`RunInChildContextConfig` — `RunInChildContextConfig` (`config/RunInChildContextConfig.java`) exposes **only `serDes`** — and **no** SDK-owned `*Summary` envelope anywhere in the package listing.

**Java-native design (what the DAG should actually do).** A DAG _is_ a child context, so it inherits the child-context large-result behavior for free — and this is **strictly simpler** than the JS envelope:

1. **Small aggregate `DagResult` (< 256KB):** serialized and checkpointed directly (§8), using the `resultKind`-tagged shape so nested `MapResult`/`DagResult` survive the round-trip.
2. **Large aggregate `DagResult` (≥ 256KB):** the SDK **re-executes the DAG child body on replay** (the native child-context path). This is safe and deterministic precisely because of the name-based IDs (§4): re-running the scheduler causes **every task to hit its per-task replay fast-path** and return its still-checkpointed result under `idOf(name)` — nothing re-executes, and `DagResult` is rebuilt in memory identically. This is Java's native equivalent of "design A (reconstruct by re-running the deterministic body)", which for a DAG collapses into a no-op-scheduler pass. The per-task child checkpoints are the reconstruction source, exactly as `map` reconstructs from per-item checkpoints.
3. **STARTED-but-not-terminal tasks at early completion (`completionConfig`):** their checkpoints may have been dropped. On re-execution, a task with no terminal checkpoint that is _not scheduled to run_ (because completion was already reached) is simply recomputed as `SKIPPED`/not-started by the scheduler — the deterministic completion evaluation reproduces the same stop point. No separate `startedTaskNames` envelope field is needed.

**Consequence for `DagConfig.summaryGenerator` (§2.11).** This field has **no native precedent** in the Java SDK. Recommendation: **drop it from v1.** If a human-readable observability string is still desired, it must be documented as a **pure, non-native, observability-only add-on that is never read on replay and never influences results** — and even then it should be emitted via `context.logger`/OTel rather than persisted in a bespoke envelope, to stay consistent with how the Java SDK actually surfaces observability (`DurableLogger`, the `otel-plugin`).

> **[CODE NOTE — net divergence from JS]** JS's §8.1 (`DagSummary`, `summaryGenerator`, `reconstructDagResult`, the #751-avoidance envelope contract) is a JS-specific mechanism that **does not port**. Java gets the same guarantee ("customer text can never corrupt replayed structural results") _for free_ by simply **not having** a customer-writable envelope and relying on the native re-execution/per-task-checkpoint reconstruction. This is a genuine simplification, now grounded in verified SDK behavior rather than assumption.

---

## 9. Concurrency model (Java-specific)

**The DAG scheduler drives concurrency by launching ready tasks through the SDK's `*Async` variants and awaiting their `DurableFuture`s.** The scheduler itself owns no threads and no `ExecutorService`; but — correcting the earlier draft — **`DurableFuture` is _not_ a thread-free abstraction.** Per `docs/design.md`:

- The SDK runs a **threaded execution model**: the handler and each `*Async` operation execute on the **user executor** (`DurableConfig.executorService`; default a cached daemon pool, configurable via `DurableConfig.builder().withExecutorService(...)`). Steps run user code via `CompletableFuture.runAsync(fn, userExecutor)`; child contexts likewise.
- **Suspension** is driven by an **active-thread-count race** in `ExecutionManager`: when a thread calls `get()` on an operation that has not completed, it deregisters; when `activeThreads` becomes empty the whole Lambda suspends (returns `PENDING`) and re-invokes later. A `wait`/callback/invoke inside a task therefore suspends the **entire** execution when nothing else is runnable — and on replay every completed operation returns its checkpointed result via the operation-ID fast path.
- **Determinism does not come from avoiding threads.** It comes from (a) operation-ID-keyed checkpoint/replay (`getOperationAndUpdateReplayState`) and (b) the one-way `ExecutionMode` REPLAY→EXECUTION transition. Real threads are already used throughout `map`/`parallel`/`stepAsync` and are fully compatible with replay.

How the DAG uses this substrate:

- Each ready task is launched with the **`*Async` explicit-ID variant** of its operation — all verified to exist: `stepAsync`, `invokeAsync`, `mapAsync`, `runInChildContextAsync`, `waitAsync`, `waitForCallbackAsync`, `waitForConditionAsync`, plus `parallel()` (branches are inherently concurrent) and nested `dagAsync`. Each returns a `DurableFuture<T>` ([A-J2] adds the explicit-ID seam on top of these).
- The scheduler holds `Map<String, DurableFuture<?>> inFlight` and enforces `maxConcurrency` purely by **deferring the `*Async` call** until a task is ready AND `inFlight.size() < maxConcurrency`. It does not itself create threads — it lets the SDK's user executor back the futures it launches.
- Completion is awaited with `DurableFuture.get()` and aggregated with the SDK-provided statics **`DurableFuture.allOf(...)`** / **`anyOf(...)`** (verified). When a future resolves, the scheduler records the terminal state and re-runs readiness.

> **Why `DurableFuture` and not raw `CompletableFuture` / virtual threads?** Not because threads are forbidden — the SDK is explicitly thread-backed. The reason is that `DurableFuture` is the SDK's **replay-safe, checkpoint-participating** wrapper: its completion is coordinated with the checkpoint response and the suspend/resume machinery, so a fan-out survives interruption and re-invocation. A bare `CompletableFuture` would run the work but would not checkpoint, would not suspend cost-efficiently across `wait`s, and would not replay. Reusing `DurableFuture` means the DAG inherits the exact concurrency + durability substrate the SDK already ships for `map`/`parallel`/`stepAsync` — no new concurrency machinery.

### 9.1 Nested DAG concurrency

Parent `maxConcurrency` limits only top-level tasks; each nested DAG has its own scope/limit (JS §9.2, ported). Nested-dag container gets `DAG_NODE_T_{name}` and recurses.

---

## 10. Per-decision mapping table (Ports / Adapts / Infeasible-deferred)

| #   | JS decision                                                              | Java disposition                     | How                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| a   | `DepsMap` literal-name typed access                                      | **Adapts**                           | `Deps.get(TaskHandle<T>) -> T` accessor keyed by handle (not name-string); optional positional-arity sugar (§2.2, §2.7). Java generics cannot express literal-string keys/heterogeneous maps.                                                                                                                                                      |
| b   | `TaskHandle<TName, TResult>`                                             | **Ports (partial)**                  | `TaskHandle<T>` carries `TResult` via generics fine; the `TName` _literal_ is dropped (Java has no name-as-type) — name is a runtime `String`.                                                                                                                                                                                                     |
| c   | Name-based entity IDs + reserved `DAG_NODE_T_` delimiter + no-dash names | **Ports (normative core)**           | Language-independent; identical injectivity proof (§4). [A-J2] explicit-ID seam **resolved `CAN-BE-ADDED`** — minimal `OperationIdGenerator.operationIdForName` + internal `*AsyncWithId` entry points (§4.3).                                                                                                                                     |
| d   | Trigger rules                                                            | **Ports**                            | `enum TriggerRule` with per-constant `eval()` (§5); truth table verbatim.                                                                                                                                                                                                                                                                          |
| d   | `runIf`                                                                  | **Ports**                            | `Predicate<Deps>` on the builder (§2.6).                                                                                                                                                                                                                                                                                                           |
| e   | Completion-reason core/superset layering                                 | **Adapts**                           | Java can't union enums; define DAG-local `enum DagCompletionReason` (§2.10) as a superset of the 3-member `ConcurrencyCompletionStatus` + `COMPLETED_WITH_FAILURES` (+ reserved `CUSTOM_COMPLETION_*`).                                                                                                                                            |
| e   | Custom completion predicate w/ result-based short-circuit                | **Adapts (defer to v2)**             | [A-J6] **verified**: Java batch has no custom-predicate hook / no `CUSTOM_COMPLETION_*`. Custom completion is net-new either way; v1 ships threshold only (§6 Option B). Option A (DAG-owned `Predicate<DagCompletionSnapshot>`) remains possible later because the scheduler is separate. §6.                                                     |
| f   | SDK-owned summary envelope + design-B reconstruction                     | **Does NOT port ([A-J3] falsified)** | Java has no summary-generator hook / `*Summary` envelope. Large `DagResult` handled by **native child-context re-execution** + **per-task checkpoint reconstruction** (like `map`); customer `summaryGenerator` dropped as non-native (§8.1).                                                                                                      |
| g   | Concurrency model                                                        | **Adapts**                           | `DurableFuture`-driven scheduler: launch ready tasks via `*Async`, await with `DurableFuture.get()`/`allOf`/`anyOf`, enforce `maxConcurrency` by deferring the `*Async` call (§9). **Correction:** `DurableFuture` is thread-backed (user executor); determinism is from op-ID replay + active-thread-count suspension, not from avoiding threads. |
| h   | Heterogeneous task types + nested DAGs                                   | **Ports**                            | All op kinds as tasks via `*Async` explicit-ID variants; `resultKind`-tagged recursive serialization (§8) preserves `MapResult`/`DagResult` instances.                                                                                                                                                                                             |
| —   | Sync-by-default entry + `*Async` twin                                    | **Adapts**                           | `dag()` returns `DagResult`; `dagAsync()` returns `DurableFuture<DagResult>` (JS returns a promise always). Matches `step`/`stepAsync`.                                                                                                                                                                                                            |
| —   | `register` may be async                                                  | **Adapts (drop)**                    | Java `Consumer<DagContext>` is synchronous; compute config before `dag()`.                                                                                                                                                                                                                                                                         |
| —   | `Optional` vs `T                                                         | undefined`                           | **Adapts**                                                                                                                                                                                                                                                                                                                                         | `DagResult`/`TaskExecution` use `Optional<T>`; distinguishes skipped/never-started from `null` success. |
| —   | Config objects                                                           | **Adapts**                           | `DagConfig`/records + `builder()`; reuse existing `StepConfig`/`MapConfig`/etc. verbatim.                                                                                                                                                                                                                                                          |
| —   | Error surfacing (`errorMapper` pass-through)                             | **No hook needed (VERIFIED)**        | `ChildContextFailedException` is thrown only when the original exception can't be reconstructed; reconstructable `RuntimeException` subclasses (incl. `Dag*Exception`) propagate transparently through `runInChildContext` (§7).                                                                                                                   |

---

## 11. Testing outline

Mirror the Java SDK's testing utilities (`sdk-testing`, local runner) and the JS §12 structure:

- **`DagValidatorTest`** (JUnit 5): cycle detection (self-loop, 2-cycle, deep, diamond=no-cycle); invalid names (empty, >100, dash, `DAG_NODE_T_` substring); duplicates across op kinds; missing/foreign-scope deps → `Dag*Exception` assertions via `assertThrows`.
- **`TriggerRuleTest`**: full truth table (§5) × {all-succ, all-fail, mixed, includes-skip, empty} for all six rules (parameterized test).
- **`TaskHandleTest`**: `.reads()`/`.dependsOn()`/`.triggerRule()`/`.runIf()` mutate `TaskDef`; `Deps.get(handle)` returns typed result; `Deps.get` on undeclared handle throws `IllegalStateException`.
- **`DagExecutorTest`** (mock context): readiness/topological order, `maxConcurrency` throttling, skip propagation, `runIf` skip, threshold completion, drain-with-compensation.
- **`DagResultTest`**: typed `getResult(handle)` for succeeded/failed/skipped/not-run (`Optional.empty()`); `throwIfError()` → `DagExecutionException`; serdes round-trip incl. error reconstruction and recursive `MapResult`/`DagResult` restore (no `DagSummary` envelope exists — §8.1).
- **Entity-ID tests**: `DAG_NODE_T_{name}` for prefixed/unprefixed; nested recursion; no collision with counter IDs.
- **Local-runner integration** (`DurableTestRunner`): diamond `A→{B,C}→D` (B,C concurrent via `DurableFuture`); mixed op-type tasks (each appears as its native subtype under a `DAG_NODE_T_`-derived id); compensation (`charge` fails → `refund`/`ALL_FAILED` runs, `fulfill`/`ALL_SUCCESS` skips, `audit`/`ALL_DONE` runs); `runIf` branching; nested DAG scope isolation.
- **Replay tests**: order-independence (force B-before-C then C-before-B; assert identical `DagResult`, no `NonDeterministicExecutionException` — proves name-based IDs); interruption/resume (completed tasks hit fast path, not re-executed — count side effects); skip determinism (no checkpoint); **large-`DagResult` handling** — force an aggregate result ≥ 256KB and assert the DAG child body **re-executes on replay** with every task hitting its per-task checkpoint fast-path (no re-execution of task bodies), reconstructing an identical `DagResult` (the Java-native path; there is no `DagSummary` envelope — §8.1).
- **Verification bar**: `mvn verify` (compile + Spotless + tests) green; type-level correctness enforced by the compiler (no `tsd`-equivalent needed — Java generics are checked at compile time).

---

## 12. Backward compatibility

Pure addition. `DurableContext` gains `dag(...)`/`dagAsync(...)`; no existing type changes. `DagContext`/`TaskHandle`/`DagResult`/`Deps`/`DagConfig` and the `Dag*Exception` classes are new. Existing applications unaffected; `dag()` is strictly opt-in.

---

## Appendix A. Assumptions register (verification status)

Checked against the **real private source** at `aws-durable-execution-sdk-java/sdk/src/main/java/software/amazon/lambda/durable/**` (read line-by-line: `execution/OperationIdGenerator.java`, `model/OperationIdentifier.java`, `operation/{BaseDurableOperation,ChildContextOperation,ConcurrencyOperation,SerializableDurableOperation}.java`, `execution/{ExecutionManager,ExecutionMode}.java`, `context/{DurableContextImpl,BaseContextImpl}.java`, `model/{ConcurrencyCompletionStatus,MapResult,OperationSubType,WaitForConditionResult}.java`, `config/{CompletionConfig,MapConfig,RunInChildContextConfig}.java`, `DurableFuture.java`, `util/ParameterValidator.java`, `exception/ChildContextFailedException.java`). **All assumptions are now resolved against source.**

| ID   | Original assumption                                                             | Status                             | Finding (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-J1 | Java uses per-context monotonic counter IDs, hashed before storage              | ✅ **SOURCE-VERIFIED**             | `OperationIdGenerator` holds `AtomicInteger operationCounter` + `operationIdPrefix = contextId+"-"`; `nextOperationId()` = `hashOperationId(prefix+counter)` (SHA-256). One generator per context in `DurableContextImpl:59,66`. `OperationIdGenerator.java:12-13,20-47`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| A-J2 | An explicit-ID seam exists/can be added (Java analog of `createStepId`)         | ✅ **RESOLVED · `CAN-BE-ADDED`**   | Caller-supplied-ID path already threaded through the whole stack — opaque `OperationIdentifier.operationId` (`OperationIdentifier.java:16-24`); ID-agnostic `BaseDurableOperation` (`:56-92,155,298-330`); `ExecutionManager` keys by string only (`:98-101,207-217`); child ctx runs under `getOperationId()` (`ChildContextOperation.java:118-135`); precedent `ConcurrencyOperation.java:73-86,96-118,137`. Counter coupled at one line/method in `DurableContextImpl` (`:335`). **Minimal change:** add `OperationIdGenerator.operationIdForName(String)` + internal `*AsyncWithId` variants on `DurableContextImpl`; **zero** changes to operations/ExecutionManager/replay. §4.3. |
| A-J3 | `runInChildContext` has large-payload split + summary hook + replay-mode signal | ❌ **FALSIFIED (source-verified)** | No summary hook / envelope. Large results: **re-execution** of child (`ChildContextOperation.java:39,88-107,150-176`, `replayChildren` + `ContextOptions.replayChildren(true)`), **per-item checkpoint reconstruction** for map. `RunInChildContextConfig` exposes only `serDes`. §8.1 rewritten; `summaryGenerator` dropped.                                                                                                                                                                                                                                                                                                                                                           |
| A-J4 | Child-context replay mode determined independently per child                    | 🔧 **REFINED (source-verified)**   | Execution-global `ExecutionMode` REPLAY→EXECUTION one-way (`ExecutionManager.java:207-217`, `ExecutionMode.java`); _also_ a per-context one-way `isReplaying` flag (`BaseContextImpl.java:41`, `setExecutionMode()`). Both monotone; does not block the design.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A-J5 | `DurableFuture` completion is SDK-scheduler-driven (not customer-threaded)      | 🔧 **CORRECTED (source-verified)** | `DurableFuture` is **thread-backed**: `runUserHandler` → `CompletableFuture.runAsync(wrapped, durableConfig.getExecutorService())` (`BaseDurableOperation.java:~230-260`); suspension via active-thread-count race (`ExecutionManager.deregisterActiveThread` → `suspendExecution` when empty). §9 rewritten. Scheduler controls concurrency by deferring the `*Async` call. `DurableFuture.allOf/anyOf` verified (`DurableFuture.java:36-77`).                                                                                                                                                                                                                                         |
| A-J6 | Completion status enum is closed at 3 members; no customer predicate seam       | ✅ **SOURCE-VERIFIED**             | `ConcurrencyCompletionStatus` = exactly 3 members (`ConcurrencyCompletionStatus.java:6-9`); `CompletionConfig` factory-only, 6 factories (`CompletionConfig.java:15-52`); `ConcurrencyOperation.canComplete` hardcodes the 3 outcomes — no predicate hook. ⇒ defer custom completion to v2 (§6 Option B).                                                                                                                                                                                                                                                                                                                                                                               |

**Pre-implementation work — CLEARED.** [A-J2] is resolved as `CAN-BE-ADDED`: the seam is already present in `operation/BaseDurableOperation.java`, `execution/ExecutionManager.java`, `model/OperationIdentifier.java`, and `operation/ChildContextOperation.java` (all accept/thread a caller-controlled opaque `operationId`); the base SDK needs only (1) `OperationIdGenerator.operationIdForName(String)` and (2) internal explicit-ID `*AsyncWithId` entry points on `DurableContextImpl` that mirror the existing methods minus the `nextOperationId()` call — a bounded, additive change touching two files, with no modification to the operation, execution-manager, replay-validation, or serde layers. All other assumptions are resolved above.

---

## Appendix B. Review resolutions (java_review — loop iteration 1)

| #   | Severity | Finding                                                                                                                                                                                                                                             | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MAJOR    | Inline-dep declaration inconsistent: §2.3 omitted the method; §3 used `.reads(...)` while §2.12 used `.dependsOnTyped(...)`; §2.12 prose implied closure introspection; flagship example never declared `c`'s inline deps ⇒ would throw at runtime. | **Fixed.** Added `reads(TaskHandle<?>... deps)` to the §2.3 `TaskHandle` interface; standardized the name on `.reads(...)` everywhere (removed `.dependsOnTyped`); rewrote the §2.12 prose to state inline deps must be **declared explicitly** (no closure introspection); added `.reads(a, b)` to task `c` in the flagship example so it is consistent with the §3 runtime guard.                                                                                                          |
| 2   | MINOR    | §2.4 map overloads asymmetric (static-`Collection` had no-config only; deps-producer had config only).                                                                                                                                              | **Fixed.** Provided the full 2×2 matrix: `{Collection, Function<Deps,Collection>} × {no-config, config}`.                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | MINOR    | "`toleratedFailurePercentage` not supported by parallel" flagged as unverified/likely-wrong.                                                                                                                                                        | **Refuted with evidence (claim retained).** `docs/core/parallel.md` states verbatim _"`toleratedFailurePercentage` is not supported for parallel operations."_ The original claim was correct; §6 now cites the source and marks it VERIFIED rather than dropping it.                                                                                                                                                                                                                        |
| 4   | MINOR    | §0/§2.5 presented inferred native types as verified (callback submitter, waitForCondition context, parallel shapes).                                                                                                                                | **Fixed with verification.** `docs/design.md` confirms: callback submitter is `BiConsumer<String,StepContext>` (§0 corrected); waitForCondition check is `BiFunction<T,StepContext,WaitForConditionResult<T>>` — **there is no `WaitForConditionContext` type**, so §2.5 `DagConditionFunction` now uses `StepContext` and §2.4 uses `WaitForConditionConfig<S>`. `docs/core/parallel.md` confirms `.branch(...)→DurableFuture<T>` / `.get()→ParallelResult`, so those are labeled verified. |
| 5   | MINOR    | §2.9 `throwIfError` referenced `CUSTOM_COMPLETION_FAILED`, unreachable under §6 Option B.                                                                                                                                                           | **Fixed.** Annotated the clause as inert unless Option A ships; the method keys off `failureCount`.                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | MINOR    | §7 "propagate unchanged" overstated reconstruction fidelity.                                                                                                                                                                                        | **Fixed.** Softened to: reconstruction preserves **type + message** (needs classpath + serializable error data); **custom fields are not guaranteed to survive**; diagnostic detail that must survive replay should be carried in the message; falls back to `ChildContextFailedException` when unreconstructable.                                                                                                                                                                           |

Also cleaned a stale `DagSummary` reference in the §11 `DagResultTest` bullet (the envelope was removed in §8.1 per [A-J3]).

---

## Appendix C. Java readiness verdict (source-grounded)

**Ready to implement — yes, with one small, additive base-SDK change first.** The entire replay-safety design rests on [A-J2], now resolved as **`CAN-BE-ADDED`**: the caller-supplied-ID path is _already_ threaded through the whole operation/execution stack (opaque `OperationIdentifier.operationId`; ID-agnostic `BaseDurableOperation` + `ExecutionManager` + `validateReplay`; child contexts already run under a supplied ID; `ConcurrencyOperation` already runs children under an explicit prefix). The **only** base-SDK addition required is (1) `OperationIdGenerator.operationIdForName(String)` (name→id, reusing the existing prefix+SHA-256) and (2) internal `*AsyncWithId` entry points on `DurableContextImpl` that mirror the existing `*Async` methods minus the counter call — a bounded change to **two files**, with **zero** changes to operations, execution manager, replay validation, or serde. Everything else (threading/`DurableFuture`, 3-member completion enum, transparent error reconstruction, native large-result re-execution) is verified as-is; the DAG surface (`Deps.get(handle)`, typed `TaskHandle<T>`, reused `StepConfig`/`MapResult`/`ParallelResult`/`TypeToken`) matches the real SDK types. v1 defers only custom completion (§6 Option B).
