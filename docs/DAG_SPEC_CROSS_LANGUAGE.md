# DAG Support — Cross-Language Specification (Normative Core & Per-Language Divergence)

> ## ⚠️ EXPERIMENTAL
>
> **DAG support is an experimental feature in all four SDKs** and may be changed or removed in future releases without a major-version bump. Do not depend on it in production until promoted to stable. Marking the public surface experimental at launch is **part of the normative core** — every SDK MUST ship the DAG API behind its language's experimental annotation:
>
> | SDK        | Experimental annotation (required on every public DAG symbol)                                   |
> | ---------- | ----------------------------------------------------------------------------------------------- |
> | TypeScript | `@experimental` TSDoc tag (repo convention; API-Extractor treats it as `@beta`)                 |
> | Python     | Docstring `.. warning:: Experimental` admonition + runtime `FutureWarning` on first `dag()` use |
> | Java       | `@Experimental` marker annotation (new, `@Retention(CLASS)`) + Javadoc `@apiNote`               |
> | Go         | `// Experimental:` doc-comment paragraph (protobuf convention)                                  |
>
> Rationale: the DAG surface — and especially the per-language _typed-deps ergonomics_ (§3) — is the most likely area to change once real usage lands, so it launches experimental in every language and graduates to stable together.

Status: Draft (authoritative synthesis) · **Stability: Experimental** · Scope: all four AWS Lambda Durable Execution SDKs (TypeScript/JS, Python, Java, Go)

> **This is the whole-picture document.** It defines the **language-agnostic normative core** every SDK MUST conform to for cross-language correctness, interoperability, and diagnosability, and it catalogs where each language **idiomatically diverges**. It does **not** duplicate the per-language specs — read those for full API surfaces and grounding:
>
> - **[`DAG_SPEC.md`](./DAG_SPEC.md)** — JS/TS, the **canonical source of the design**.
> - **[`DAG_SPEC_PYTHON.md`](./DAG_SPEC_PYTHON.md)** — Python (grounded in the real, shipped SDK).
> - **[`DAG_SPEC_JAVA.md`](./DAG_SPEC_JAVA.md)** — Java (grounded in the real `software.amazon.lambda.durable` SDK source; `dag()` is a proposed addition; the one load-bearing seam **[A-J2]** is now **resolved as CAN-BE-ADDED** — see §4.5).
> - **[`DAG_SPEC_GO.md`](./DAG_SPEC_GO.md)** — Go (**grounded in two real Go SDK implementations**: `go-firstcut-a` (flat `durable/` pkg) and `go-firstcut-b` (layered `pkg/durable/`); recommended base is **firstcut-b**. No longer greenfield — the durability substrate is verified present; three additive (non-structural) SDK extensions remain — see §4.5).
>
> **Terminology.** "MUST / MUST NOT / SHOULD / MAY" follow RFC 2119. "Normative core" = decisions that MUST be identical across SDKs. "Divergence" = an idiomatic per-language adaptation that MUST preserve the core's observable contract.

---

## 1. Purpose & shared conceptual model

### 1.1 What the DAG primitive is

`dag()` adds a first-class primitive for declaring a **directed acyclic graph of tasks with dependencies**. Customers describe the graph once in a declarative **registration phase**; the runtime then:

1. schedules tasks **topologically**, running independent chains **concurrently**;
2. evaluates a per-task **trigger rule** against the terminal states of its upstream deps;
3. evaluates a per-task **`runIf`** predicate (deterministic, synchronous) over resolved upstream results;
4. runs each task by delegating to the **same operation machinery** the equivalent standalone `DurableContext` method uses (step / invoke / callback / wait / waitForCondition / runInChildContext / map / parallel / nested dag);
5. aggregates outcomes into a **`DagResult`** (per-task status, result, error; aggregate counts; completion reason).

A DAG is implemented as a **child context** — one `runInChildContext` node in the parent's operation tree — whose body runs a **name-based scheduler**. This is uniform across all four SDKs.

### 1.2 The replay model (why any of this is hard)

Durable functions use a **replay** execution model: after a wait/failure/resume, the handler re-runs from the top; completed operations return their checkpointed results without re-executing. The SDK assigns each operation an **entity ID** used as its checkpoint key. In every SDK today that ID comes from a **per-context monotonic counter**, assigned at operation **start**:

- JS: `createStepId()` → `${prefix}-${counter}` (then MD5-hashed; single multi-level pre-image, hashed once at lookup).
- Python: `_create_step_id()` → `f"{prefix}-{step}"` (then blake2b-hashed; **re-hashed at each child-context boundary**).
- Java: per-context counter, hashed + context-path-prefixed (`hash(1)`, `hash(hash(1)-2)`) — **verified** [A-J1] (also per-level re-hashing, SHA-256).
- Go: **verified** — positional per-context counter, then hashed. firstcut-a: `opIDs.next()` → MD5→16 hex (composes a multi-level raw string, hashes at lookup — JS-style single-composition). firstcut-b: `Context.NextStepID()` → SHA-256→64 hex, **re-hashed at each child-context boundary, deliberately matching Java**. IDs are positional (not name-based) today; the DAG's name-based IDs are an additive seam (§3.1 #1).

`map`/`parallel` are replay-safe because items start in **deterministic index order**, so IDs never depend on completion order. **An arbitrary DAG breaks this assumption**: a downstream task starts when its upstream deps _complete_, and completion order can vary run-to-run (especially under Go goroutines). Counter-based IDs would therefore diverge across replays and trip the SDK's replay-consistency guard (`NonDeterministicExecutionError`/equivalent).

### 1.3 Why name-based entity IDs

The DAG resolves the replay problem by deriving a task's entity ID from its **name**, not the counter: `{parentId}-DAG_NODE_T_{name}`. Because the ID is a pure function of `(scope-path, name)`, it is **identical on every replay regardless of traversal or completion order**. Correctness then depends only on (a) stable IDs and (b) topological ordering — never on the order the scheduler happens to visit tasks. This single decision is what makes DAGs replay-safe for **any** graph shape, and it is the anchor of the normative core (§2.1).

