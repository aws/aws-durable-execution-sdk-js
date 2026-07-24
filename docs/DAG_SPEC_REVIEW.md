# DAG_SPEC.md — Spec Review

> **⚠️ Historical artifact.** This is a point-in-time record of the pre-implementation spec review (Round 1 + Round 2). It predates the API-review renames (`ONE_*`→`ANY_*`, `TaskHandle._name`→`name`, `.deps()`→`.after()`, etc.) applied later — see [`DAG_API_REVIEW.md`](./DAG_API_REVIEW.md). Its findings are preserved verbatim and are not updated to the current API spelling.

Reviewer pass grounded against `packages/aws-durable-execution-sdk-js/src` (durable-context.ts, step/invoke/wait/wait-for-condition/callback/wait-for-callback/run-in-child-context/concurrent-execution handlers, replay-validation.ts, step-id-utils.ts, types/batch.ts, types/durable-context.ts) and the three design docs in `Downloads/DAG/`.

**Overall:** The spec is unusually well-grounded on mechanics. Every handler signature cited in §7.3 was verified correct against source: `createStepHandler(…, createStepId, logger, …)` (4th/5th positional), `createInvokeHandler(… createStepId(3rd), parentId(4th), checkAndUpdateReplayMode(5th) …)`, `createWaitHandler(… checkAndUpdateReplayMode(5th) …)`, `createWaitForConditionHandler(… createStepId(3rd), logger(4th), no mode param)`, `createCallback(… createStepId(3rd), checkAndUpdateReplayMode(4th), parentId(5th), getDefaultCallbackDeserializer(6th))`, `createWaitForCallbackHandler(context, peekStepId, runInChildContext, getDefaultCallbackDeserializer?)`, `createRunInChildContextHandler(… createStepId(4th), getParentLogger(5th), createChildContext(6th) …)`. The `createStepId`/`peekStepId`/`checkAndUpdateReplayMode`/`captureExecutionState`/`checkForNonResolvingPromise` claims in §1.1/§7.3.1 are all accurate, as is `hashId` (functionally; see F14), `validateReplayConsistency` (Type/Name/SubType only), and the concurrent-handler throw-vs-terminate split (§9.4). The findings below are the correctness/completeness gaps that remain.

---

## Findings

### 1. [BLOCKER] Name-based entity IDs are NOT collision-free across nesting levels — §4.2, §6.1

§4.2 states the `T_` prefix "reserves a namespace that cannot collide." That is argued only against _counter_ IDs (`1-2-3`). It is false against names that embed the `-T_` separator, which the charset in §6.1 (`^[a-zA-Z0-9_-]+$`) permits. Concrete collision within one parent DAG (prefix `P`):

- Sibling task named `x-T_y` → entity ID `P-T_x-T_y`.
- Nested dag task `x` (container `P-T_x`) with sub-task `y` → `P-T_x-T_y`.

Both are valid under the scope rules (names unique _within their own scope_, §10.1) yet produce the identical entity-ID string, hence the identical `hashId` checkpoint key — silent checkpoint aliasing, data corruption, and/or `NonDeterministicExecutionError`. This is undetectable at registration.
**Required fix:** Make the ID scheme injective. Either (a) forbid the `T_` sequence / a reserved separator inside task names in `dag-validator.ts` (reject names containing `-T_` or starting with `T_`, or restrict the charset so the delimiter is unforgeable), or (b) escape names before ID composition, or (c) use a per-segment length-prefixed/hashed encoding. Update §4.2's "cannot collide" claim to state the actual guarantee and the enforcing validation.

### 2. [MAJOR] `completionConfig.shouldComplete` cannot inspect task _results_ — §5.7, §13.4, §2.9

§2.9/§5.7 reuse `CompletionConfig`/`CompletionStatus` from `types/batch.ts` "verbatim." Verified: `CompletionStatus.items` is `CompletionItemStatus[] = { index, name?, status? }` — it carries **no result payload**. The worked example §13.4 (the primary "rules engine" motivation, §1.1) needs to complete when a rule's _result_ has `verdict === "REJECT"`; its body `s.items.some(i => i.status === "SUCCEEDED")` with the comment `/* + inspect result via results map */` is not implementable — there is no results map on `CompletionStatus`, and as written it would complete on the first successful rule regardless of verdict. The motivating use case is therefore unmet by the reused type.
**Required fix:** Either (a) define a DAG-specific completion status that exposes per-task results (dropping the "verbatim reuse" claim), or (b) rewrite §13.4 to a status-only predicate and explicitly document that result-based short-circuit is **not** supported in v1 and defer it to `signal()` (§11.4). Do not ship §13.4 as-is.

