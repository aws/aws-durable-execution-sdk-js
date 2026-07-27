# DAG Support (`context.dag()`) — Java Implementation Specification

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until it is promoted to stable.
>
> **API annotation (Java).** Every public DAG type and method is annotated `@software.amazon.lambda.durable.annotations.Experimental` (`@Retention(CLASS)`, `@Documented`) and carries a Javadoc `@apiNote`:
>
> ```java
> /**
>  * Declares and runs a DAG of tasks. ...
>  *
>  * @apiNote <b>Experimental.</b> This API is experimental and may be changed
>  *          or removed in future releases without a major-version bump.
>  */
> @Experimental
> DagResult dag(String name, Consumer<DagContext> register, DagConfig config);
> ```

Stability: **Experimental** · Target: `aws-durable-execution-sdk-java` (`software.amazon.lambda.durable`) · Canonical semantics source: [`DAG_SPEC.md`](./DAG_SPEC.md) (JS/TS)

> This document specifies the AWS Lambda Durable Execution **Java** DAG surface. The [JS/TS spec](./DAG_SPEC.md) is the source of truth for _semantics_; this document defines the _idiomatic Java surface_ that preserves the normative core (name-based entity IDs, reserved delimiter, trigger rules, `runIf`, replay-safe reconstruction) while expressing it in Java's type system and concurrency model. See [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md) for the shared normative core and the per-language divergence matrix; the Java-specific sections here conform to its checkpoint-visible envelope contract (§2 of that doc).

---

## 0. Java SDK primitives the DAG builds on

The DAG surface lives in `software.amazon.lambda.durable.dag` and reuses the SDK's existing operation, config, and concurrency primitives verbatim. The primitives it composes:

| Concern                | Java surface                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler                | `abstract class DurableHandler<I, O>` → `O handleRequest(I input, DurableContext ctx)`                                                                                                                           |
| Package                | `software.amazon.lambda.durable`                                                                                                                                                                                 |
| Step                   | `<T> T step(String name, Class<T>\|TypeToken<T> type, StepFunction<T> fn[, StepConfig])`; `stepAsync(...)` → `DurableFuture<T>`                                                                                  |
| Wait                   | `void wait(String name, Duration duration)`                                                                                                                                                                      |
| Invoke                 | `<T> T invoke(String name, String functionName, Object payload, Class<T> type[, InvokeConfig])`; `invokeAsync(...)`                                                                                              |
| Callback               | `<T> T waitForCallback(String name, Class<T> type, BiConsumer<String, StepContext> submitter[, WaitForCallbackConfig])`                                                                                          |
| Child context          | `<T> T runInChildContext(String name, ChildFunction<T> fn[, ...])`                                                                                                                                               |
| Map                    | `<I, O> MapResult<O> map(String name, Collection<I> items, Class<O>\|TypeToken<O> type, MapFunction<I, O> fn[, MapConfig])`; `MapFunction<I, O>` = `O apply(I item, int index, DurableContext ctx)` (item-first) |
| Parallel               | `ParallelDurableFuture parallel(String name[, ParallelConfig])`; `.branch(String name, Class<T> type, BranchFunction<T> fn)` → `DurableFuture<T>`; `.get()` → `ParallelResult`                                   |
| Wait-for-condition     | `<T> T waitForCondition(String name, Class<T>\|TypeToken<T> type, BiFunction<T, StepContext, WaitForConditionResult<T>> check[, WaitForConditionConfig<T>])`                                                     |
| Concurrency            | `DurableFuture<T>` — a durable, replay-safe future returned by every `*Async`/branch call; `.get()` blocks and may suspend the execution. Statics `DurableFuture.allOf(...)`/`anyOf(...)` aggregate.             |
| Result typing          | `Class<T>` (simple) and `TypeToken<T>` (parameterized, `new TypeToken<List<X>>(){}`) — reified type tokens for erasure-safe serde                                                                                |
| Config                 | Builders: `StepConfig.builder()`, `MapConfig.builder()`, `ParallelConfig.builder()`, `InvokeConfig.builder()`, `WaitForCallbackConfig.builder()`, `RunInChildContextConfig.builder()`                            |
| Completion             | `CompletionConfig.allCompleted()/allSuccessful()/firstSuccessful()/minSuccessful(n)/toleratedFailureCount(n)/toleratedFailurePercentage(p)`                                                                      |
| Completion status enum | `ConcurrencyCompletionStatus { ALL_COMPLETED, MIN_SUCCESSFUL_REACHED, FAILURE_TOLERANCE_EXCEEDED }` (three members)                                                                                              |
| Batch result           | `MapResult<O>` / `MapResultItem<O>` / `MapError`; item status `SUCCEEDED\|FAILED\|SKIPPED`                                                                                                                       |
| Exceptions             | Rich hierarchy rooted at `DurableExecutionException` (a `RuntimeException`), with `DurableOperationException` for operation errors; see §7                                                                       |
| Runtime                | Java 17+ — records and sealed interfaces are used throughout                                                                                                                                                     |

The concurrency substrate is thread-backed: the handler and each `*Async` operation run on the user executor (`DurableConfig.executorService`; a cached daemon pool by default, configurable via `DurableConfig.builder().withExecutorService(...)`). Suspension is driven by an active-thread-count race in `ExecutionManager` — when no thread is runnable the execution suspends and re-invokes later. Determinism comes from operation-ID-keyed checkpoint/replay and the one-way `ExecutionMode` REPLAY→EXECUTION transition, not from avoiding threads. `DurableFuture` is the replay-safe, checkpoint-participating wrapper over that substrate, and it is the fan-out primitive the DAG uses (§9).

---

## 1. Overview

`ctx.dag(...)` is a first-class primitive for declaring a **directed acyclic graph of tasks** with typed dependencies. A DAG is described once in a declarative _registration phase_ (a `Consumer<DagContext>`); the runtime then schedules tasks topologically, runs independent chains concurrently via `DurableFuture`, evaluates per-task trigger rules and `runIf` predicates, and aggregates results into a `DagResult`.

A DAG is a **child context** — one `runInChildContext` node in the parent's operation tree — whose body runs a **name-based scheduler**. Each task delegates to the **same operation machinery** the equivalent `DurableContext` method uses; the only difference is that a task's entity ID is derived from its **name** (`{parentId}-DAG_NODE_T_{name}`) rather than from the monotonic operation counter. That is the property that makes arbitrary graph shapes replay-safe.

### 1.1 Motivation

Counter-based operation IDs are assigned at operation _start_. `map`/`parallel` are replay-safe because their items start in deterministic index order. In an arbitrary DAG a downstream task starts when its upstream dependencies _complete_, and completion order can vary across replays — so counter-based IDs would diverge and trip the replay-consistency guard (`NonDeterministicExecutionException`). Name-based IDs (§4) remove the dependence on completion order: a task's ID is a pure function of its name and DAG-context prefix, so it is identical on every replay.

