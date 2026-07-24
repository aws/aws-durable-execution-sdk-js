# DAG Implementation Tasks — Cross-Language Rollup

> ## ⚠️ EXPERIMENTAL
>
> **DAG support ships EXPERIMENTAL in all four SDKs** (TypeScript, Python, Java, Go) and may be
> changed or removed without a major-version bump. Marking the public surface experimental at launch
> is part of the normative core — every SDK MUST gate its DAG API behind its language's experimental
> annotation (`@experimental` TSDoc / Python `.. warning::` + first-use `FutureWarning` /
> Java `@Experimental` / Go `// Experimental:` doc comment). See the banner in
> [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md).

**This is a navigational / overview document.** It sequences the four per-language task breakdowns
and calls out each language's base-SDK prerequisites. It does **not** duplicate the per-language task
lists — read those for the full ordered subtasks, file targets, and acceptance criteria:

- **[`DAG_TASKS_TS.md`](./DAG_TASKS_TS.md)** — TypeScript / JS (canonical reference implementation)
- **[`DAG_TASKS_PYTHON.md`](./DAG_TASKS_PYTHON.md)** — Python
- **[`DAG_TASKS_JAVA.md`](./DAG_TASKS_JAVA.md)** — Java
- **[`DAG_TASKS_GO.md`](./DAG_TASKS_GO.md)** — Go