### 3. [MAJOR] `CompletionItemStatus.status` cannot represent `SKIPPED` — §5.7

§5.7 maps DAG progress into `CompletionStatus` and states "SKIPPED counts toward `completedCount`." But `CompletionItemStatus.status` is typed `BatchItemStatus | undefined`, and `BatchItemStatus` (types/batch.ts) is `SUCCEEDED | FAILED | STARTED` — there is **no `SKIPPED`**. A skipped task cannot be represented in `items[].status` without conflating it with not-yet-started (`undefined`). This is a type-level impossibility given the "reuse verbatim" constraint.
**Required fix:** Specify exactly what `items[].status` holds for a skipped task (e.g. introduce a DAG-specific item-status type, or explicitly document skipped tasks appear as `undefined`/omitted and how `completedCount` is still incremented). Reconcile with F2's decision on reuse-vs-extend.

### 4. [MAJOR] Registration/validation `Dag*Error`s are wrapped in `ChildContextError`, contradicting §5.10 — §5.10, §7.4, §9.4

§5.10 says graph-shape errors "are surfaced by **throwing** the corresponding `Dag*Error` from within the DAG child-context body (the `dag()` promise rejects with it)" and calls this "a catchable throw [with] the right ergonomics." But `createDagHandler` (§7.4) runs `register` + `validateDag` + `executor.run()` **inside `runInChildContext`**, and `executeChildContext`'s catch (verified in `run-in-child-context-handler.ts`) _always_ rewraps a thrown error as `new ChildContextError(reconstructedError.message, reconstructedError)` (unless an `errorMapper` is supplied — §7.4 supplies none). So the caller actually receives a `ChildContextError` wrapping the `Dag*Error`, not the raw `DagCyclicDependencyError`/`DagDuplicateTaskError`/etc. The same catch also checkpoints the container as `FAILED`.
**Required fix:** Either wire an `errorMapper: (e) => e` (pass-through) into the `runInChildContext` options in §7.4 so `Dag*Error`s surface unwrapped, or restate §5.10/§9.4 to say validation errors surface as `ChildContextError` with the `Dag*Error` as `.cause`. As written the two sections contradict the runtime.

### 5. [MAJOR] Round-tripping nested `BatchResult`/`DagResult` task results through the container serdes is unspecified — §8, §9.7

§2.8/§8 embed every task's result inside the container payload (`SerializedDagResult.tasks[].result: unknown`), and the "Completed DAG" replay path (§7.7) returns the **deserialized container** via `handleCompletedChildContext` _without_ re-running the executor. For `map`/`parallel` tasks (result = `BatchResult`) and nested `dag` tasks (result = `DagResult`) — both explicitly supported heterogeneous types (§1.2) — the embedded `result` is a class instance with methods (`getResults()`, `throwIfError()`, a `Map`, etc.). Generic JSON serdes loses those methods (and a `Map` serializes to `{}`), and `restoreDagResult` (§8) is only described as rehydrating the top-level `DagResult`, not recursively restoring nested `BatchResult`/`DagResult` values. §9.7 further claims "The DAG container's serdes only serializes the aggregated DagResult shell," which contradicts §8's per-task `result` embedding. Result: after a completed-DAG deserialize, `getResult(mapOrNestedDagHandle)` returns a method-less object — a runtime break and a violation of the `getResult<TResult>` type.
**Required fix:** Specify how `tasks[].result` is serialized/restored for `BatchResult`/`DagResult`-typed tasks (recursive `restoreBatchResult`/`restoreDagResult`, or per-task serdes tagging), or constrain what `getResult` returns on the completed-replay path. Resolve the §8-vs-§9.7 contradiction.