### 1.2 Goals / Non-goals

**Goals:** declarative typed data-flow; replay-safety for any graph shape; reuse of the existing checkpoint/replay/retry/serdes machinery; per-task `triggerRule` and `runIf`; heterogeneous task kinds and nested DAGs; a pure additive surface. **Non-goals:** a dedicated branch operator, dynamic task creation, cross-task semaphores, pre-built operators/cron/UI.

---

## 2. Public API

New public types live in `software.amazon.lambda.durable.dag`. Only `DurableContext.dag(...)` / `dagAsync(...)` are added to the existing interface.

### 2.1 Entry point (`DurableContext`)

```java
DagResult dag(String name, Consumer<DagContext> register);
DagResult dag(String name, Consumer<DagContext> register, DagConfig config);

DurableFuture<DagResult> dagAsync(String name, Consumer<DagContext> register);
DurableFuture<DagResult> dagAsync(String name, Consumer<DagContext> register, DagConfig config);
```

`register` is **registration-only**: tasks are _declared_ but do not execute until it returns. Consistent with the SDK's sync-by-default-with-an-`*Async`-twin convention (`step`/`stepAsync`, `map`/`mapAsync`), `dag(...)` blocks and returns `DagResult`, while `dagAsync(...)` returns `DurableFuture<DagResult>`.

Registration is a plain synchronous `Consumer<DagContext>` — it is pure graph-building with no asynchronous need. Configuration that must be computed asynchronously is computed _before_ calling `dag()`.

### 2.2 Typed dependencies — `Deps` keyed by handle

Java generics cannot express the JS `DepsMap<TDeps>` mapped type, which keys result access on literal task-name string types. The Java surface instead uses a typed `TaskHandle<T>` plus a `Deps` accessor keyed by the handle (not by a name-string). A task's function receives a `Deps` object and reads an upstream result by passing that upstream's handle, which carries the result type via generics:

```java
public interface Deps {
    /**
     * Returns the checkpointed result of an upstream inline dependency as an Optional.
     * The result is Optional.empty() whenever the upstream did not produce a success value
     * (it FAILED or was SKIPPED) — possible under non-ALL_SUCCESS trigger rules. On the default
     * ALL_SUCCESS trigger rule the value is always present, so callers may unwrap with orElseThrow().
     * Throws IllegalStateException if the handle was not declared as an inline dependency
     * of this task via reads(...).
     */
    <T> Optional<T> get(TaskHandle<T> handle);
}
```

`deps.get(fetchHandle)` returns exactly `fetchHandle`'s `T`, wrapped in `Optional`. This is the direct Java analog of the JS spec's `DepsAccessor.getResult(TaskHandle<T>)` fallback, and it matches the ergonomics Java developers already know from `parallel().branch(...).get()`.

> **Type-soundness.** `<T> Optional<T> get(TaskHandle<T> handle)` is the standard **typed-key heterogeneous container** pattern (`ClassToInstanceMap<T>`, Netty `AttributeKey<T>`, gRPC `Context.Key<T>`). Internally, results are stored in a map keyed by `handle.name()`, and `get` performs one contained, provably-safe unchecked cast to `T` because the `(handle → result type)` binding is fixed at registration and handles are unique per task — no unchecked warning or `ClassCastException` risk reaches the caller. This is the same reified-type discipline the SDK already uses via `TypeToken<T>` for serde.

> **Why not positional-arity `zip`.** A positional overload (`.after(a, b) -> (A, B) -> R`, à la Reactor `Mono.zip`) is offered only as optional sugar (§2.7): it caps at a fixed arity, degrades to `Object[]`/tuples past that, does not compose with the ordering-only-deps distinction, and forces a different call shape per dependency count. `Deps.get(handle)` is the canonical, arity-unbounded form.

### 2.3 `TaskHandle<T>`

A registration-time reference and builder. It carries the result type `T` via generics; the task name is a runtime `String`, not a type-level literal.

```java
public interface TaskHandle<T> {
    /** Task name (runtime string; not a type-level literal). */
    String name();

    /** Inline (typed) deps: wait for these AND receive their results via Deps.get(...).
     *  Only handles declared here are retrievable in this task's fn (§3). */
    TaskHandle<T> reads(TaskHandle<?>... deps);

    /** Ordering-only deps: wait for these but do not receive their results in Deps. */
    TaskHandle<T> after(TaskHandle<?>... deps);

    /** Trigger rule (default from DagConfig.defaultTriggerRule, else ALL_SUCCESS). */
    TaskHandle<T> triggerRule(TriggerRule rule);

    /** Conditional-skip predicate over resolved upstream results (§2.6). */
    TaskHandle<T> runIf(Predicate<Deps> predicate);
}
```

Builder methods return `this` for fluent chaining, e.g. `d.step(...).after(a).triggerRule(TriggerRule.ALL_DONE)`, matching the fluent `parallel().branch(...)` and `*Config.builder()` styles. The handle's in-memory identity — not its name — is the scheduler's key, and it is never serialized.

### 2.4 `DagContext` — declarative task registration

A separate interface (it does **not** extend `DurableContext`), so only declarative task methods are visible inside `register`. Each method registers one task and returns a `TaskHandle<T>`; result typing uses the SDK's existing `Class<T>` / `TypeToken<T>` convention.