---

## 2. The language-agnostic normative core

Every SDK — present and future — **MUST** conform to the decisions in this section. They are grouped into (A) **on-the-wire / checkpoint-visible** invariants that make executions interoperable and diagnosable across languages, and (B) **behavioral** invariants that make executions semantically identical. All four specs confirm the **observable / wire contract** (§2.A) ports verbatim. Two grounding subtleties are worth flagging up front: (i) the entity-ID _injectivity proof_ differs between SDKs that compose one raw multi-level string and hash at lookup (JS canonical; Go **firstcut-a** — MD5) versus those that **re-hash at each child-context boundary** (Python — verified; Java per [A-J1]; Go **firstcut-b** — SHA-256, the recommended base, matching Java) — §2.A.2; and (ii) the large-payload replay _strategy_ splits into **envelope-reconstruct (JS only)** vs. **re-execute the child body (Python, Java, Go)** — §2.A.4 / §2.B.6. **Grounding update:** with the Go SDKs now read, Go joins Python/Java on _both_ splits (per-level re-hashing on the recommended firstcut-b; re-execute via `ReplayChildren`), leaving **JS alone** as the single-composition + summary-envelope SDK. The behavioral invariants (§2.B) are otherwise semantically identical.

### 2.A Checkpoint-visible invariants (MUST be byte-compatible across languages)

#### 2.A.1 Name-based entity-ID format

- A task's entity ID **MUST** be `{parentId}-DAG_NODE_T_{name}` where `parentId` is the DAG child context's own entity ID; if the DAG context has no prefix, the ID is `DAG_NODE_T_{name}`.
- Nesting composes left-to-right, but the _pre-image_ differs by hashing strategy. In SDKs that build **one raw multi-level pre-image and hash it once at lookup** (JS; Go firstcut-a), a sub-task `rule_a` of nested dag `validation` under DAG `1-2` has pre-image `1-2-DAG_NODE_T_validation-DAG_NODE_T_rule_a`. In SDKs that **re-hash at each child-context boundary** (Python — verified; Java per [A-J1] `hash(hash(1)-2)`; Go firstcut-b — the recommended base), `parentId` is the parent's **already-hashed** container id, so the sub-task pre-image is `{H(validation-container)}-DAG_NODE_T_rule_a` and **no raw multi-level string ever exists**. Both yield the **identical observable wire contract**: exactly one `DAG_NODE_T_{name}` token per nesting level, hashed before storage.
- The delimiter token **MUST** be exactly `DAG_NODE_T_` (case-sensitive, 11 chars).
- The ID is **opaque and hashed** before storage (JS MD5→16 chars; Python blake2b→64 chars; Java SHA-256→64 chars; Go firstcut-a MD5→16 chars / firstcut-b SHA-256→64 chars — all verified). No runtime **MUST** parse it for logic; the token exists only as a structural marker + debug-log convenience. **Consequence:** token length is free (it never appears in persisted data), so all SDKs share the identical long token.

#### 2.A.2 Task-name charset + the injectivity guarantee