Specs: [`DAG_SPEC.md`](./DAG_SPEC.md) (canonical) · [`DAG_SPEC_PYTHON.md`](./DAG_SPEC_PYTHON.md) ·
[`DAG_SPEC_JAVA.md`](./DAG_SPEC_JAVA.md) · [`DAG_SPEC_GO.md`](./DAG_SPEC_GO.md) ·
[`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md) (normative core & divergence).

---

## 1. The shared task-shape

Every language's breakdown follows the same landing pipeline. The normative core
(`DAG_SPEC_CROSS_LANGUAGE.md` §2) is string- and algorithm-level, so the _sequence_ of work is
identical across SDKs even though the mechanisms and file counts differ:

| Stage               | What lands                                                                                                                                                              | Normative anchor         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **types**           | Public enums (`TriggerRule`/`TaskStatus`/`SkipReason`), `DagCompletionReason` superset, `DagResult`/`TaskExecution`/`DagConfig`, error taxonomy, `OperationSubType.DAG` | §2.A.3, §2.8             |
| **seam**            | Name-based entity-ID minting `{parentId}-DAG_NODE_T_{name}` + explicit-ID operation launch that **bypasses counter-coupled replay-mode machinery**                      | §2.A.1, §2.B.1           |
| **registration**    | `DagContext` (or free functions in Go) + `TaskHandle` + typed `Deps` access + `TaskDef` (`inlineDeps` vs `allDeps`)                                                     | §2.B.7, §3.2             |
| **validator**       | Charset (`^[a-zA-Z0-9_]+$`, no `-`, no `DAG_NODE_T_`), duplicate, missing/foreign-dep, Kahn cycle detection — runs once after `register`                                | §2.A.2, §2.B.7           |
| **executor**        | Topological scheduler: readiness, `maxConcurrency`, trigger-rule truth table + `runIf`, zero-cost skips, **drain-not-fail-fast**                                        | §2.B.1–§2.B.5            |
| **result / serdes** | `DagResult` accessors, `throwIfError` keyed on **failure count**, `resultKind`-tagged recursive serdes, large-payload strategy                                          | §2.A.4, §2.B.5, §2.B.6   |
| **wire**            | `dag()` entry on the context + config guards + replay-mode branch                                                                                                       | §2.1, §2.B.6             |
| **tests**           | Unit (validator/trigger/handle/executor/result/entity-ID) → runner integration + replay (order-independence, interruption/resume, large-payload)                        | §5 conformance checklist |
| **docs**            | Usage docs + experimental annotation audit                                                                                                                              | §0 banner                |

---

## 2. Readiness / base-SDK prerequisites

TypeScript is the only SDK that can start with **zero** base-SDK work; every other language has a
prerequisite that MUST land before (or with) its DAG-package tasks. All prerequisites are **additive,
non-structural** — none rearchitects the SDK (`DAG_SPEC_CROSS_LANGUAGE.md` §4.5).

| SDK            | Base-SDK prerequisite                                                                                                                                                                                                 |            Gating?            | Repo / base                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------: | ------------------------------------------------------------------------------------------- |
| **TypeScript** | **None** — every reused primitive already ships on mainline                                                                                                                                                           |              No               | `packages/aws-durable-execution-sdk-js/`                                                    |
| **Python**     | **None** — name-independent child IDs, child-executor fast paths, thread pool, threshold completion all present                                                                                                       |              No               | `aws-durable-execution-sdk-python`                                                          |
| **Java**       | **[A-J2]** — name-based op-ID seam: `OperationIdGenerator.operationIdForName` + internal `*AsyncWithId` entry points. **2-file additive change, zero edits to operation/execution-manager/replay/serde layers**       | **Yes — blocks all DAG work** | `/Users/parpooya/workplace/aws-durable-execution-sdk-java`                                  |
| **Go**         | **3 additive extensions** (Phase 0): (1) name-based task-ID seam, (2) custom completion predicate with per-task results + `SKIPPED`, (3) completion-reason supersets. All must merge before the 9 `dag`-package tasks |   **Yes — 3 gating tasks**    | `/Users/parpooya/workplace/go-firstcut-b` (recommended base; `go-firstcut-a` also verified) |

Grounding notes: Java's [A-J1]/[A-J3]/[A-J6] are resolved ([A-J3] falsified → no envelope, native
re-execute). Go is no longer greenfield — the durability substrate is verified present in both
worktrees; **firstcut/b** is recommended (name-derived-ID seam already exported, SHA-256 IDs match
the Java sibling, `dag` package sits cleanly beside `operations/`).

---

## 3. Recommended cross-language sequencing

```
┌─ TS  (T1–T17) ───────────────────────────────► reference implementation, no prereq
│                                                 defines the canonical wire contract
├─ Python (T1–T10) ───────────────────────────► parallel with TS, no prereq
│
├─ Java  [A-J2 gate] ──► (Task 2–11) ──────────► DAG work starts only after the 2-file seam lands
│
└─ Go  [3 Phase-0 extensions] ──► (Task 4–12) ─► DAG-package work starts only after all 3 merge

        └─ shared cross-language conformance suite ─► authored alongside TS,
           applied to each SDK as it reaches its integration-test task
```

1. **TypeScript first — reference implementation.** It is the canonical source of the design
   (`DAG_SPEC.md`), carries no prerequisite, and is the only SDK that implements the summary-envelope
   - design-B reconstruct path. It fixes the exact wire contract (entity-ID format, delimiter,
     completion vocabulary, `DagSummary` JSON shape) that the other three MUST match byte-for-byte.
2. **Python in parallel.** No blocking prerequisite, so it can proceed immediately alongside TS. It
   diverges on large-payload replay (re-execute, not envelope) but shares the full behavioral core.
3. **Java after [A-J2].** The 2-file name-based op-ID seam is a hard gate — no DAG task may begin
   until `operationIdForName` + `*AsyncWithId` are merged. Everything after that is a pure addition.
4. **Go after the 3 Phase-0 extensions.** The name-based-ID seam, custom-completion predicate, and
   completion-reason supersets must all land on firstcut/b first; then the 9 `dag`-package tasks
   proceed.
5. **Shared conformance suite alongside TS.** The `DAG_SPEC_CROSS_LANGUAGE.md` §5 checklist is the
   cross-language contract (name-based IDs, charset injectivity, trigger truth table, drain
   semantics, completion vocabulary). Author it as TS reaches its integration-test task (TS T16) and
   apply it to each SDK at its own integration milestone (Python T9, Java Task 10, Go Task 11) so
   every SDK is validated against the _same_ observable behavior.

**Divergences that do not affect sequencing** (each SDK absorbs locally): large-payload strategy
(JS envelope vs re-execute elsewhere), typed-deps ergonomics (mapped type → handle overload →
`Deps.get` → `Get[T]`), entry return shape, registration surface (Go free functions), and enum
closure (Go open strings). Custom result-based completion is **v1 in TS only**; deferred in
Python/Java (v2) and delivered as one of Go's Phase-0 extensions (consumed in Go Task 11).

---

## 4. Summary & task counts

The DAG effort is **highly portable**: the durability core sequences identically across all four
SDKs, and divergence concentrates in surface ergonomics plus two structural splits that put **JS
alone** (single-composition-then-hash injectivity + summary-envelope reconstruct; the other three
re-hash per level and re-execute the child body on large-payload replay). Land **TS first** as the
reference wire contract, run **Python in parallel**, unblock **Java** with the single 2-file
[A-J2] seam, unblock **Go** with 3 additive extensions on firstcut/b, and validate all four against
a shared conformance suite authored alongside TS.

| SDK            |   DAG tasks    |  Base-SDK prerequisite tasks  | Notes                                                   |
| -------------- | :------------: | :---------------------------: | ------------------------------------------------------- |
| **TypeScript** |  17 (T1–T17)   |               0               | reference impl; only SDK with the `DagSummary` envelope |
| **Python**     |  10 (T1–T10)   |               0               | re-execute large-payload; 2 v2-deferred items           |
| **Java**       | 11 (Task 1–11) |  1 gating (Task 1 = [A-J2])   | custom completion v2-deferred; no envelope              |
| **Go**         | 12 (Task 1–12) | 3 gating (Phase 0, Tasks 1–3) | free-function API; recommended base firstcut/b          |

**Grand total: 50 tasks** across the four SDKs (17 TS + 10 Python + 11 Java + 12 Go), of which
**4 are gating base-SDK prerequisites** (1 Java + 3 Go); TypeScript and Python have none.