### 6. [MAJOR] `map`/`parallel`/nested-`dag` container ID wiring can't reuse `_executeConcurrently` unchanged — §7.3.2, §7.2

§7.3.2 says map/parallel/nested-dag variants "build on `runInChildContextWithExplicitId` + the existing `_executeConcurrently`." Verified: `_executeConcurrently` binds `this.runInChildContext.bind(this)` (counter-based) and `createConcurrentExecutionHandler` calls that binding to create the **container** node — so reusing `_executeConcurrently` as-is gives the batch container a _counter_ ID (`P-{n}`), exactly the non-determinism DAG exists to prevent. To get the container under `T_{name}` you must construct a fresh `createConcurrentExecutionHandler` whose container `runInChildContext` binding is the explicit-ID variant, while per-item children keep the counter-based `runInChildContext` of the child context. §7.3.2 only shows step/invoke/childcontext/callback variants and hand-waves the batch ones; the word "existing `_executeConcurrently`" is misleading/contradictory with §7.2's "No changes to concurrent-execution-handler.ts."
**Required fix:** Specify the concrete `runMapWithExplicitId`/`runParallelWithExplicitId`/`runDagWithExplicitId` wiring (two-level binding: explicit-ID container, counter-based per-item children), matching the design doc's enumerated explicit-ID variants.

### 7. [MINOR] `TaskDef` must distinguish inline deps (for `DepsMap`) from all deps (for scheduling/trigger/cycle) — §3, §5.3, §7.5

§3 says builder `.deps(...)` edges are "not in `DepsMap`" but do participate in scheduling/trigger-rule evaluation (§5.3 "inline + builder"). The `TaskDef` shape in §7.5 lists a single `deps` field; the design doc's `buildDepsMap` iterates `task.deps` wholesale (which would leak builder deps into the typed map). The spec never states that `TaskDef` carries two sets (e.g. `inlineDeps` for `DepsMap`, `allDeps` for readiness/trigger/cycle).
**Required fix:** Make `TaskDef` explicitly hold both dep sets and state which each API surface consumes.

### 8. [MINOR] Trigger-rule evaluation over an empty upstream set is unspecified — §2.7, §5.3

A root task (no deps) with a non-default `triggerRule` (e.g. `.triggerRule("ONE_SUCCESS")` on a `[]`-deps task) evaluates the rule against an empty status array. `ALL_SUCCESS`/`ALL_DONE`/`NONE_FAILED` are vacuously true; `ONE_SUCCESS`/`ONE_FAILED` are false; `ALL_FAILED` vacuously true. The truth table (§5.3) has no empty-set row.
**Required fix:** Define `triggerRuleEvaluators` behavior on empty input (and whether a non-default trigger rule on a depless task is even meaningful/allowed).

### 9. [MINOR] `runIf` is silently unavailable on nested `dag()` tasks — §2.2

Every other `DagContext` method takes `options?: … & ConditionalConfig<TDeps>` (runIf). The nested `dag()` signature in §2.2 takes only `config?: NestedDagConfig` (no `ConditionalConfig`), so nested DAGs cannot be conditionally skipped via `runIf` — unlike the source design doc, which had `NestedDagConfig & ConditionalConfig<TDeps>`. Likely an unintended omission and an API inconsistency.
**Required fix:** Either add `& ConditionalConfig<TDeps>` to nested `dag()` or explicitly document (and justify) that nested DAGs don't support `runIf`.

### 10. [MINOR] Two conflicting ways to set a nested DAG's trigger rule; precedence unspecified — §2.2, §2.9

`NestedDagConfig.triggerRule` (§2.9) and the returned `TaskHandle.triggerRule()` builder (§2.4) both set the trigger rule for a nested-dag task. Which wins if both are set is undefined.
**Required fix:** Define precedence (or remove one mechanism for nested dags).

### 11. [MINOR] `runCreateCallbackWithExplicitId` is specified but consumed by no task — §7.3.1, §7.3.2