- Task names **MUST** match `^[a-zA-Z0-9_]+$` (alphanumerics + underscore), be non-empty, and be ≤ 100 chars. **`-` (dash) MUST NOT appear in a task name.**
- Task names **MUST NOT** contain the substring `DAG_NODE_T_` (defense-in-depth).
- **Injectivity guarantee.** The map `(scope-path, name) → entityId` MUST be injective so checkpoint keys never alias. The charset rules and the delimiter are **wire-normative and enforced at registration in every SDK**, but the _proof_ takes one of two forms depending on how the SDK hashes:
  - **Single-composition-then-hash (JS canonical; Go firstcut-a).** The whole `(prefix, name₁, name₂, …)` path is composed into one raw string and hashed once at lookup. Injectivity is the **no-dash decomposition proof**: (1) `-` appears in an ID only _structurally_ (counter joins like `1-2`; the leading `-` of a `-DAG_NODE_T_` delimiter), never inside a name; (2) so every occurrence of `-DAG_NODE_T_` is a **real, unforgeable delimiter**; (3) splitting on `-DAG_NODE_T_` is unambiguous → the `(prefix, name₁, name₂, …)` decomposition is unique → the ID is a bijection with its position. Here **no-dash is the load-bearing guarantee**; the no-`DAG_NODE_T_` rule is defense-in-depth.
  - **Per-level re-hashing (Python — verified; Java per [A-J1]; Go firstcut-b — the recommended base, SHA-256).** Each child-context level is hashed independently (the prefix is the parent's already-hashed id), so **no raw multi-level string exists** and the decomposition proof does not apply. Injectivity instead rests on **(a) per-level charset injectivity** — at a fixed hashed prefix `Hc`, distinct duplicate-rejected names give distinct pre-images `{Hc}-DAG_NODE_T_{name}`, disjoint from counter siblings `{Hc}-{int}` — **and (b) hash collision-resistance** (blake2b / SHA-256) across levels. Here the no-dash / no-`DAG_NODE_T_` rules are **defense-in-depth / debug hygiene** (greppable IDs, cross-language name parity, future-proofing), **not** the primary guarantee: per-level hashing already prevents the JS-style cross-level collision.
- These rules **MUST** be enforced at registration (not merely asserted) and the wire format is identical across SDKs. Future SDKs MAY **loosen** the charset later (never tighten), because loosening cannot break in-flight executions.

#### 2.A.3 Completion-reason vocabulary

- The shared base vocabulary (the neutral `CompletionReason`, owned by the SDK's core module, shared by map/parallel and dag) is: `ALL_COMPLETED`, `MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED`, and — where the SDK supports custom completion — `CUSTOM_COMPLETION_SUCCEEDED`, `CUSTOM_COMPLETION_FAILED`.
- The DAG adds **exactly one** DAG-specific member on top of that base: **`COMPLETED_WITH_FAILURES`**. Its `.value`/string form MUST be `"COMPLETED_WITH_FAILURES"` in every SDK.
- **Dependency direction MUST be `dag → core`, never `dag → batch`.** The DAG completion vocabulary is a superset of the _core_ base, not of the map/parallel type.
- **Semantics MUST be identical** (§2.B.5): default drain with all-success/skip ⇒ `ALL_COMPLETED`; default drain with ≥1 failure ⇒ `COMPLETED_WITH_FAILURES`.

> Per-language reality: JS/Go express the superset as a union/extra-const of a 5-member base; Python's base has **3** members (no `CUSTOM_*`) so its DAG enum has 4; Java's base has 3 members and cannot union enums, so it declares a fresh 6-member DAG enum reserving `CUSTOM_*`. The **string values** of the shared members remain identical, which is what keeps checkpoints diagnosable across languages.

#### 2.A.4 SDK-owned large-payload summary envelope (`DagSummary`)

When a serialized `DagResult` exceeds the checkpoint size limit, an SDK that uses the **summary-envelope strategy** for large-payload fallback **MUST** checkpoint an **SDK-owned** record whose structural fields are authoritative and computed by the SDK — the customer summary text MUST NOT be able to override them. The JSON shape (field names normative for cross-language diagnosability):

```jsonc
{
  "type": "DagResult",
  "totalCount":     <int>,
  "successCount":   <int>,
  "failureCount":   <int>,
  "skippedCount":   <int>,
  "completedCount": <int>,               // success + failure + skipped
  "completionReason": "<DagCompletionReason>",
  "startedTaskNames":  [<string>, ...],  // STARTED-but-not-terminal at early completion (unrecoverable otherwise)
  "terminalTaskNames": [<string>, ...],  // for diagnostics
  "summary": "<string>"                  // OPTIONAL customer observability text; NEVER read on replay
}
```

Normative contract:

1. `summary` is **observability-only** and **MUST NOT** be read on replay. It cannot set/override any structural field.
2. Replay **MUST** reconstruct the aggregate from (a) the envelope's structural fields and (b) the still-checkpointed per-task nodes — it MUST NOT parse `summary`.
3. A missing/malformed envelope ⇒ derive from per-task checkpoints with an empty STARTED set; **MUST NOT** hang or fall back to live re-execution under completed-replay mode.

> This is the greenfield fix for [aws/aws-durable-execution-sdk-js#751](https://github.com/aws/aws-durable-execution-sdk-js/issues/751) (where a customer summary string is load-bearing on batch replay). **JS is the only SDK that implements the envelope** (envelope + design-B reconstruct). **Python, Java, and Go are documented exceptions:** all three **re-execute** the DAG child body on large-payload replay instead of reconstructing from an envelope — Python because its platform `ReplayChildren` re-executes; Java because [A-J3] is **falsified** (no summary-generator hook; large results reconstructed via native child-context re-execution + per-task checkpoints, exactly as `map` does); Go because **both** real SDKs offload oversize results via `ReplayChildren` (256KB) and re-execute the child body — **verified**, no `DagSummary` envelope exists in either branch (the aggregate is the DAG child context's own serialized result, e.g. firstcut-a's `batchCheckpointPayload`). Where an SDK re-executes, the envelope is optional / observability-only, but the **customer summary text MUST still never be load-bearing on replay** — see §2.B.6 and §3.

#### 2.A.5 Per-task checkpoint shape (flat, with one documented exception)

A task's operation is checkpointed **directly** under the DAG container with the task's name-based ID and its **native** operation subtype (`Step`, `ChainedInvoke`, `Wait`, `WaitForCondition`, `RunInChildContext`, `Map`, `Parallel`, `Dag`) — there is no per-task wrapper. Two consequences are normative and cross-language:

1. A **nested `dag` task** MUST checkpoint its container with SubType **`Dag`**, not `RunInChildContext`. A nested DAG is a DAG.
2. A **`callback` task** is the single exception to flatness. Because a callback operation cannot take an explicit (name-based) operation ID directly, the task materializes as a **container context with SubType `Callback`** carrying the task's name-based ID and the task name, whose body runs the SDK's **native wait-for-callback operation** (SubType `WaitForCallback`, which in turn emits the inner `CallbackStarted` and the submitter step). The resulting two-level shape is normative:

   ```text
   ContextStarted   SubType=Callback         Name=<task>  ParentId=<dag>
     ContextStarted SubType=WaitForCallback  Name=<task>  ParentId=<callback container>
       CallbackStarted  SubType=Callback     ParentId=<waitForCallback>
       StepStarted      SubType=Step         ParentId=<waitForCallback>   # submitter
   ```

   A standalone (non-DAG) wait-for-callback emits only the `WaitForCallback` level; the outer `Callback` container is DAG-specific and exists to carry the name-based task ID.

> Both rules were violated in production code and caught by the execution-history conformance suite: Java checkpointed nested DAGs as `RunInChildContext`, and Python, Java, and Go all emitted the callback task one level shallower than the reference. See `DAG_CONFORMANCE_RESULTS.md` Part 2.

### 2.B Behavioral invariants (MUST be semantically identical)

#### 2.B.1 Replay-safe scheduler contract

The scheduler **MUST** guarantee:

- A task's entity ID is a pure function of its name + DAG-context prefix (§2.A.1) — identical every run.
- A task is **ready** when every dep (inline ∪ ordering-only) has reached a terminal state (`SUCCEEDED`/`FAILED`/`SKIPPED`) in the in-memory results map. Roots are ready immediately.
- Running a task delegates to the underlying operation **under the task's explicit name-based ID**; a task that already completed **MUST** hit the operation's checkpoint fast path (return the checkpointed result / rethrow the checkpointed error) without re-executing.
- Correctness **MUST NOT** depend on traversal or completion order — only on stable IDs + topological ordering.
- The scheduler **MUST** bypass any counter-coupled replay-mode machinery for name-keyed task calls (JS `withDurableModeManagement`; Python `_replay_aware`; Java/Go analog), because that machinery peeks the _next counter ID_ which no DAG task ever checkpoints under. Task-level replay correctness comes solely from (a) the explicit-ID checkpoint fast path and (b) explicit-ID replay-consistency validation.

#### 2.B.2 Trigger-rule semantics + the empty-upstream table

Six rules, default `ALL_SUCCESS`. The truth table (incl. the empty-upstream row) is normative and **MUST** be ported verbatim. `SKIPPED` counts as **neither success nor failure**.

| Upstream states     | ALL_SUCCESS | ALL_FAILED | ALL_DONE |  ANY_SUCCESS   | ANY_FAILED  | NONE_FAILED |
| ------------------- | :---------: | :--------: | :------: | :------------: | :---------: | :---------: |
| **Empty (no deps)** |     Run     |  **Skip**  |   Run    |    **Skip**    |  **Skip**   |     Run     |
| All succeeded       |     Run     |    Skip    |   Run    |      Run       |    Skip     |     Run     |
| All failed          |    Skip     |    Run     |   Run    |      Skip      |     Run     |    Skip     |
| Mixed succ/fail     |    Skip     |    Skip    |   Run    |      Run       |     Run     |    Skip     |
| Includes SKIPPED    |    Skip     |    Skip    |   Run    | if any success | if any fail | if no fail  |

The failure-family rules (`ALL_FAILED`, `ANY_FAILED`) **MUST** carry an explicit "at least one upstream" guard (`len(statuses) > 0`) so a depless task never runs them vacuously. Success/done-family rules (`ALL_SUCCESS`, `ALL_DONE`, `NONE_FAILED`) are vacuously satisfied on empty upstream (a root with default `ALL_SUCCESS` runs). A non-default rule on a depless task is **legal** (not a validation error) and follows the empty-upstream row.

#### 2.B.3 `runIf` — deterministic & synchronous

`runIf` **MUST** be a **synchronous, deterministic** predicate over resolved upstream results. It is evaluated **after** the trigger rule passes and **before** the operation runs. `false` ⇒ task is `SKIPPED` with reason `RUN_IF_PREDICATE`. Async predicates are **forbidden** (they invite non-deterministic IO on replay). (This is trivially satisfied in Python/Go which are synchronous everywhere; JS/Java enforce it by typing the predicate as sync.)

#### 2.B.4 Skips are free and checkpoint nothing

A skip (trigger-rule or `runIf`) is a **pure function** of upstream terminal statuses + a deterministic `runIf`, so it **MUST** be recomputed identically each run and **MUST NOT** mint an entity ID or write a checkpoint. Skips cascade: a skip is a terminal transition, and downstream tasks evaluate their own trigger rule against it.

#### 2.B.5 Failure semantics — drain, not fail-fast

- A **failed task is a normal terminal state, not an abort signal.** This is the pivot that makes compensation/fallback trigger rules (`ALL_FAILED`, `ALL_DONE`, `ANY_FAILED`, `NONE_FAILED`) usable.
- **Default (no completion config): the scheduler MUST drain the reachable graph** — keep starting ready tasks until none is startable — so downstream rules can react to failures. This is a **deliberate divergence from the batch (`map`/`parallel`) default**, which is fail-fast in JS/Python (and drain-all in Java). It is a **local design choice** of the DAG's own scheduler, never a change to shared batch code.
- `dag()` **MUST NOT** raise/reject on task failure; it resolves/returns a `DagResult` with `failureCount > 0` and `completionReason == COMPLETED_WITH_FAILURES`.
- **`throwIfError()` MUST key off `failureCount`** (`> 0`), **not** off the completion reason. (It also throws on `CUSTOM_COMPLETION_FAILED` where custom completion exists.) A customer wanting batch-style fail-fast opts in explicitly via a completion config.

#### 2.B.6 Replay reconstruction (design B: reconstruct, don't re-schedule) — _core with two documented exceptions (Python, Java)_

On the large-payload completed-replay path, an SDK using the envelope strategy (**JS only**) **SHOULD** be **replay-mode-aware** and **reconstruct** the aggregate `DagResult` — re-running only the _deterministic_ parts (`register` graph rebuild + skip/trigger recomputation), reading per-task results from checkpoints, and taking counts/`completionReason`/`startedTaskNames` from the envelope (§2.A.4) — rather than re-scheduling live task execution. Reconstructing (not re-running) is what keeps the STARTED-at-early-completion set and completion reason **faithful** on replay.

> **Documented exception — Python.** Python's platform `ReplayChildren` **re-executes** the child body rather than reconstructing from a summary; its summary generator is therefore already genuinely observability-only, and #751 does not reproduce. Python's DAG **MUST** adopt the platform's re-execute path (which equals its interrupted-mid-DAG resume path). The consequence — that a faithful STARTED-set under large-payload early completion is not reproduced (in-flight tasks restart) — is a **pre-existing Python `map`/`parallel` limitation**, matched for consistency and deferred to a possible cross-SDK change. This is the single genuine _observable_ divergence in the normative set, and it is dictated by existing platform behavior, not by language ergonomics.

> **Documented exception — Java.** [A-J3] is **falsified**: the Java SDK has no summary-generator hook or SDK-owned envelope. A DAG _is_ a child context, and Java's native large-result strategy **re-executes the child body** on replay (reconstructing from per-task child checkpoints, exactly as `map` reconstructs from per-item checkpoints). Because of name-based IDs this re-execution is a **no-op-scheduler pass** — every task hits its per-task checkpoint fast path and returns its checkpointed result, so `DagResult` is rebuilt identically. Java frames this as "design A (re-run the deterministic body)"; unlike Python it claims the deterministic completion evaluation reproduces the same early-completion stop point, so its observable result is faithful **without** an envelope. Net effect: **Java, like Python, does not implement the SDK-owned envelope**, but reaches the #751 guarantee for free by having **no customer-writable envelope at all**.

> **Documented exception — Go (verified).** Both real Go SDKs re-execute rather than reconstruct: a child/context result over 256KB is checkpointed SUCCEEDED with an empty payload + `ReplayChildren=true`, and on replay the child body **re-executes** to rebuild the value in memory (firstcut-a `child_context.go`/`batch.go`; firstcut-b `invoke.go` `replayChildrenResult`). No `DagSummary` envelope exists in either branch. The DAG follows this native model — like Java, name-based IDs make the re-execution a **no-op-scheduler pass** (every task hits its per-ID checkpoint fast path), so `DagResult` is rebuilt identically and the customer summary string is never load-bearing. This is Go's grounded position (previously assumed to implement the envelope); it now matches Python/Java, not JS.

#### 2.B.7 Registration & scoping determinism

- The `register` callback **MUST** be deterministic on replay (same names, deps, trigger rules, `runIf`). Non-deterministic registration produces a different graph on replay and surfaces as replay-consistency failures on task IDs.
- Name uniqueness is scoped to the **immediate** DAG context; nested DAGs open a fresh scope; a dep handle **MUST** belong to the same scope (enforced by missing-dep validation).
- Registration-time validation (bad name, duplicate, missing dep, cycle via Kahn's algorithm over the union of edges) is deterministic and reproduces identically on replay.

---

## 3. Per-language divergence

### 3.1 Decision matrix

Legend: **Port** = carries over essentially unchanged · **Adapt** = same observable contract, different language mechanism · **Infeasible/Defer** = cannot reproduce in v1; replaced or postponed.

| #   | Design decision                                            | TS (canonical)                     | Python                                                                        | Java                                                                                  | Go                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Name-based entity IDs + `DAG_NODE_T_` delimiter            | **Port** (origin)                  | **Adapt** (per-level blake2b)                                                 | **Port** ([A-J1] verified; **[A-J2] seam resolved** — CAN-BE-ADDED, 2-file additive)  | **Port** (verified positional+hashed base; name-derived-ID seam **exposed on firstcut-b** via `NewChildWithName`+`Checkpoint()`, or index pre-claim needing no seam)                                                 |
| 2   | No-dash names + injectivity proof                          | **Port**                           | **Adapt** (per-level; no-dash = defense-in-depth)                             | **Port verbatim** (per-level; no-dash = defense-in-depth)                             | **Adapt** (firstcut-b per-level SHA-256 = defense-in-depth, matches Java; firstcut-a single-composition MD5 = no-dash load-bearing)                                                                                  |
| 3   | Replay-safe scheduler contract                             | **Port** (origin)                  | **Port**                                                                      | **Port** ([A-J2] resolved)                                                            | **Port** (verified: per-op checkpoint fast-path, `checkReplayConsistency`, child-context isolation all real)                                                                                                         |
| 4   | Bypass counter-coupled mode mgmt                           | `withDurableModeManagement` bypass | **Port**: bypass `_replay_aware`                                              | **Adapt** ([A-J1] verified; [A-J2] resolved)                                          | **Port (verified, concern does not arise)**: replay-mode tracked structurally (b `markRealExecution`; a `refreshReplayMode`), not counter/logger-coupled                                                             |
| 5   | Trigger rules + empty-upstream table                       | **Port** (origin)                  | **Port verbatim**                                                             | **Port** (enum w/ per-constant `eval`)                                                | **Port** (`map[TriggerRule]func`)                                                                                                                                                                                    |
| 6   | `runIf` deterministic & sync                               | **Port**                           | **Port** (sync-native)                                                        | **Port** (`Predicate<Deps>`)                                                          | **Port** (`func(Deps) bool`)                                                                                                                                                                                         |
| 7   | Skips checkpoint nothing                                   | **Port**                           | **Port**                                                                      | **Port**                                                                              | **Port**                                                                                                                                                                                                             |
| 8   | Drain-not-fail-fast + `throwIfError` on count              | **Port** (origin)                  | **Port** (diverges from PY batch fail-fast)                                   | **Port** (aligns w/ Java batch drain)                                                 | **Port**                                                                                                                                                                                                             |
| 9   | Completion vocab: core base + `COMPLETED_WITH_FAILURES`    | **Port** (5-member base)           | **Adapt** (3-member base → 4-member enum)                                     | **Adapt** (fresh 6-member enum; no enum union)                                        | **Port (weak)** (open string type)                                                                                                                                                                                   |
| 10  | SDK-owned summary envelope                                 | **Port** (origin)                  | **Adapt/diverge** (re-execute; envelope optional, non-load-bearing)           | **Adapt/diverge** ([A-J3] falsified; re-execute, no envelope)                         | **Adapt/diverge (verified)** (both branches re-execute via `ReplayChildren`; no envelope exists)                                                                                                                     |
| 11  | Design-B reconstruct-don't-reschedule                      | **Port** (origin)                  | **Infeasible/Defer** (platform re-executes)                                   | **Adapt** (native child re-execute = "design A"; not envelope-reconstruct)            | **Infeasible/Defer (verified)** (`ReplayChildren` re-executes = "design A", like Java/Python; not envelope-reconstruct)                                                                                              |
| 12  | Heterogeneous tasks + nested DAGs + `resultKind` serdes    | **Port**                           | **Port**                                                                      | **Port**                                                                              | **Adapt** (`json.RawMessage` lazy-typed; improves)                                                                                                                                                                   |
| 13  | **Typed dep access (`DepsMap`)**                           | **Port** (mapped type)             | **Adapt** (dict + handle overload)                                            | **Adapt** (`Deps.get(handle)`)                                                        | **Adapt** (`Get[T](deps, handle)`)                                                                                                                                                                                   |
| 14  | Conditional deps-first fn collapse                         | **Port** (conditional types)       | **Adapt** (uniform: deps always first)                                        | **Adapt** (uniform: `Deps` always first)                                              | **Adapt** (uniform: `deps` always first)                                                                                                                                                                             |
| 15  | Custom result-based completion (§13.4)                     | **Port** (origin)                  | **Infeasible/Defer** (no predicate; threshold-only)                           | **Defer to v2** ([A-J6] verified: no native hook; DAG-owned predicate feasible later) | **Defer / additive extension (verified)** (threshold-only in **both** branches — no `ShouldComplete` predicate; a DAG-owned predicate is one of the 3 additive SDK extensions, feasible since scheduler is separate) |
| 16  | Entry return shape                                         | `DurablePromise<DagResult>`        | **Adapt**: sync `DagResult` (blocking)                                        | **Adapt**: sync `DagResult` + `dagAsync` twin                                         | **Adapt**: `(*DagResult, error)`                                                                                                                                                                                     |
| 17  | Task registration surface                                  | methods on `DagContext`            | methods on `DagContext`                                                       | methods on `DagContext`                                                               | **Adapt (major)**: free functions `dag.Step[T](d,…)` (no generic methods)                                                                                                                                            |
| 18  | Error surfacing                                            | throw / `errorMapper: (e)=>e`      | **Adapt**: unwrap `ChildContextError.__cause__` (no `error_mapper`)           | **Adapt/verify**: `RuntimeException` likely propagates                                | **Adapt**: `error` values; registration errors aggregated on `Context`                                                                                                                                               |
| 19  | Family A/B handler split (createStepId vs waitForCallback) | present                            | **Port (simpler)**: full `OperationIdentifier`; callbacks already child-based | n/a at this granularity                                                               | n/a (free-function registration; no JS-style handler-family split)                                                                                                                                                   |
| 20  | Async `register`                                           | allowed                            | **Adapt (drop)**: sync only                                                   | **Adapt (drop)**: sync `Consumer`                                                     | **Adapt (drop)**: sync `func(*Context)`                                                                                                                                                                              |
| 21  | Open vs closed enums (TriggerRule/reason)                  | closed union                       | closed `Enum`                                                                 | closed `enum`                                                                         | **Weak**: open `string` type, runtime-validated                                                                                                                                                                      |
| 22  | Validation error timing                                    | throw at offending call            | throw (wrap/unwrap)                                                           | throw at call                                                                         | **Adapt**: aggregated, returned at `Dag()` boundary                                                                                                                                                                  |

### 3.2 Per-language idiomatic summary (focused on typed dependency access)

The hardest area to port is **typed dependency access** — JS's headline `DepsMap<TDeps>`, a mapped type keyed on each dep's **literal-string name** so `deps.fetch` is statically typed as fetch's result. No other language has literal-string type keys. Each SDK approximates it differently:

- **TypeScript (canonical).** `DepsMap<TDeps> = { [K in TDeps[number] as K["name"]]: … }`. Full static safety: both **key membership** (only declared deps are keys) and **result type** are compile-time-checked. `deps.fetch` just works. The deps-first fn signature _collapses_ the `deps` param away for root tasks via conditional types.

- **Python.** No type-level `DepsMap`. Runtime **name-keyed `Mapping`**: `deps["fetch"]` returns the result typed `Any`. To recover static types, an `@overload` on handle-keyed access — `deps[fetch_handle] -> T` — carries `T` from `TaskHandle[T]`. Recommended ergonomic: **index by handle for typed access**, by string for dynamic access. The deps-first rule is **uniform** (deps always the first param, empty for roots) — simpler than JS's conditional collapse. Loss: **key-membership checking** (string keys are unchecked); result type recovered only via the handle overload.

- **Java.** No literal-string keys, no heterogeneous typed maps. A `Deps` accessor keyed by **handle**: `deps.get(TaskHandle<T>) -> T` (generics carry `T`; `getOptional` for non-`ALL_SUCCESS` paths where an upstream may be absent). Inline deps must be **declared explicitly** on the builder (`.reads(a, b)`) because Java can't introspect a lambda body; `.after(…)` adds ordering-only edges. Optional **positional-arity sugar** (`step(name, type, a, b, (A,B,ctx)->…)`) for the 1–3 dep case. The fn signature is **uniform** (`Deps` always first, empty for roots). Loss: key membership is a **runtime** `IllegalStateException`, not compile-time; `Deps.get` on the common path returns declared `T`.

- **Go.** No mapped types, and **methods cannot be generic**, so registration is **free functions** `dag.Step[T](d, name, deps, fn)` (only way to mint `TaskHandle[T]`). Typed access via a **generic free accessor**: `dag.Get[T](deps, handle) (T, error)` — result type preserved from the handle; missing/mismatched dep is a **runtime** `error`, not a compile error. Deps passed as `[]AnyHandle`; the fn shape is **uniform** (`deps Deps` always first). Serialization _improves_ on JS: each result is stored as `json.RawMessage` and lazily unmarshaled into `T` at access time, sidestepping the "methods lost on `any`" problem (only batch/dag results need the `resultKind` discriminator for recursive restore).

### 3.3 The 'typed deps spectrum'

From most to least static safety, and what is lost at each step:

```
TS mapped type            Python dict + handle overload      Java Deps.get(handle)          Go Get[T](deps, handle)
──────────────────        ──────────────────────────────     ────────────────────────       ────────────────────────
key membership: ✅ compile  key membership: ❌ (Any string)     key membership: ❌ (runtime)     key membership: ❌ (runtime)
result type:    ✅ compile  result type: ✅ via deps[handle]    result type: ✅ via get(handle)  result type: ✅ via Get[T]
                            (Any via deps["name"])              (Optional for non-ALL_SUCCESS)  (error for missing)
ergonomic: deps.fetch      ergonomic: deps[handle] (typed)     ergonomic: deps.get(handle)     ergonomic: v,_ := Get(d,h)
                                       deps["fetch"] (Any)      + arity sugar for 1–3 deps      + Dag2/Dag3 sugar (deferred)
```

- **What every language keeps:** the **result type** of a dependency (via the generic `TaskHandle[T]`/`TaskHandle<T>`). No user-side manual casting is required on the typed path.
- **What everyone below TS loses:** **compile-time key-membership checking** — the guarantee that the handle/name you look up is actually a declared dependency of this task. In Python/Java/Go this becomes a runtime signal (`Any`, `IllegalStateException`, or `ErrDepNotAvailable`).
- **Recommended ergonomic per language:** TS — `deps.fetch` directly. Python — index by **handle** (`deps[fetch]`) for typing, string only for dynamic keys. Java — `deps.get(handle)` canonical; positional-arity sugar for small fan-in. Go — `dag.Get[T](deps, handle)` with the two-value `(T, error)` return; `MustGet` where a missing `ALL_SUCCESS` dep is a bug.
- **Related divergence — the fn signature.** Only TS uses conditional types to drop the `deps` parameter for root tasks. Python, Java, and Go all adopt a **single uniform signature** where `deps` is always the first parameter (empty for roots). This is an intentional simplification: a uniform, non-conditional signature is far more idiomatic and tractable than faking conditional arity via overloads.

---

## 4. Open cross-language questions & recommendations

1. **Faithful STARTED-set on large-payload early completion.** **JS reconstructs** the in-flight set from the envelope; **Python, Java, and Go re-execute** the child body instead (Python because its platform `ReplayChildren` re-executes; Java because [A-J3] is falsified — native child-context re-execution, no envelope; Go — verified: both branches offload oversize via `ReplayChildren` and re-execute, no envelope exists). No re-execute path carries a _faithful_ STARTED-set: Python restarts in-flight tasks (documented limitation); Java and Go rely on deterministic re-execution reproducing the same stop point (name-based IDs make the replay a no-op-scheduler pass). _Recommendation:_ accept the re-execute divergence in v1 (matches existing Python/Java/Go `map`/`parallel` behavior); if fidelity is required, adopt the SDK-owned envelope as a **cross-SDK** change to Python/Java/Go `map`/`parallel` + dag together, not DAG-only.

2. **Custom result-based completion (§13.4).** Only TS ships it in v1. Python has no predicate hook (threshold-only) → deferred. Java: [A-J6] is **verified** (`ConcurrencyCompletionStatus` closed at 3 members; factory-only completion; no predicate hook), so custom completion is net-new → v1 **defers** (Option B); a DAG-owned predicate (Option A) remains feasible later because the scheduler is separate. Go: **verified threshold-only in both branches** (`MinSuccessful`/`ToleratedFailureCount`/`ToleratedFailurePercentage`; no `ShouldComplete` predicate) — so Go is **not** a free native port as previously assumed; a DAG-owned predicate is one of Go's three additive SDK extensions, feasible for the same reason as Java. _Recommendation:_ treat custom completion as a **cross-cutting** capability; where a base predicate hook is missing (Python, Java, Go), introduce it for map/parallel + dag jointly to avoid drift. Until then, `min_successful`/task-raises approximate it.

3. **Error-surfacing ergonomics.** TS wires `errorMapper: (e)=>e`; Python unwraps `ChildContextError.__cause__` at the `dag()` boundary (no `error_mapper` param); Java likely propagates `RuntimeException` transparently (verify); Go aggregates registration errors on `Context` and returns them from `Dag()`. _Recommendation:_ each SDK keeps its idiom, but **the observable contract MUST hold**: a graph-shape error (cycle/bad-name/duplicate/missing-dep) surfaces to the caller as a typed DAG error, and a task failure never surfaces as a thrown validation error.

4. **Open vs closed enums (Go).** Go can't close `TriggerRule`/`CompletionReason`. _Recommendation:_ runtime validation (`DagInvalidTriggerRuleError`) + exhaustive-switch linters; string values MUST match the normative vocabulary (§2.A.3).

5. **SDK seams (Java, Go) — now resolved against real source; residual additive work.** Java's single load-bearing seam **[A-J2]** (an explicit-ID seam analog to `createStepId`) is **resolved as CAN-BE-ADDED**: the caller-supplied-ID path is already threaded end-to-end (`OperationIdentifier.operationId` is opaque; every `*Operation` uses it verbatim; `ExecutionManager` keys purely off it; `validateReplay` never checks id format; `ConcurrencyOperation` already runs children under an explicit prefix), so only **name-based minting** is missing — a bounded 2-file additive change (`OperationIdGenerator.operationIdForName(String)` + internal `*AsyncWithId` entry points on `DurableContextImpl`), **zero** changes to operation/execution-manager/replay/serde layers. [A-J1] (counter IDs), [A-J3] (large-payload — falsified) and [A-J6] (completion enum) are resolved. Go is **no longer greenfield**: the correctness substrate (positional+hashed IDs, per-op checkpoint fast-path replay, `checkReplayConsistency`, child-context isolation, `ReplayChildren` large-payload offload, goroutine-ownership-safe concurrent child contexts, value-typed errors, local test runner) is **verified present in both branches**. Residual Go work is **three additive, non-structural SDK extensions** on the recommended firstcut-b: (1) a name-based-ID task seam (trivial via exported `NewChildWithName`+`Checkpoint()`, or fall back to index pre-claim needing nothing); (2) a custom completion predicate; (3) completion-reason supersets. _Recommendation:_ land Java's 2-file additive change and Go's three extensions before/with implementation; the previously-flagged "does the SDK forbid blocking ops in goroutines" risk is **retired** — both Go SDKs support durable ops in worker goroutines under a per-goroutine ownership rule (each task MUST run in its own child context).

6. **Concurrency substrate.** TS defers eager promises on the event loop; Python reuses its thread-pool `ConcurrentExecutor` (preferred) or a dedicated `ThreadPoolExecutor`; Java defers `*Async` calls returning `DurableFuture` — **verified thread-backed** ([A-J5]: `runUserHandler` → `CompletableFuture.runAsync` on `durableConfig.getExecutorService()`; suspension via an active-thread-count race, `deregisterActiveThread` → `suspendExecution` when the count hits zero; `DurableFuture.allOf/anyOf` confirmed); Go uses a goroutine pool + bounded semaphore + `context.Context` — **verified**, under a per-goroutine ownership rule (`goroutineOwner`/`ErrWrongGoroutine`) requiring each concurrent task run in its **own** child context whose owner is captured inside the worker goroutine. _Recommendation:_ all are valid because **correctness is decoupled from execution order** (§2.B.1); each SDK MUST reuse its existing durable fan-out substrate rather than introducing new concurrency machinery, and MUST NOT let a task **failure** cancel siblings (only early completion stops scheduling).

---

## 5. Conformance checklist (any new-language SDK MUST satisfy)

A new-language DAG implementation conforms iff **all** of the following hold. Items marked **[wire]** are cross-language interoperability/diagnosability requirements and are non-negotiable.

- [ ] **[wire]** Task entity IDs are `{parentId}-DAG_NODE_T_{name}`, nesting left-to-right, hashed before storage (§2.A.1).
- [ ] **[wire]** Task names enforced at registration to `^[a-zA-Z0-9_]+$`, ≤100 chars, no `-`, no `DAG_NODE_T_` substring; the injectivity proof holds (§2.A.2).
- [ ] **[wire]** Completion-reason string values match the shared vocabulary; the DAG adds exactly `COMPLETED_WITH_FAILURES`; dependency direction is `dag → core` (§2.A.3).
- [ ] **[wire]** If the SDK uses the summary-envelope strategy for large-payload fallback, the checkpointed envelope uses the normative `DagSummary` JSON shape with SDK-owned structural fields; `summary` is never read on replay (§2.A.4). _(Only JS uses the envelope. Python, Java, and Go re-execute the child body on large-payload replay — envelope optional / non-load-bearing; the customer summary text is still never load-bearing — §2.B.6.)_
- [ ] Scheduler correctness depends only on stable IDs + topological order, never traversal/completion order; completed tasks hit the explicit-ID checkpoint fast path; counter-coupled mode management is bypassed for task calls (§2.B.1).
- [ ] All six trigger rules implemented with the exact empty-upstream table and the `len>0` guard on failure-family rules; `SKIPPED` is neither success nor failure (§2.B.2).
- [ ] `runIf` is synchronous, deterministic, evaluated after trigger rule and before the op; `false` ⇒ `SKIPPED`/`RUN_IF_PREDICATE` (§2.B.3).
- [ ] Skips mint no entity ID and write no checkpoint; skips cascade (§2.B.4).
- [ ] Default behavior **drains** the reachable graph (not fail-fast); `dag()` does not raise on task failure; `throwIfError()`/`Err()` keys off failure **count** (§2.B.5).
- [ ] Replay reconstructs (not re-schedules) on completed-large-payload replay where the platform supports it; otherwise re-executes deterministically (§2.B.6).
- [ ] `register` is deterministic; name uniqueness is scope-local; dep handles must belong to the same scope; validation (name/duplicate/missing-dep/cycle) runs once after `register`, before scheduling (§2.B.7).
- [ ] A dependency's **result type** is preserved at typed access (via a generic handle); the loss of compile-time key-membership checking (if any) is documented (§3.2–§3.3).
- [ ] Heterogeneous task kinds (step/invoke/callback/wait/waitForCondition/child/map/parallel/nested-dag) all run as tasks; `map`/`parallel`/nested-`dag` results round-trip with their methods/typed form intact (recursive `resultKind` restore or lazy typed decode) (§3.1 #12).
- [ ] `dag()` is a **pure addition** — no change to existing operation semantics or shared batch code; the drain-vs-fail-fast difference is a local scheduler choice.
- [ ] Any SDK-seam assumptions (explicit-ID producer, blocking-ops-in-concurrency, large-payload split) are verified against real SDK source before implementation.

---

## 6. Summary

The DAG design is **highly portable**: the entire durability/correctness core — name-based IDs, the `DAG_NODE_T_` delimiter and no-dash charset rule, the replay-safe scheduler, trigger/`runIf`/skip semantics, the completion vocabulary, and drain-not-fail-fast failure handling — is string- and algorithm-level and ports across TS, Python, Java, and Go essentially unchanged. Two structural splits are worth naming, and with all four SDKs now grounded in real source **both put JS alone**: (i) the **injectivity grounding** is single-composition-then-hash in JS (and Go firstcut-a, MD5) versus per-level-re-hashing in Python (verified), Java (per [A-J1]) and Go firstcut-b (the recommended base, SHA-256, matching Java) — though the wire format is identical; and (ii) the **large-payload replay strategy** divides into **envelope + design-B reconstruct (JS only)** vs. **re-execute the deterministic child body (Python, Java, Go)** — the latter three reach the same #751 guarantee without a customer-writable envelope. Divergence otherwise concentrates in **surface ergonomics** (typed dependency access, entry return shape, registration surface, error channel, enum closure) and in **one genuine observable exception** (Python cannot faithfully reproduce the STARTED-set under large-payload early completion; Java and Go rely on deterministic re-execution reproducing the stop point instead).

**The single most important cross-language constraint:** the **name-based entity-ID format `{parentId}-DAG_NODE_T_{name}` together with the no-dash-name charset rule** — because it is both the _sole_ mechanism that makes arbitrary graph shapes replay-safe **and** a checkpoint-visible, on-the-wire contract; if any SDK deviates from the exact delimiter, charset, or composition grammar, the injectivity guarantee breaks and executions stop being correct and diagnosable across languages.