```java
public interface DagContext {

    // ── step ──────────────────────────────────────────────────────────────────
    <T> TaskHandle<T> step(String name, Class<T> type, DagStepFunction<T> fn);
    <T> TaskHandle<T> step(String name, TypeToken<T> type, DagStepFunction<T> fn);
    <T> TaskHandle<T> step(String name, Class<T> type, DagStepFunction<T> fn, StepConfig config);
    <T> TaskHandle<T> step(String name, TypeToken<T> type, DagStepFunction<T> fn, StepConfig config);

    // ── step: positional-arity typed-deps sugar (§2.7) ──────────────────────────
    <A, T>       TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, DagStep1Function<A, T> fn);
    <A, B, T>    TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, TaskHandle<B> b, DagStep2Function<A, B, T> fn);
    <A, B, C, T> TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, TaskHandle<B> b, TaskHandle<C> c, DagStep3Function<A, B, C, T> fn);

    // ── invoke ─────────────────────────────────────────────────────────────────
    <T> TaskHandle<T> invoke(String name, String functionName, Class<T> type, DagPayloadFunction payloadFn);
    <T> TaskHandle<T> invoke(String name, String functionName, Class<T> type, DagPayloadFunction payloadFn, InvokeConfig config);

    // ── callback (submitter-based) ───────────────────────────────────────────────
    <T> TaskHandle<T> callback(String name, Class<T> type, DagCallbackSubmitter submitter);
    <T> TaskHandle<T> callback(String name, Class<T> type, DagCallbackSubmitter submitter, WaitForCallbackConfig config);

    // ── wait ────────────────────────────────────────────────────────────────────
    TaskHandle<Void> wait(String name, Duration duration);

    // ── waitForCondition ──────────────────────────────────────────────────────────
    <S> TaskHandle<S> waitForCondition(String name, Class<S> type, DagConditionFunction<S> check, WaitForConditionConfig<S> config);

    // ── runInChildContext ─────────────────────────────────────────────────────────
    <T> TaskHandle<T> runInChildContext(String name, Class<T> type, DagChildFunction<T> fn);
    <T> TaskHandle<T> runInChildContext(String name, TypeToken<T> type, DagChildFunction<T> fn);

    // ── map ───────────────────────────────────────────────────────────────────────
    // MapFunction<I, O> is the existing SDK type `O apply(I item, int index, DurableContext ctx)`
    // (item-first, no Deps). Upstream data enters a map task via the Function<Deps, Collection<I>>
    // items-producer overload. `items` must have deterministic iteration order (List/LinkedList/TreeSet).
    <I, O> TaskHandle<MapResult<O>> map(String name, Collection<I> items, Class<O> type, MapFunction<I, O> fn);
    <I, O> TaskHandle<MapResult<O>> map(String name, Collection<I> items, Class<O> type, MapFunction<I, O> fn, MapConfig config);
    <I, O> TaskHandle<MapResult<O>> map(String name, Function<Deps, Collection<I>> items, Class<O> type, MapFunction<I, O> fn);
    <I, O> TaskHandle<MapResult<O>> map(String name, Function<Deps, Collection<I>> items, Class<O> type, MapFunction<I, O> fn, MapConfig config);

    // ── parallel ──────────────────────────────────────────────────────────────────
    // Branches are declared against the SDK's existing ParallelDurableFuture (reused verbatim, no new
    // builder type): the scheduler launches the parallel future and applies the consumer to it.
    TaskHandle<ParallelResult> parallel(String name, Consumer<ParallelDurableFuture> branches);
    TaskHandle<ParallelResult> parallel(String name, Consumer<ParallelDurableFuture> branches, ParallelConfig config);

    // ── nested dag ─────────────────────────────────────────────────────────────────
    TaskHandle<DagResult> dag(String name, Consumer<DagContext> register);
    TaskHandle<DagResult> dag(String name, Consumer<DagContext> register, DagConfig config);
}
```

`StepConfig`, `InvokeConfig`, `WaitForCallbackConfig`, `WaitForConditionConfig`, `MapConfig`, `ParallelConfig`, `MapFunction`, `MapResult`, `ParallelResult`, `ParallelDurableFuture`, `TypeToken`, and `Duration` are the **existing** Java SDK types, reused verbatim so per-task retry/serdes/semantics are identical to standalone operations.

### 2.5 Task functional interfaces (deps-first rule)