The DAG `callback` task is submitter-based (`waitForCallback`, Family B, via `runCallbackTaskWithExplicitId`, §7.3.2). The low-level `createCallback` factory (Family A) has no corresponding `DagContext` method, yet §7.3.1/§7.3.2 instruct implementers to build `runCreateCallbackWithExplicitId` and pass `NOOP_REPLAY_MODE` to it. This is dead scaffolding that will confuse implementers.
**Required fix:** Remove `createCallback`/`runCreateCallbackWithExplicitId` from the Family-A worklist, or note it is unused-in-v1.

### 12. [MINOR] `maxConcurrency <= 0` guard and `completionConfig` mutual-exclusion guard are not wired into the DAG's own handler/executor — §5.7, §7.4, §9.4

§2.9/§9.4 correctly state the semantics (throw for `maxConcurrency <= 0`; terminate for the completion-config union violation, mirroring `validateCompletionConfig`). But the DAG uses a **separate** `dag-executor.ts`/`createDagHandler`, not `concurrent-execution-handler.ts`, so these guards must be re-implemented there. The §7.4 flow shows neither guard nor where it fires (before vs after `register`, relative to validation).
**Required fix:** Show the guards in the `createDagHandler`/executor flow and their ordering.

### 13. [MINOR] `DagCompletionReason` reuse leaves the default failure path indistinguishable — §2.8, §5.8

§5.8 (correctly, and deliberately diverging from batch fail-fast) drains the graph and reports `ALL_COMPLETED` even when tasks failed, keying `throwIfError()` off `failureCount`. This is self-consistent, but `completionReason` then conveys no signal that failures occurred, which readers coming from `BatchResult` (where `FAILURE_TOLERANCE_EXCEEDED` marks default failures) may misread.
**Required fix:** Add an explicit note that under the no-`completionConfig` default, `completionReason` is _always_ `ALL_COMPLETED` and failures are observable only via `failureCount`/`failed()`/`throwIfError()`. (Content is implied but worth stating at the `DagResult` API, not only in §5.8.)

### 14. [MINOR] §4.1 misquotes `hashId` as a one-liner — §4.1

The actual `hashId` (step-id-utils.ts) is a memoized function with a bounded `hashCache`, not the inlined `createHash("md5")…substring(0,16)` shown. Functionally equivalent (same output), so purely cosmetic, but the verbatim code block is not the real source.
**Required fix:** Note it is simplified for illustration, or quote the real memoized implementation.

---

## Summary

- BLOCKER: 1 (F1 — ID collision soundness)
- MAJOR: 5 (F2–F6 — result-less completion predicate, no SKIPPED in item status, error-wrapping contradiction, nested-result serdes, batch-container ID wiring)
- MINOR: 8 (F7–F14)

The mechanical grounding (handler signatures, counter/mode-management coupling analysis in §7.3.1, replay argument in §4.4, throw-vs-terminate in §9.4) is accurate and does not require changes.

---

# Round 2 — re-review of the revised spec

Verified each Round-1 finding against the revised spec text and re-grounded the load-bearing fixes against source.

### F1 — RESOLVED (was BLOCKER)

§4.2 now defines an **enforced injective encoding**: the two-char sequence `T_` is forbidden anywhere in a task name (§6.1, `DagInvalidTaskNameError`), so the `-T_` delimiter is unforgeable. The decomposition proof is sound: since no name contains `T_`, every `-T_` in an entity ID is a real delimiter, so splitting on `-T_` yields a unique `(prefix, name₁, name₂, …)` tuple. I stress-tested edge cases (names ending in `-T`, names containing `-T`, names starting with `_`, multi-level nesting) — all decompose uniquely. Collision `x-T_y` is now rejected at registration. Injectivity guarantee is enforced, not merely asserted.

### F2 / F3 — RESOLVED (was MAJOR)

§2.9 drops the "reuse `CompletionConfig` verbatim" claim and defines DAG-specific `DagCompletionStatus` / `DagCompletionItemStatus` that (a) carry per-`SUCCEEDED`-task `result` payloads and a `results` map, and (b) use the full `TaskStatus` including `SKIPPED`. §13.4 rewritten to inspect `status.items[].result.verdict === "REJECT"` — now implementable. Threshold half + `CompletionDecision` factories still reused unchanged. `completedCount` explicitly counts `SKIPPED`.

### F4 — RESOLVED (was MAJOR) — verified in code

`executeChildContext` and `handleCompletedChildContext` (run-in-child-context-handler.ts) both read `options?.errorMapper` and `throw errorMapper(...)` when present, else wrap in `ChildContextError`. §7.4 now wires `errorMapper: (e) => e` on the DAG container, and §5.10/§9.4 correctly state raw `Dag*Error`s surface unwrapped. `subType`/`serdes`/`summaryGenerator` are all valid `ChildConfig` options actually consumed. Grounded.

### F5 — RESOLVED (was MAJOR) — verified in code

`restoreBatchResult` and `createBatchResultSerdes` exist in batch-result.ts exactly as referenced. §8 now tags each task result with a `resultKind` (`plain`/`batch`/`dag`) derived from the task's static kind and recursively restores nested `BatchResult`/`DagResult` via `restoreBatchResult`/`restoreDagResult`. §9.7 contradiction resolved (two-layer serialization explicitly reconciled).

### F6 — RESOLVED (was MAJOR) — verified in code

`createConcurrentExecutionHandler(context, runInChildContext, skipNextOperation, …)` takes the container `runInChildContext` binding as its 2nd param; per-item children are created via the container child-context's own `parentContext.runInChildContext(...)` (lines 285/499), not the injected binding. §7.3.2 specifies the concrete two-level binding (`_executeConcurrentlyWithExplicitId` injects `runInChildContextWithExplicitId` for the container, skips `withDurableModeManagement`); per-item children stay counter-based. Confirmed no change to concurrent-execution-handler.ts is required. The misleading "build on existing `_executeConcurrently`" phrasing is retracted.

### F7–F14 — RESOLVED (were MINOR)

- F7: `TaskDef` now carries `inlineDeps` (drives `DepsMap`) vs `allDeps` (drives readiness/trigger/cycle), with a consumer table (§7.5).
- F8: empty-upstream row added to §5.3 + explicit `triggerRuleEvaluators` with the `s.length > 0` guard on `ALL_FAILED`.
- F9: nested `dag()` signature now includes `& ConditionalConfig<TDeps>` (§2.2).
- F10: `NestedDagConfig = DagConfig` with no config-level `triggerRule`; builder `.triggerRule()` is the sole mechanism (§2.9).
- F11: §7.3.2 states there is NO `runCreateCallbackWithExplicitId` in v1 (callback is Family B). _(Residual nit below.)_
- F12: both config guards shown in `createDagHandler` with ordering (§7.4, §9.4).
- F13: §2.8 `DagResult` note states `completionReason` is always `ALL_COMPLETED` under the default and failures are observable only via `failureCount`.
- F14: §4.1 marks the `hashId` snippet SIMPLIFIED and notes the real memoized impl.

### New residual nit (MINOR, non-blocking)

1. **Stale cross-reference in Appendix B.1.** The Appendix B.1 _fix description_ still mentions "`runCreateCallbackWithExplicitId` … passing `NOOP_REPLAY_MODE`", whereas the authoritative body (§7.3.2, F11 note) correctly states this variant does **not** exist in v1. The appendix is a historical changelog entry; the body is authoritative and unambiguous, so this is cosmetic. Recommend a one-line correction to the appendix if convenient, but it does not block implementation.

### DepsMap type soundness (spot-checked)

`DepsMap<TDeps> = { [K in TDeps[number] as K["_name"]]: K extends TaskHandle<string, infer R> ? R : never }` is sound given `TaskHandle` structurally reflects both params (`_name: TName`, `_resultType?: TResult`); `infer R` binds to the phantom, `K["_name"]` yields the literal key. `AnyTaskHandle = TaskHandle<string, unknown>` constraint is satisfied covariantly. Empty deps ⇒ `{}` ⇒ collapses to the no-deps fn shape. No type-level impossibility.

## Round 2 verdict

The single blocker (F1) and all five majors (F2–F6) are genuinely resolved with concrete, code-grounded designs — I re-verified `errorMapper`, `restoreBatchResult`/`createBatchResultSerdes`, and the `createConcurrentExecutionHandler` binding directly in source. All eight minors are addressed. Only one cosmetic stale cross-reference remains in a historical appendix, which does not affect implementation. The spec is implementation-ready.

APPROVED