Every DAG task function takes a `Deps` as its first parameter, uniformly — even for root tasks, where `Deps` is empty and `get()` on any non-declared handle throws. A single non-conditional signature is the idiomatic Java choice (Java cannot express JS's conditional zero-arg-when-`deps:[]` signatures, and overloading on erased functional interfaces is ambiguous).

```java
@FunctionalInterface public interface DagStepFunction<T>     { T apply(Deps deps, StepContext ctx); }
@FunctionalInterface public interface DagPayloadFunction      { Object apply(Deps deps); }
@FunctionalInterface public interface DagCallbackSubmitter    { void apply(Deps deps, String callbackId, StepContext ctx); }
@FunctionalInterface public interface DagConditionFunction<S> { WaitForConditionResult<S> apply(Deps deps, S state, StepContext ctx); }
@FunctionalInterface public interface DagChildFunction<T>     { T apply(Deps deps, DurableContext childCtx); }
```

Each interface's non-`Deps` parameters preserve the native shape of the underlying operation: step `StepContext ctx`; callback `(String callbackId, StepContext ctx)` (native `BiConsumer<String, StepContext>`); waitForCondition `(S state, StepContext ctx)` returning `WaitForConditionResult<S>` (native `BiFunction<S, StepContext, WaitForConditionResult<S>>`); child `DurableContext`. Per-operation behavior is therefore unchanged — the DAG only prepends `Deps`. The polling/backoff strategy for `waitForCondition` comes from the native `WaitForConditionConfig`, not from the function.

### 2.6 `runIf` and the non-`ALL_SUCCESS` typing caveat

`runIf` is a `Predicate<Deps>`, synchronous and deterministic (async predicates would invite non-deterministic IO on replay). It is evaluated **after** the trigger rule passes and **before** the operation runs; `false` ⇒ the task is `SKIPPED` with `skipReason = RUN_IF_PREDICATE`. A `runIf` predicate that _throws_ aborts the DAG with `DagPredicateException` rather than recording a failure (§5.4, §7) — a throw is a defect in deterministic code, not a business outcome.

Under trigger rules other than `ALL_SUCCESS`, an upstream can be `FAILED` or `SKIPPED` and still let this task run, so `deps.get(handle)` returns `Optional.empty()` in that case. On the common `ALL_SUCCESS` path the value is always present, so callers may unwrap with `.orElseThrow()`.

### 2.7 Positional-arity typed-deps sugar

For the common 1–3 typed-dependency case, `DagContext` ships typed convenience overloads that avoid the `Deps` accessor:

```java
<A, T>       TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, DagStep1Function<A, T> fn);
<A, B, T>    TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, TaskHandle<B> b, DagStep2Function<A, B, T> fn);
<A, B, C, T> TaskHandle<T> step(String name, Class<T> type, TaskHandle<A> a, TaskHandle<B> b, TaskHandle<C> c, DagStep3Function<A, B, C, T> fn);
```

Each overload desugars to `step(...).reads(...)` and passes each upstream result to the body directly, unwrapping the `Optional` with `orElse(null)` — so a body reached under a non-`ALL_SUCCESS` trigger rule with a non-succeeded upstream receives `null` for that argument. This is additive sugar backed by the `@Experimental` `DagStep1Function`/`DagStep2Function`/`DagStep3Function` interfaces; `Deps.get(handle)` (via `.reads(...)`) remains the arity-unbounded canonical form for more than three dependencies, ordering-only edges, or explicit `Optional` handling.

### 2.8 `TriggerRule`, `TaskStatus`, `SkipReason`

Java enums (JS uses string-literal unions):

```java
public enum TriggerRule { ALL_SUCCESS, ALL_FAILED, ALL_DONE, ANY_SUCCESS, ANY_FAILED, NONE_FAILED }
public enum TaskStatus  { SUCCEEDED, FAILED, SKIPPED, STARTED }
public enum SkipReason  { TRIGGER_RULE, RUN_IF_PREDICATE }
```

The default trigger rule is `ALL_SUCCESS` (or `DagConfig.defaultTriggerRule`). `TriggerRule` is a pure value type; the scheduler's `TriggerRuleEvaluator` applies the truth function, including the empty-upstream/vacuous case for roots. The truth table is ported verbatim from JS §5.3 (§5).

### 2.9 `DagResult` and `TaskExecution`

```java
public record TaskExecution<T>(
    String name,
    TaskStatus status,
    Optional<SkipReason> skipReason,   // present only when status == SKIPPED
    Optional<T> result,                // present only when status == SUCCEEDED
    Optional<DagTaskError> error,      // present only when status == FAILED
    Optional<Instant> startedAt,       // backend-recorded operation timestamp; empty when unknown (e.g. a skip)
    Optional<Instant> completedAt
) {}

public interface DagResult {
    /** Typed result by handle. Empty if the task was skipped, never started, or did not succeed. */
    <T> Optional<T> getResult(TaskHandle<T> handle);
    /** Untyped result by name. */
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
    /** Number of registered tasks; fixed at registration, independent of early completion. */
    int totalCount();

    DagCompletionReason completionReason();

    /** Tasks launched but not terminal when the DAG stopped early (bounded by maxConcurrency);
     *  empty on a full drain. These are excluded from results(). */
    List<String> startedTaskNames();
    /** Names of the failed() tasks, in registration order. */
    default List<String> failedTaskNames() { return failed().stream().map(TaskExecution::name).toList(); }

    /** Throws DagExecutionException if failureCount() > 0. */
    void throwIfError();
}
```

`TaskExecution.startedAt`/`completedAt` are sourced from each task's backend-recorded operation timestamps, so they are stable and deterministic across replay (a scheduler-side wall clock would recompute on re-run). A skipped task checkpoints no operation and therefore has empty timings.

`DagResult` uses `Optional<T>` throughout rather than JS's `T | undefined`, matching modern Java conventions and distinguishing a skipped/never-started task (absent) from a genuine `null` success value. `getResult`/`getStatus` resolve by `handle.name()`; a never-started task is absent from `results()`, so `getStatus(name)` disambiguates it from a settled task. `throwIfError()` keys off `failureCount()`, not the completion reason.

`DagTaskError` is a serializable record (`errorType`, `errorMessage`, `stackTrace`, plus an optional non-serialized reconstructed `cause`). It serializes to the cross-language canonical error-object shape — PascalCase `ErrorType` / `ErrorMessage` / `StackTrace` (`StackTrace` is `null` when unavailable). `errorType` carries the thrown exception's fully qualified class name (built via `DagTaskError.of(Throwable)`).

### 2.10 `DagCompletionReason`

Java cannot union enums, so `DagCompletionReason` is a dedicated DAG-local enum that is a conceptual superset of the base SDK's 3-member `ConcurrencyCompletionStatus`:

```java
public enum DagCompletionReason {
    ALL_COMPLETED,               // default drain: every reachable task succeeded or was skipped
    COMPLETED_WITH_FAILURES,     // default drain: the graph fully drained but >= 1 task FAILED
    MIN_SUCCESSFUL_REACHED,      // early completion via completionConfig
    FAILURE_TOLERANCE_EXCEEDED   // early completion via completionConfig
}
```

Semantics match JS: a default drain distinguishes clean (`ALL_COMPLETED`) from drained-with-failures (`COMPLETED_WITH_FAILURES`), so the reason itself disambiguates and `throwIfError()` keys off `failureCount()`. Custom-predicate completion is deferred to v2 (§6), so no `CUSTOM_COMPLETION_*` members are defined. The string values of the shared members are identical across SDKs, which is what keeps checkpoints diagnosable cross-language (cross-language doc §2.A.3).

### 2.11 `DagConfig`

```java
public record DagConfig(
    Optional<Integer> maxConcurrency,          // default 40; must be >= 1 if present
    Optional<DagCompletionConfig> completionConfig,
    Optional<TriggerRule> defaultTriggerRule,   // default ALL_SUCCESS
    Optional<SerDes> serDes                     // custom serializer for the aggregate DagResult
) {
    public static Builder builder() { ... }
}
```

Built via `DagConfig.builder()`, matching the SDK's pervasive builder style. `maxConcurrency` must be `>= 1` if present (validated in both the compact constructor and the builder, throwing `IllegalArgumentException`); when unset the DAG scheduler defaults to `40` (`DagExecutor.DEFAULT_MAX_CONCURRENCY`). `maxConcurrency` bounds the DAG scheduler's top-level tasks only — it is not inherited by a task's own internal fan-out: a `map` or `parallel` task keeps its own unlimited default unless configured, and a nested `dag` gets its own independent default of 40. An explicit value always wins, including one above the default.

There is deliberately no `summaryGenerator` field. The DAG container checkpoints a single SDK-owned envelope that is readable on its own (§8, §8.1), so no customer-supplied string is ever written into a payload the SDK parses back on replay.

### 2.12 Two ways to declare dependencies

```java
ctx.dag("etl", d -> {
    var a = d.step("a", A.class, (deps, s) -> fetchA());              // root: empty Deps
    var b = d.step("b", B.class, (deps, s) -> fetchB());
    var c = d.step("c", C.class, (deps, s) ->                          // inline deps => typed access
                process(deps.get(a).orElseThrow(), deps.get(b).orElseThrow()))
             .reads(a, b);                                             // declare inline (typed) deps
    d.step("notify", Void.class, (deps, s) -> notifyDone())
             .after(c);                                                // ordering-only: waits for c, no result access
});
```

Inline dependencies are declared explicitly via `.reads(...)`; only those handles are retrievable via `Deps.get(...)` inside the function. `.after(...)` adds ordering-only edges (scheduling, trigger-rule evaluation, and cycle detection only — not `Deps`). Because Java cannot introspect a lambda body to discover which handles it reads, a task's inline dependencies must be declared on the builder so the scheduler knows the full graph without executing the body; passing an undeclared handle to `Deps.get(...)` throws `IllegalStateException` (§3).

---

## 3. Registration mechanics & the explicit-inline-deps rule

Java requires inline dependencies to be declared explicitly on the builder, and only declared handles are retrievable via `Deps.get`. The canonical, statically-analyzable form:

```java
var c = d.step("c", C.class, (deps, s) -> process(deps.get(a).orElseThrow(), deps.get(b).orElseThrow()))
         .reads(a, b);   // inline (typed) deps: retrievable via Deps.get
```

- `.reads(TaskHandle<?>... deps)` — declares **inline** deps: they gate scheduling AND are retrievable via `Deps.get`. Runtime guard: `Deps.get(h)` throws `IllegalStateException` if `h` was not declared via `.reads(...)`.
- `.after(TaskHandle<?>... deps)` — declares **ordering-only** deps: they gate scheduling but are NOT retrievable via `Deps`.

Each registered task is recorded as an internal `TaskHandleImpl` that stores both dependency sets and a `TaskExecutor` closure binding the operation kind and the deps-first rule:

| Field                             | Source                          | Drives                                                                  |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `inlineDeps`                      | `.reads(...)`                   | `Deps` construction (typed result access)                               |
| `allDeps` (`inlineDeps ∪ .after`) | `.reads(...)` and `.after(...)` | Readiness, trigger-rule status, cycle detection, missing-dep validation |

`Deps` for a task is built from an **immutable per-task snapshot** of its inline dependencies' terminal executions, taken by the scheduler at launch time (all inline deps are terminal before launch). The snapshot is private to the task, so a body's `deps.get(...)` calls — which run on user-executor threads — never race the scheduler thread's writes to its live results map.

A deps-in-signature form (`d.step("c", C.class, List.of(a, b), (deps, s) -> ...)`) was considered but not adopted as canonical: it fixes an awkward `List<TaskHandle<?>>` parameter into every overload and reads worse than the fluent `.reads(...)`/`.after(...)` pair. The positional-arity sugar (§2.7) is the escape hatch for callers who want the dependencies and their types inline.

---

## 4. Entity-ID strategy & replay correctness

IDs are opaque strings, hashed before checkpoint storage; a task's ID is `{parentId}-DAG_NODE_T_{name}`.

### 4.1 Name-based task IDs

```
context.dag(...) child context:   1-2
  task "fetch_data":              1-2-DAG_NODE_T_fetch_data
  nested dag "validation":        1-2-DAG_NODE_T_validation
    sub-task "rule_a":            1-2-DAG_NODE_T_validation-DAG_NODE_T_rule_a
```

The scheduler mints a task's ID via `DurableContextImpl.operationIdForName("DAG_NODE_T_" + name)`, which applies the context's existing prefix-plus-hash discipline (the same one used for counter IDs) to a caller-supplied name suffix instead of the monotonic counter. Java re-hashes at each child-context boundary, so a nested sub-task's `parentId` is the parent DAG container's already-hashed id.

### 4.2 Charset rules (normative core)

- Name pattern `^[a-zA-Z0-9_]+$`, non-empty, ≤ 100 chars. **No `-`** (dash is structural-only in IDs).
- Name MUST NOT contain the reserved sequence `DAG_NODE_T_` (defense-in-depth).

The base SDK's operation-name validation is looser (any printable ASCII up to 256 chars, `-` allowed). The DAG's `^[a-zA-Z0-9_]+$` / ≤100 / no-`DAG_NODE_T_` rule is a stricter DAG-layer constraint enforced additionally at registration by `DagValidator`, raising `DagInvalidTaskNameException`. Because Java re-hashes per level, per-level charset injectivity plus hash collision-resistance (SHA-256) is the load-bearing injectivity guarantee, and the no-dash / no-`DAG_NODE_T_` rules are defense-in-depth and debug hygiene (greppable IDs, cross-language name parity). See cross-language doc §2.A.2 for the full injectivity argument.

### 4.3 Replay-correctness argument

The scheduler's traversal order may vary run-to-run; correctness depends only on (a) stable IDs and (b) topological ordering.

1. Each task's ID is a pure function of its name plus DAG-context prefix — identical every run.
2. When the scheduler runs task `X`, it launches `X`'s underlying operation under the explicit ID `idOf(X)` via the operation's `*AsyncWithId` entry point (§9). If `X` already completed, the operation's replay fast-path returns the checkpointed result (or rethrows the checkpointed error) without re-executing — the same fast path `step`/`invoke`/`runInChildContext` use, keyed on the entity ID.
3. Replay-consistency validation compares operation type/name/subtype against the checkpoint (never the ID format); the same name always maps to the same operation type, so it passes.
4. The scheduler rebuilds its in-memory results map each run via the fast path; `Deps` is reconstructed identically; topological order guarantees dependencies are present before a task runs.

The only requirement over `map`/`parallel` is name-based ID derivation. Everything downstream — checkpoint, retry, serdes, replay validation, termination — is the existing machinery: the explicit-ID seam is threaded through the whole operation/execution stack (an opaque `OperationIdentifier.operationId`; ID-agnostic `BaseDurableOperation`, `ExecutionManager`, and replay validation; child contexts already run under a supplied ID). The DAG launches each task through the internal `*AsyncWithId` variants on `DurableContextImpl` (`stepAsyncWithId`, `invokeAsyncWithId`, `runInChildContextAsyncWithId`, `mapAsyncWithId`, `parallelWithId`, `waitAsyncWithId`, `waitForConditionAsyncWithId`), each identical to the public method except that it takes a precomputed `operationId` from `operationIdForName(...)` instead of the monotonic counter. These are an internal SPI on the concrete `DurableContextImpl`, not on the public `DurableContext` interface. The one-way `ExecutionMode` REPLAY→EXECUTION transition is keyed purely on the operation-ID string and is agnostic to how the id was produced, so a task launched under `idOf(name)` slots into the lookup with no change to the replay/mode machinery.

---

## 5. Scheduler semantics

The Java scheduler (`DagExecutor`) is a topological scheduler over the registered `List<TaskHandleImpl>`, maintaining a `Map<String, TaskExecution<?>> results`, an in-flight map keyed by task name (insertion order = launch order), and a ready set. It runs on the DAG child-context thread and owns no threads or executor of its own.

- **Readiness (§5.1):** a task is ready when every dependency in `allDeps` is terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`) in `results`. Roots are ready immediately.
- **Concurrency (§5.2):** ready tasks are launched while the in-flight count is below `maxConcurrency`. The scheduler controls concurrency by **deferring the `*Async` launch** until a task is both ready and under the cap.
- **Trigger-rule evaluation (§5.3):** `TriggerRuleEvaluator.eval(rule, statuses)` applies the six-rule truth table, with empty-upstream semantics ported verbatim:

  | Rule          | Runs when                       | Empty upstream |
  | ------------- | ------------------------------- | -------------- |
  | `ALL_SUCCESS` | every upstream SUCCEEDED        | run            |
  | `ALL_FAILED`  | every upstream FAILED           | skip           |
  | `ALL_DONE`    | every upstream is terminal      | run            |
  | `ANY_SUCCESS` | at least one upstream SUCCEEDED | skip           |
  | `ANY_FAILED`  | at least one upstream FAILED    | skip           |
  | `NONE_FAILED` | no upstream FAILED              | run            |

  When the rule is not satisfied the task is recorded `SKIPPED / TRIGGER_RULE` and the skip propagates downstream.

- **`runIf` (§5.4):** if the trigger rule passed, the scheduler builds `Deps` from the per-task snapshot and evaluates the `Predicate<Deps>`. `false` ⇒ `SKIPPED / RUN_IF_PREDICATE`. If the predicate **throws**, the scheduler aborts the DAG with `DagPredicateException` (the offending task is left with no terminal state and no further tasks are launched) rather than recording a failure that would fire compensation paths — a `runIf` throw is a defect in deterministic code, not a business outcome.
- **Running a task (§5.5):** the task's `TaskExecutor` closure launches the underlying operation through its `*AsyncWithId` entry point under `idOf(name)`, returning a `DurableFuture`. On resolution the scheduler records `SUCCEEDED{result}` or `FAILED{error}` and re-runs readiness. `SuspendExecutionException` from a `DurableFuture.get()` propagates for suspend/replay.
- **Skip propagation (§5.6):** a skip is terminal; downstream tasks evaluate their own rule against it. Skips cascade.
- **Failure semantics (§5.8):** a failed task is a **normal terminal state, not an abort**. With no `completionConfig` the scheduler **drains the reachable graph** so compensation tasks (`ALL_FAILED`/`ALL_DONE`) run, and `completionReason` is `ALL_COMPLETED` (no failures) or `COMPLETED_WITH_FAILURES` (≥1 failed). `dag()` does not throw; the caller opts in via `throwIfError()`. This drain-by-default aligns with the Java batch default of `allCompleted()` (§6).
- **Early completion:** when a `completionConfig` threshold is reached, the scheduler stops launching and awaiting, captures the still-in-flight task names (in launch order) as `startedTaskNames`, and abandons those tasks. This is replay-safe: each in-flight operation was launched under its name-based ID, so any late checkpoint it writes is inert — on replay the scheduler re-evaluates completion deterministically, reaches the identical stop point, and never reads a checkpoint past it.
- **Empty DAG (§5.9):** resolves immediately with `totalCount = 0` and `ALL_COMPLETED`.

### 5.1 Skipped tasks checkpoint nothing

A skip is a pure function of upstream terminal statuses plus a deterministic `runIf`, recomputed identically each run — no entity ID, no checkpoint (zero-cost, replay-safe skips).

---

## 6. Completion config

`DagCompletionConfig` is a sealed interface exposing the SDK's threshold factories, wrapping the base SDK's `CompletionConfig`:

```java
public sealed interface DagCompletionConfig permits ThresholdDagCompletion {
    static DagCompletionConfig allCompleted();
    static DagCompletionConfig allSuccessful();
    static DagCompletionConfig firstSuccessful();               // = minSuccessful(1)
    static DagCompletionConfig minSuccessful(int n);
    static DagCompletionConfig toleratedFailureCount(int n);
    static DagCompletionConfig toleratedFailurePercentage(double p);
}

public record ThresholdDagCompletion(CompletionConfig completionConfig) implements DagCompletionConfig {}
```

These six factories mirror the base SDK's `CompletionConfig` factories exactly. The DAG owns its own scheduler, so it evaluates the thresholds itself in `DagExecutor`: `minSuccessful` maps to `MIN_SUCCESSFUL_REACHED`; `toleratedFailureCount` and `toleratedFailurePercentage` map to `FAILURE_TOLERANCE_EXCEEDED`. `SKIPPED` counts toward neither success nor failure. `toleratedFailurePercentage` is computed against `totalCount` by the DAG scheduler (the base parallel operation does not support percentage completion, but the DAG's own scheduler does).

**Custom-predicate completion is deferred to v2.** The base SDK's completion surface has no custom-predicate hook and no `CUSTOM_COMPLETION_*` status (`ConcurrencyCompletionStatus` is closed at three members; completion is factory-method-only), so result-based short-circuit (JS §13.4) is a net-new DAG-owned feature. v1 ships threshold completion only, and the sealed `DagCompletionConfig` permits only `ThresholdDagCompletion`. Because the DAG scheduler is a separate component, a custom `Predicate<DagCompletionSnapshot>` variant remains addable later without touching the batch layer.

The DAG's drain-by-default failure handling (§5.8) is more naturally aligned with Java's batch default (`allCompleted`) than with JS's fail-fast concern. The DAG still treats a failed task as terminal (not an abort) and reports `COMPLETED_WITH_FAILURES`, which the base batch enum cannot express — hence the DAG-local `DagCompletionReason`.

---

## 7. Validation & exceptions

Registration and validation run **eagerly at the `dag(...)` call site** (`DagContextImpl.registerAndValidate`): registration only declares tasks and validation is pure graph analysis, so both are deterministic and run before the child-context body starts. This lets a registration-time `DagException` propagate **unwrapped** to the `dag()` caller rather than being erased into a generic `ChildContextFailedException` inside the `runInChildContext` boundary. Nested DAGs are registered and validated eagerly during the parent's registration phase for the same reason.

DAG exceptions slot into the existing hierarchy (rooted at `DurableExecutionException extends RuntimeException`, via `DurableOperationException`):

```
DurableExecutionException (RuntimeException)
 └── DurableOperationException
      └── DagException                          // base for DAG operations
           ├── DagCyclicDependencyException      // cycle at registration
           ├── DagInvalidTaskNameException       // bad name (charset / DAG_NODE_T_ / length)
           ├── DagDuplicateTaskException         // duplicate name
           ├── DagInvalidDependencyException     // dep handle not registered in this scope
           ├── DagPredicateException             // a runIf predicate threw (aborts the DAG)
           └── DagExecutionException             // thrown by throwIfError(); wraps first failed task's cause
```

- **Name / duplicate / missing-dep / cycle** — deterministic registration-time checks in `DagValidator`. Cycle detection is Kahn's algorithm over `allDeps`, `O(V+E)`; a diamond is not a cycle.
- **`maxConcurrency`** — `< 1` throws `IllegalArgumentException`, mirroring the base `map`/`parallel` guard.
- **Mutually-exclusive completion config** — the `sealed` `DagCompletionConfig` plus factory methods make configuration statically well-formed, so no runtime union-validation is needed; a residual guard (e.g. `minSuccessful(-1)`) throws `IllegalArgumentException`.
- **`DagPredicateException`** — a throwing `runIf` predicate aborts the DAG (§5.4). It carries the offending `taskName()` and the original error as its cause.
- **`NonDeterministicExecutionException`** on a task ID terminates the whole execution (unrecoverable), as for any operation. A task's **normal failure** is not a termination — it is a terminal task state (§5.8).

**Error reconstruction across the child-context boundary.** A DAG runs inside a `runInChildContext` node, so a failed DAG body's exception is checkpointed and reconstructed. `ChildContextOperation` re-throws the original exception transparently when it can be reconstructed (`Class.forName(errorType)` → SerDes deserialize → `setStackTrace`), and falls back to `ChildContextFailedException` (type + message only) when it cannot. Because the `Dag*Exception` classes are ordinary `RuntimeException` subclasses on the classpath, they reconstruct and propagate out of the DAG body — no JS-style `errorMapper` pass-through hook is needed. `DagPredicateException` and `DagExecutionException` set their cause at construction (via a `@JsonCreator`) so a cause-carrying exception survives the round-trip rather than degrading to a bare `ChildContextFailedException`. Reconstruction preserves the exception **type, message, and stack trace**; custom fields survive only if serialized into the error data and reconstructible by the SerDes, so diagnostic detail that must survive replay is carried in the exception message.

---

## 8. Serialization of `DagResult`

`DagResultSerDes` (de)serializes the aggregate to the single cross-language DAG container envelope, `SerializedDagResult` — the same envelope shape written by all four SDKs (cross-language doc §2.A.4). Field names and presence rules are normative:

```java
record SerializedDagResult(
    String type,                              // always "DagResult"
    int totalCount,
    int successCount,
    int failureCount,
    int skippedCount,
    DagCompletionReason completionReason,
    List<String> startedTaskNames,            // always present
    List<String> failedTaskNames,             // droppable (last degradation step); omitted when dropped
    List<SerializedTaskExecution> tasks        // droppable; ABSENCE is the offload signal
) {}

record SerializedTaskExecution(
    String name,
    TaskStatus status,
    SkipReason skipReason,                     // null unless SKIPPED
    SerializedResultKind resultKind,           // null unless SUCCEEDED
    Object result,                             // null unless SUCCEEDED
    DagTaskError error,                        // null unless FAILED
    String startedAt,                          // ISO-8601 UTC, or null
    String completedAt
) {}

enum SerializedResultKind { PLAIN, BATCH, DAG }   // wire values: "plain" | "batch" | "dag"
```

- **`resultKind`** tags how a task's result is rehydrated: a `map`/`parallel` task's `MapResult` ⇒ `BATCH` (wire `"batch"`), a nested-`dag` task's `DagResult` ⇒ `DAG` (wire `"dag"`), otherwise `PLAIN`. On restore, `BATCH` rehydrates to `MapResult` and `DAG` recurses; a `PLAIN` result rehydrates to the task's **declared** type.
- **No `resultType` field.** A `PLAIN` result's type is recovered from the registered graph by task name (`DagResultTypes`, a `taskName → TypeToken<?>` graph collected during registration and carried recursively for nested DAGs), never from a class name persisted in the checkpoint. This keeps the payload free of a `resultType` field, eliminates any `Class.forName` on checkpoint-supplied input, and lets generic element types (e.g. `List<Pojo>`) rehydrate faithfully. An unknown/undeclared task falls back to a generic JSON tree.
- **Errors** serialize via `DagTaskError`'s canonical `ErrorType` / `ErrorMessage` / `StackTrace` keys (§2.9).
- **Evolution is additive-only** (no `schemaVersion`): the reader ignores unknown fields and treats a missing field as absent.
- The DAG child context's result SerDes is this `DagResultSerDes`, so it is also asked to serialize a `Throwable` when the DAG body fails (e.g. a `DagPredicateException`). It delegates any non-`DagResult` value verbatim to the underlying SerDes so error serialization is never reshaped by the aggregate envelope.

### 8.1 Large-`DagResult` handling — SDK-owned envelope with a degradation ladder

The DAG container checkpoints one SDK-owned envelope that is readable on its own; there is no customer-facing summary hook. Oversize aggregates degrade by dropping detail from the envelope, never by writing a customer string the SDK must parse back:

1. **Small aggregate (fits the checkpoint limit):** the full envelope is checkpointed inline, including the `tasks` array, using the `resultKind`-tagged shape so nested `MapResult`/`DagResult` results survive the round-trip.
2. **Large aggregate:** `DagResultSerDes.offloadPayloads(...)` produces an ordered degradation ladder, largest first: (i) drop `tasks`; (ii) additionally drop `failedTaskNames`. `ChildContextOperation` selects the first candidate that fits and sets `ReplayChildren` on the container. The counts, `completionReason`, and `startedTaskNames` are **never** dropped, so a DAG can never fail to checkpoint because its own summary did not fit. `startedTaskNames` is bounded by `maxConcurrency`.
3. **The absence of `tasks` is the offload signal.** When `tasks` is dropped, the per-task detail lives in the retained child operations (via `ReplayChildren`); a reader must treat absence as the signal and must not infer an empty task set.

On restore of an offloaded (tasks-less) envelope, `DagResultImpl` preserves the aggregate counts the envelope carried (rather than re-deriving them from the empty per-task map), so `successCount`/`failureCount`/`skippedCount`/`totalCount`/`completionReason` remain accurate and `throwIfError()` still throws when the aggregate recorded failures (with an aggregate message, since per-task detail is unavailable). This is the child-context large-result behavior the DAG inherits for free by being a child context; a custom user `SerDes` on `DagConfig` cannot produce the reduced envelope, so a DAG configured with one falls back to the child context's generic empty-payload offload.

---

## 9. Concurrency model

The DAG scheduler drives concurrency by launching ready tasks through the SDK's `*AsyncWithId` variants and awaiting their `DurableFuture`s. It owns no threads and no `ExecutorService`; it reuses the SDK's thread-backed substrate (§0):

- Each `*Async` operation runs user code on the user executor (`DurableConfig.executorService`); the handler and child contexts likewise.
- **Suspension** is an active-thread-count race in `ExecutionManager`: when a thread blocks on a `get()` for an operation that has not completed it deregisters, and when no thread is runnable the whole execution suspends (returns `PENDING`) and re-invokes later. A `wait`/callback/invoke inside a task therefore suspends the entire execution when nothing else is runnable; on replay every completed operation returns its checkpointed result via the operation-ID fast path.
- **Determinism** comes from operation-ID-keyed checkpoint/replay and the one-way `ExecutionMode` transition, not from avoiding threads. Real threads are already used throughout `map`/`parallel`/`stepAsync` and are fully compatible with replay.

How the DAG uses this substrate:

- Each ready task is launched with the `*AsyncWithId` variant of its operation (`stepAsyncWithId`, `invokeAsyncWithId`, `mapAsyncWithId`, `runInChildContextAsyncWithId`, `waitAsyncWithId`, `waitForConditionAsyncWithId`, `parallelWithId`, plus nested `dag`), each returning a `DurableFuture<T>` under the task's name-based ID. A `callback` task materializes as a container context (operation subtype `Callback`) carrying the name-based ID, whose body delegates to the native `waitForCallback` operation — the two-level shape required by the cross-language callback checkpoint contract (§2.A.5 of the cross-language doc).
- The scheduler holds the in-flight futures and enforces `maxConcurrency` purely by deferring the `*Async` launch until a task is ready and under the cap.
- Completion is awaited with `DurableFuture.get()`; the SDK-provided statics `DurableFuture.allOf(...)`/`anyOf(...)` are available for aggregation. When a future resolves, the scheduler records the terminal state and re-runs readiness.

`DurableFuture` — not a raw `CompletableFuture` — is used because it is the SDK's replay-safe, checkpoint-participating wrapper: its completion is coordinated with the checkpoint response and the suspend/resume machinery, so a fan-out survives interruption and re-invocation. A bare `CompletableFuture` would run the work but would not checkpoint, suspend cost-efficiently across `wait`s, or replay. Reusing `DurableFuture` means the DAG inherits the exact concurrency-plus-durability substrate the SDK already ships for `map`/`parallel`/`stepAsync`, with no new concurrency machinery.

### 9.1 Nested DAG concurrency

A parent's `maxConcurrency` limits only its top-level tasks; each nested DAG has its own scope and its own limit. A nested-DAG container is checkpointed with operation subtype `Dag` (not `RunInChildContext`) under `DAG_NODE_T_{name}` and recurses.

---

## 10. Per-decision mapping (Ports / Adapts)

| #   | JS decision                                                              | Java disposition           | How                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | `DepsMap` literal-name typed access                                      | **Adapts**                 | `Deps.get(TaskHandle<T>) -> Optional<T>` keyed by handle (not name-string); empty when the upstream did not SUCCEED under a non-`ALL_SUCCESS` rule; optional positional-arity sugar (§2.2, §2.7).                                   |
| b   | `TaskHandle<TName, TResult>`                                             | **Ports (partial)**        | `TaskHandle<T>` carries `TResult` via generics; the `TName` literal is dropped (name is a runtime `String`).                                                                                                                        |
| c   | Name-based entity IDs + reserved `DAG_NODE_T_` delimiter + no-dash names | **Ports (normative core)** | Language-independent; `operationIdForName("DAG_NODE_T_"+name)` feeds the `*AsyncWithId` entry points (§4).                                                                                                                          |
| d   | Trigger rules + `runIf`                                                  | **Ports**                  | `enum TriggerRule` via `TriggerRuleEvaluator` (truth table verbatim, §5); `runIf` is a `Predicate<Deps>` (§2.6), and a throwing predicate aborts the DAG with `DagPredicateException`.                                              |
| e   | Completion-reason core/superset layering                                 | **Adapts**                 | Java cannot union enums; a DAG-local `DagCompletionReason` (§2.10) is a superset of the 3-member `ConcurrencyCompletionStatus` plus `COMPLETED_WITH_FAILURES`. Custom-completion members deferred to v2.                            |
| e   | Custom completion predicate w/ result-based short-circuit                | **Adapts (v2)**            | Base batch has no custom-predicate hook / `CUSTOM_COMPLETION_*`; v1 ships threshold only (§6). A DAG-owned predicate variant remains addable because the scheduler is separate.                                                     |
| f   | SDK-owned container envelope + degradation ladder                        | **Ports (converged)**      | `DagResultSerDes` writes the shared `SerializedDagResult` envelope; oversize degrades by dropping `tasks` (offload signal) then `failedTaskNames` (§8.1). No customer `summaryGenerator`.                                           |
| g   | Concurrency model                                                        | **Adapts**                 | `DurableFuture`-driven scheduler: launch ready tasks via `*AsyncWithId`, await with `DurableFuture.get()`, enforce `maxConcurrency` by deferring the launch (§9). The substrate is thread-backed; determinism is from op-ID replay. |
| h   | Heterogeneous task types + nested DAGs                                   | **Ports**                  | All operation kinds as tasks via `*AsyncWithId`; `resultKind`-tagged recursive serialization (§8) preserves `MapResult`/`DagResult` instances.                                                                                      |
| —   | Sync-by-default entry + `*Async` twin                                    | **Adapts**                 | `dag()` returns `DagResult`; `dagAsync()` returns `DurableFuture<DagResult>` (matches `step`/`stepAsync`).                                                                                                                          |
| —   | `register` may be async                                                  | **Adapts (drop)**          | Java `Consumer<DagContext>` is synchronous; configuration is computed before `dag()`.                                                                                                                                               |
| —   | `Optional` vs `T \| undefined`                                           | **Adapts**                 | `DagResult`/`TaskExecution` use `Optional<T>`, distinguishing skipped/never-started from a `null` success value.                                                                                                                    |
| —   | Config objects                                                           | **Adapts**                 | `DagConfig` record + `builder()`; existing `StepConfig`/`MapConfig`/etc. reused verbatim.                                                                                                                                           |
| —   | Error surfacing (`errorMapper` pass-through)                             | **No hook needed**         | Reconstructable `RuntimeException` subclasses (including `Dag*Exception`) propagate transparently through `runInChildContext`; only unreconstructable exceptions fall back to `ChildContextFailedException` (§7).                   |

---

## 11. Testing outline

- **`DagValidatorTest`** (JUnit 5): cycle detection (self-loop, 2-cycle, deep, diamond = no cycle); invalid names (empty, >100, dash, `DAG_NODE_T_` substring); duplicates across operation kinds; missing/foreign-scope deps → `Dag*Exception` via `assertThrows`.
- **`TriggerRuleTest`**: the full truth table (§5) × {all-succeeded, all-failed, mixed, includes-skip, empty} for all six rules (parameterized).
- **`TaskHandleTest`**: `.reads()`/`.after()`/`.triggerRule()`/`.runIf()` mutate the task definition; `Deps.get(handle)` returns `Optional<T>` (present on success, empty for a non-succeeded upstream under a non-`ALL_SUCCESS` rule); `Deps.get` on an undeclared handle throws `IllegalStateException`.
- **`DagExecutorTest`** (mock context): readiness/topological order, `maxConcurrency` throttling, skip propagation, `runIf` skip, throwing-`runIf` → `DagPredicateException` abort, threshold completion, drain-with-compensation.
- **`DagResultTest`**: typed `getResult(handle)` for succeeded/failed/skipped/not-run; `throwIfError()` → `DagExecutionException`; serde round-trip including error reconstruction and recursive `MapResult`/`DagResult` restore; offloaded (tasks-less) envelope restore preserves counts and `throwIfError()`.
- **Entity-ID tests**: `DAG_NODE_T_{name}` for prefixed/unprefixed and nested recursion; no collision with counter IDs.
- **Local-runner integration** (`DurableTestRunner`): diamond `A→{B,C}→D` (B, C concurrent via `DurableFuture`); mixed operation-type tasks (each appears as its native subtype under a `DAG_NODE_T_`-derived id); compensation (`charge` fails → `refund`/`ALL_FAILED` runs, `fulfill`/`ALL_SUCCESS` skips, `audit`/`ALL_DONE` runs); `runIf` branching; nested-DAG scope isolation and `Dag` subtype.
- **Replay tests**: order-independence (force B-before-C then C-before-B; assert identical `DagResult`, no `NonDeterministicExecutionException`); interruption/resume (completed tasks hit the fast path — count side effects); skip determinism (no checkpoint); large-`DagResult` handling — force an aggregate that exceeds the checkpoint limit and assert the degradation ladder drops `tasks` (and, if needed, `failedTaskNames`) while counts, `completionReason`, and `startedTaskNames` survive, and the restored `DagResult` reports accurate aggregates.
- **Verification bar**: `mvn verify` (compile + Spotless + tests) green; generic correctness is checked by the compiler.

---

## 12. Backward compatibility

Pure addition. `DurableContext` gains `dag(...)`/`dagAsync(...)`; no existing type changes. `DagContext`, `TaskHandle`, `DagResult`, `Deps`, `DagConfig`, and the `Dag*Exception` classes are new. Existing applications are unaffected; `dag()` is strictly opt-in and marked `@Experimental`.
