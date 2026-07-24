# Cross-Language DAG Conformance Catalog

> **Status:** Normative conformance contract · **Scope:** all four AWS Lambda Durable Execution SDKs (TypeScript/JS, Python, Java, Go) · **Stability:** Experimental (tracks the DAG feature)

This document is the **shared contract** the four SDK DAG implementations are proven against. It is derived from — and subordinate to — the normative core in [`DAG_SPEC.md`](./DAG_SPEC.md) (canonical design) and [`DAG_SPEC_CROSS_LANGUAGE.md`](./DAG_SPEC_CROSS_LANGUAGE.md) (language-agnostic core + per-language divergence). Where this catalog and those specs disagree, the specs win and this file must be corrected.

## What conformance means here

An execution runs in **exactly one** language. There is no shared runtime and no cross-language replay. Therefore conformance is **not** "identical bytes on the wire"; it is:

1. **Identical semantic outcomes.** For a fixed scenario (graph shape + fixed inputs + deterministic task bodies), every SDK MUST produce the same per-task `status`, per-task `result` value (or error type), per-task `skipReason`, and the same `DagResult` aggregate — `completionReason` and the four counts (`success`, `failure`, `skipped`, `total`).
2. **Per-language structural entity-ID checks.** Raw entity-ID **hashes are NOT expected to match** across languages (JS composes one multi-level pre-image and MD5→16; Python/Java/Go re-hash per level with blake2b/SHA-256→64 — see `DAG_SPEC_CROSS_LANGUAGE.md` §2.A.1–§2.A.2). What every SDK MUST prove **locally** are the _structural_ invariants of its own IDs: the ID is **name-based**, its pre-image contains the **`DAG_NODE_T_` delimiter** exactly once per nesting level, task **names are dash-free** (and free of the reserved token), and task IDs are **disjoint from counter IDs**.

Task bodies in this catalog are restricted to **deterministic arithmetic and string operations** (and, for structure, `runInChildContext` / nested `dag`). No wall-clock, randomness, IO, `invoke`, `callback`, or `wait`-with-real-duration appears in a _result-bearing_ body, so every SDK computes byte-identical result values. (One `wait` appears only as an ordering edge in a replay-oriented example and never contributes a result.)

---

## Part A — Numbered scenario catalog

**Conventions used in every scenario.**

- **Graph** lists each task as `name (kind, deps=[…], triggerRule, runIf)`. `triggerRule` is omitted when it is the default `ALL_SUCCESS`. Inline deps (typed, appear in the deps map) are written `deps=[x]`; ordering-only builder edges are written `after=[x]`.
- **Expected task outcome** is `{status, result | error_type, skipReason}`. `status ∈ {SUCCEEDED, FAILED, SKIPPED, absent}`. `absent` means the task never started (early completion stopped the scheduler first) — it MUST be missing from the results map and `getStatus` MUST return "not present" (§9.6 of `DAG_SPEC.md`).
- **Expected `DagResult`** is `{completionReason, successCount, failureCount, skippedCount, totalCount}`.
- `totalCount` is the number of **registered** tasks (not the number that ran), per `DAG_SPEC.md` §5.7.
- Skips count toward `skippedCount` only, never success or failure. `absent` tasks count toward `totalCount` only.
- All task bodies are shown in pseudocode; each SDK implements them with its real API (`step`/`runInChildContext`/`dag`), never hand-rolled to force a result.

Normalized error-type tokens (§Part B) used below: a failed **step** task normalizes to `"StepError"`; validation failures use the `Dag*Error` tokens.

---

### DAG-1 — Diamond fan-out / fan-in with typed deps

Proves typed data-flow, natural parallelism (two independent branches), and fan-in.

**Graph**

| task    | kind | deps       | body                       |
| ------- | ---- | ---------- | -------------------------- |
| `fetch` | step | `[]`       | return `10`                |
| `ta`    | step | `[fetch]`  | return `deps.fetch + 1`    |
| `tb`    | step | `[fetch]`  | return `deps.fetch * 2`    |
| `merge` | step | `[ta, tb]` | return `deps.ta + deps.tb` |

**Fixed input:** none.

**Expected task outcomes**

| task    | status    | result |
| ------- | --------- | ------ |
| `fetch` | SUCCEEDED | `10`   |
| `ta`    | SUCCEEDED | `11`   |
| `tb`    | SUCCEEDED | `20`   |
| `merge` | SUCCEEDED | `31`   |

**Expected DagResult:** `ALL_COMPLETED`, success **4**, failure **0**, skipped **0**, total **4**.

---

### DAG-2 — Compensation: charge FAILS (the headline compensation case)

`charge` fails ⇒ `ALL_FAILED` refund runs, default-`ALL_SUCCESS` fulfill skips, `ALL_DONE` audit runs ⇒ `COMPLETED_WITH_FAILURES`.

**Graph**

| task      | kind | deps             | triggerRule | body                           |
| --------- | ---- | ---------------- | ----------- | ------------------------------ |
| `charge`  | step | `[]`             | ALL_SUCCESS | `throw Error("charge failed")` |
| `fulfill` | step | `after=[charge]` | ALL_SUCCESS | return `"fulfilled"`           |
| `refund`  | step | `after=[charge]` | ALL_FAILED  | return `"refunded"`            |
| `audit`   | step | `after=[charge]` | ALL_DONE    | return `"audited"`             |

Retries disabled on `charge` (NO_RETRY) so it deterministically ends FAILED after one attempt.

**Fixed input:** none.

**Expected task outcomes**

| task      | status    | result / error_type | skipReason     |
| --------- | --------- | ------------------- | -------------- |
| `charge`  | FAILED    | `StepError`         | —              |
| `fulfill` | SKIPPED   | —                   | `TRIGGER_RULE` |
| `refund`  | SUCCEEDED | `"refunded"`        | —              |
| `audit`   | SUCCEEDED | `"audited"`         | —              |

**Expected DagResult:** `COMPLETED_WITH_FAILURES`, success **2**, failure **1**, skipped **1**, total **4**.

---

### DAG-3 — Compensation: charge SUCCEEDS (symmetric mirror of DAG-2)

Proves the same graph produces the inverse skip/run pattern when the guarded task succeeds, and that a run with skips but no failures reports `ALL_COMPLETED`.

**Graph:** identical to DAG-2 except `charge` returns `"charged"`.

**Expected task outcomes**

| task      | status    | result        | skipReason     |
| --------- | --------- | ------------- | -------------- |
| `charge`  | SUCCEEDED | `"charged"`   | —              |
| `fulfill` | SUCCEEDED | `"fulfilled"` | —              |
| `refund`  | SKIPPED   | —             | `TRIGGER_RULE` |
| `audit`   | SUCCEEDED | `"audited"`   | —              |

**Expected DagResult:** `ALL_COMPLETED`, success **3**, failure **0**, skipped **1**, total **4**.

---

### DAG-4 — `runIf` value-branching (exactly one branch runs)

`classify` yields a fixed verdict; three mutually-exclusive `runIf` branches ⇒ exactly one runs, the other two skip with `RUN_IF_PREDICATE`.

**Graph**

| task       | kind | deps         | runIf                        | body                 |
| ---------- | ---- | ------------ | ---------------------------- | -------------------- |
| `classify` | step | `[]`         | —                            | return `"review"`    |
| `publish`  | step | `[classify]` | `deps.classify == "publish"` | return `"published"` |
| `review`   | step | `[classify]` | `deps.classify == "review"`  | return `"reviewed"`  |
| `block`    | step | `[classify]` | `deps.classify == "block"`   | return `"blocked"`   |

**Fixed input:** none (verdict hard-coded to `"review"` for determinism).

**Expected task outcomes**

| task       | status    | result       | skipReason         |
| ---------- | --------- | ------------ | ------------------ |
| `classify` | SUCCEEDED | `"review"`   | —                  |
| `publish`  | SKIPPED   | —            | `RUN_IF_PREDICATE` |
| `review`   | SUCCEEDED | `"reviewed"` | —                  |
| `block`    | SKIPPED   | —            | `RUN_IF_PREDICATE` |

**Expected DagResult:** `ALL_COMPLETED`, success **2**, failure **0**, skipped **2**, total **4**.

---

### DAG-5 — Trigger-rule matrix: the empty-upstream row (root task per rule)

Six **root** tasks (no deps), one per trigger rule, evaluated against the empty upstream set. Proves the `len > 0` guard on the failure-family rules (`ALL_FAILED`, `ANY_FAILED`) and the vacuous-truth of the success/done family. (Normative table row "Empty (no deps)" in `DAG_SPEC.md` §5.3.)

**Graph** — each task body returns `"ok"`; deps `[]`:

| task            | triggerRule | evaluates to |
| --------------- | ----------- | ------------ |
| `r_all_success` | ALL_SUCCESS | Run          |
| `r_all_failed`  | ALL_FAILED  | Skip         |
| `r_all_done`    | ALL_DONE    | Run          |
| `r_one_success` | ANY_SUCCESS | Skip         |
| `r_one_failed`  | ANY_FAILED  | Skip         |
| `r_none_failed` | NONE_FAILED | Run          |

**Expected task outcomes**

| task            | status    | result | skipReason     |
| --------------- | --------- | ------ | -------------- |
| `r_all_success` | SUCCEEDED | `"ok"` | —              |
| `r_all_failed`  | SKIPPED   | —      | `TRIGGER_RULE` |
| `r_all_done`    | SUCCEEDED | `"ok"` | —              |
| `r_one_success` | SKIPPED   | —      | `TRIGGER_RULE` |
| `r_one_failed`  | SKIPPED   | —      | `TRIGGER_RULE` |
| `r_none_failed` | SUCCEEDED | `"ok"` | —              |

**Expected DagResult:** `ALL_COMPLETED`, success **3**, failure **0**, skipped **3**, total **6**.

---

### DAG-6 — Trigger-rule matrix: mixed succ/fail upstream

Upstream `up_ok` SUCCEEDS and `up_fail` FAILS; six consumers each depend (ordering-only) on **both**, so each evaluates its rule against the status set `{SUCCEEDED, FAILED}` (the "Mixed succ/fail" row). Consumer bodies return a constant so they do not read the failed value.

**Graph**

| task            | kind | deps                     | triggerRule | body                     |
| --------------- | ---- | ------------------------ | ----------- | ------------------------ |
| `up_ok`         | step | `[]`                     | —           | return `"ok"`            |
| `up_fail`       | step | `[]`                     | —           | `throw Error` (NO_RETRY) |
| `c_all_success` | step | `after=[up_ok, up_fail]` | ALL_SUCCESS | return `"c"`             |
| `c_all_failed`  | step | `after=[up_ok, up_fail]` | ALL_FAILED  | return `"c"`             |
| `c_all_done`    | step | `after=[up_ok, up_fail]` | ALL_DONE    | return `"c"`             |
| `c_one_success` | step | `after=[up_ok, up_fail]` | ANY_SUCCESS | return `"c"`             |
| `c_one_failed`  | step | `after=[up_ok, up_fail]` | ANY_FAILED  | return `"c"`             |
| `c_none_failed` | step | `after=[up_ok, up_fail]` | NONE_FAILED | return `"c"`             |

**Expected task outcomes**

| task            | status    | result / error_type | skipReason     |
| --------------- | --------- | ------------------- | -------------- |
| `up_ok`         | SUCCEEDED | `"ok"`              | —              |
| `up_fail`       | FAILED    | `StepError`         | —              |
| `c_all_success` | SKIPPED   | —                   | `TRIGGER_RULE` |
| `c_all_failed`  | SKIPPED   | —                   | `TRIGGER_RULE` |
| `c_all_done`    | SUCCEEDED | `"c"`               | —              |
| `c_one_success` | SUCCEEDED | `"c"`               | —              |
| `c_one_failed`  | SUCCEEDED | `"c"`               | —              |
| `c_none_failed` | SKIPPED   | —                   | `TRIGGER_RULE` |

**Expected DagResult:** `COMPLETED_WITH_FAILURES`, success **4**, failure **1**, skipped **3**, total **8**.

---

### DAG-7 — Trigger-rule matrix: all-failed upstream (ALL_FAILED len>0 satisfied)

Two roots both FAIL; six consumers depend on both ⇒ the "All failed" row. Confirms `ALL_FAILED`/`ANY_FAILED` **run** here (the `len > 0` guard is satisfied), the inverse of DAG-5.

**Graph**

| task            | kind | deps             | triggerRule | body                     |
| --------------- | ---- | ---------------- | ----------- | ------------------------ |
| `u1`            | step | `[]`             | —           | `throw Error` (NO_RETRY) |
| `u2`            | step | `[]`             | —           | `throw Error` (NO_RETRY) |
| `k_all_success` | step | `after=[u1, u2]` | ALL_SUCCESS | return `"k"`             |
| `k_all_failed`  | step | `after=[u1, u2]` | ALL_FAILED  | return `"k"`             |
| `k_all_done`    | step | `after=[u1, u2]` | ALL_DONE    | return `"k"`             |
| `k_one_success` | step | `after=[u1, u2]` | ANY_SUCCESS | return `"k"`             |
| `k_one_failed`  | step | `after=[u1, u2]` | ANY_FAILED  | return `"k"`             |
| `k_none_failed` | step | `after=[u1, u2]` | NONE_FAILED | return `"k"`             |

**Expected task outcomes**

| task            | status    | result / error_type | skipReason     |
| --------------- | --------- | ------------------- | -------------- |
| `u1`            | FAILED    | `StepError`         | —              |
| `u2`            | FAILED    | `StepError`         | —              |
| `k_all_success` | SKIPPED   | —                   | `TRIGGER_RULE` |
| `k_all_failed`  | SUCCEEDED | `"k"`               | —              |
| `k_all_done`    | SUCCEEDED | `"k"`               | —              |
| `k_one_success` | SKIPPED   | —                   | `TRIGGER_RULE` |
| `k_one_failed`  | SUCCEEDED | `"k"`               | —              |
| `k_none_failed` | SKIPPED   | —                   | `TRIGGER_RULE` |

**Expected DagResult:** `COMPLETED_WITH_FAILURES`, success **3**, failure **2**, skipped **3**, total **8**.

> The remaining matrix row — **"All succeeded"** — is exercised by DAG-1 (`ALL_SUCCESS` runs on all-success upstream) and DAG-3 (`ALL_FAILED` skips, `ALL_DONE` runs on all-success). The **"Includes SKIPPED"** row is exercised by DAG-8.

---

### DAG-8 — Skip cascade (and the "Includes SKIPPED" trigger row)

A `runIf`-skip propagates: downstream `ALL_SUCCESS` tasks skip transitively, while an `ALL_DONE` sink still runs. No failures ⇒ `ALL_COMPLETED` despite three skips.

**Graph**

| task   | kind | deps           | triggerRule | runIf                       | body            |
| ------ | ---- | -------------- | ----------- | --------------------------- | --------------- |
| `seed` | step | `[]`           | —           | —                           | return `1`      |
| `gate` | step | `[seed]`       | ALL_SUCCESS | `deps.seed > 100` (⇒ false) | return `"gate"` |
| `d1`   | step | `[gate]`       | ALL_SUCCESS | —                           | return `"d1"`   |
| `d2`   | step | `[d1]`         | ALL_SUCCESS | —                           | return `"d2"`   |
| `sink` | step | `after=[gate]` | ALL_DONE    | —                           | return `"sink"` |

**Expected task outcomes**

| task   | status    | result   | skipReason         |
| ------ | --------- | -------- | ------------------ |
| `seed` | SUCCEEDED | `1`      | —                  |
| `gate` | SKIPPED   | —        | `RUN_IF_PREDICATE` |
| `d1`   | SKIPPED   | —        | `TRIGGER_RULE`     |
| `d2`   | SKIPPED   | —        | `TRIGGER_RULE`     |
| `sink` | SUCCEEDED | `"sink"` | —                  |

**Expected DagResult:** `ALL_COMPLETED`, success **2**, failure **0**, skipped **3**, total **5**.

---

### DAG-9 — Nested DAG (result consumed downstream + scope isolation)

A nested `dag` task produces a `DagResult` consumed by a downstream task in the outer scope. Sub-task names (`x`, `y`) live in the inner scope and are invisible to the outer scope (scope isolation); their entity IDs recurse (`…-DAG_NODE_T_inner-DAG_NODE_T_x`).

**Graph (outer)**

| task      | kind | deps      | body                                   |
| --------- | ---- | --------- | -------------------------------------- |
| `a`       | step | `[]`      | return `2`                             |
| `inner`   | dag  | `[a]`     | registers inner graph (below)          |
| `consume` | step | `[inner]` | return `deps.inner.getResult("y") + 5` |

**Inner graph** (fresh scope):

| task | kind | deps  | body                 |
| ---- | ---- | ----- | -------------------- |
| `x`  | step | `[]`  | return `3`           |
| `y`  | step | `[x]` | return `deps.x * 10` |

**Expected outer task outcomes**

| task      | status    | result                                                                                                                    |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `a`       | SUCCEEDED | `2`                                                                                                                       |
| `inner`   | SUCCEEDED | nested DagResult (normalized: `{completion_reason: "ALL_COMPLETED", counts: {success:2, failure:0, skipped:0, total:2}}`) |
| `consume` | SUCCEEDED | `35`                                                                                                                      |

**Expected inner DagResult:** `ALL_COMPLETED`, success **2**, failure **0**, skipped **0**, total **2** (with `x`→`3`, `y`→`30`).

**Expected outer DagResult:** `ALL_COMPLETED`, success **3**, failure **0**, skipped **0**, total **3**.

**Scope-isolation assertion:** looking up `x` or `y` in the **outer** result MUST return "not present" (they are not outer-scope tasks); a dep handle from the inner scope used in the outer scope MUST fail missing-dep validation (covered by DAG-15).

> **Record note:** the nested-`dag` task's `result` in the normalized record (Part B) is its nested **counts + completion_reason** object (never raw sub-task values), so it is language-neutral and byte-diffable. The inner scenario's per-task detail is asserted in-harness but is not part of the outer scenario's emitted record.

---

### DAG-10 — Empty DAG

Zero registered tasks ⇒ immediate empty result.

**Graph:** `register` registers nothing.

**Expected task outcomes:** none (empty map).

**Expected DagResult:** `ALL_COMPLETED`, success **0**, failure **0**, skipped **0**, total **0**.

---

### DAG-11 — Validation error: cycle → `DagCyclicDependencyError`

**Graph:** `p` deps `[q]`, `q` deps `[p]` (2-cycle). Registration completes; validation (Kahn's algorithm over the union of edges) detects the cycle and the `dag()` call surfaces `DagCyclicDependencyError` (unwrapped; §5.10 / §7.4).

**Expected:** no `DagResult`; the raised **normalized error type** is `DagCyclicDependencyError`.

---

### DAG-12 — Validation error: duplicate task name → `DagDuplicateTaskError`

**Graph:** register `dup` (step) twice (second registration under the same name, any kind).

**Expected:** no `DagResult`; normalized error type `DagDuplicateTaskError`.

---

### DAG-13 — Validation error: invalid name (dash) → `DagInvalidTaskNameError`

**Graph:** register a task named `"fetch-data"` (contains the structural-only `-`). Rejected by the `^[a-zA-Z0-9_]+$` charset rule at registration.

**Expected:** no `DagResult`; normalized error type `DagInvalidTaskNameError`.

---

### DAG-14 — Validation error: invalid name (reserved token) → `DagInvalidTaskNameError`

**Graph:** register a task named `"DAG_NODE_T_root"` (embeds the reserved delimiter token). Rejected by the no-`DAG_NODE_T_`-substring rule.

**Expected:** no `DagResult`; normalized error type `DagInvalidTaskNameError`.

> DAG-13 and DAG-14 share the error token `DagInvalidTaskNameError` but exercise the **two distinct** name rules (dash charset vs. reserved substring); both are required.

---

### DAG-15 — Validation error: missing / foreign-scope dependency → `DagInvalidDependencyError`

**Graph:** in DAG `A`, register task `t` whose deps include a `TaskHandle` that was created in a **different** DAG scope (e.g. a handle captured from a sibling/parent DAG registration), so its id is not in `A`'s registry. Missing-dep validation rejects it.

**Expected:** no `DagResult`; normalized error type `DagInvalidDependencyError`.

---

### DAG-16 — Early completion: `minSuccessful` (threshold)

Linear chain with `maxConcurrency = 1` so completion order is fully determined by dependencies (deterministic across languages). `minSuccessful = 3` stops the scheduler after the third success; the two later tasks never start.

**Graph:** `s1 → s2 → s3 → s4 → s5` (each `s{i}` deps `[s{i-1}]`, returns `i`). Config: `maxConcurrency: 1`, `completionConfig: { minSuccessful: 3 }`.

**Expected task outcomes**

| task | status    | result |
| ---- | --------- | ------ |
| `s1` | SUCCEEDED | `1`    |
| `s2` | SUCCEEDED | `2`    |
| `s3` | SUCCEEDED | `3`    |
| `s4` | absent    | —      |
| `s5` | absent    | —      |

**Expected DagResult:** `MIN_SUCCESSFUL_REACHED`, success **3**, failure **0**, skipped **0**, total **5**.

---

### DAG-17 — Early completion: `toleratedFailureCount` exceeded (threshold)

Linear chain of `ALL_DONE` tasks (so each runs despite the prior failing), `maxConcurrency = 1`. `toleratedFailureCount = 1` ⇒ after the **second** failure the tolerance is exceeded and the scheduler stops.

**Graph:** `t1 → t2 → t3 → t4`; each `t{i>1}` has `triggerRule ALL_DONE` and deps `[t{i-1}]`; every body throws (NO_RETRY). Config: `maxConcurrency: 1`, `completionConfig: { toleratedFailureCount: 1 }`.

**Expected task outcomes**

| task | status | error_type  |
| ---- | ------ | ----------- |
| `t1` | FAILED | `StepError` |
| `t2` | FAILED | `StepError` |
| `t3` | absent | —           |
| `t4` | absent | —           |

**Expected DagResult:** `FAILURE_TOLERANCE_EXCEEDED`, success **0**, failure **2**, skipped **0**, total **4**.

---

### DAG-18 — Custom result-based completion **[TS + Go ONLY]**

A rules engine short-circuits the moment any task returns a `REJECT` verdict — expressible only where the custom-completion predicate can inspect task **results** (`DagCompletionStatus.items[].result`). Python and Java have **no** predicate hook in v1 (threshold-only) and MUST NOT implement this scenario (see `DAG_SPEC_CROSS_LANGUAGE.md` §4.2 and the applicability table below).

**Graph:** `r1 → r2 → r3` (linear, `maxConcurrency = 1`), bodies return verdict objects: `r1`→`{verdict:"ACCEPT"}`, `r2`→`{verdict:"REJECT"}`, `r3`→`{verdict:"ACCEPT"}`. Config: `maxConcurrency: 1`, `completionConfig.shouldComplete`: if any SUCCEEDED item has `result.verdict == "REJECT"` ⇒ `completeBatch(FAILED)` else `continueBatch()`.

**Expected task outcomes**

| task | status    | result                |
| ---- | --------- | --------------------- |
| `r1` | SUCCEEDED | `{verdict: "ACCEPT"}` |
| `r2` | SUCCEEDED | `{verdict: "REJECT"}` |
| `r3` | absent    | —                     |

**Expected DagResult:** `CUSTOM_COMPLETION_FAILED`, success **2**, failure **0**, skipped **0**, total **3**. (`throwIfError()` throws in this case.)

---

### DAG-19 — Order-independence (same DagResult regardless of completion order)

A fan-out whose two branches complete in a **forced different order** across two runs (the harness perturbs branch completion order — e.g. reversed scheduling in run 2, or a replay that flips completion order) MUST yield an **identical** `DagResult` and emit an identical record. This is the observable proof of name-based (order-independent) entity IDs.

**Graph**

| task    | kind | deps     | body                     |
| ------- | ---- | -------- | ------------------------ |
| `root`  | step | `[]`     | return `100`             |
| `b`     | step | `[root]` | return `deps.root + 1`   |
| `c`     | step | `[root]` | return `deps.root + 2`   |
| `merge` | step | `[b, c]` | return `deps.b + deps.c` |

**Expected task outcomes** (identical under either completion order)

| task    | status    | result |
| ------- | --------- | ------ |
| `root`  | SUCCEEDED | `100`  |
| `b`     | SUCCEEDED | `101`  |
| `c`     | SUCCEEDED | `102`  |
| `merge` | SUCCEEDED | `203`  |

**Expected DagResult:** `ALL_COMPLETED`, success **4**, failure **0**, skipped **0**, total **4**.

**Harness requirement:** run the graph twice with `b`/`c` completion order swapped (and, where the runner supports it, across a replay) and assert **the two emitted records are byte-identical** and no `NonDeterministicExecutionError` (or per-language equivalent) is raised.

---

## Part B — Normalized conformance record (JSON schema)

Every SDK emits **one JSON file** at `/Users/parpooya/workplace/dag-conformance-out/<lang>.json` where `<lang> ∈ {ts, python, java, go}`. The file is a single JSON object keyed by scenario id; each value is a **conformance record** carrying the **semantic outcome only** (no raw hashes, no timestamps, no durations).

### B.1 Record shape

```jsonc
{
  "DAG-1": {
    "scenario": "DAG-1",
    "tasks": {
      "<taskName>": {
        "status":      "SUCCEEDED" | "FAILED" | "SKIPPED" | "STARTED",
        "result":      <JSON value> | null,   // present (non-null) only when status == "SUCCEEDED"
        "error_type":  "<normalized token>" | null, // non-null only when status == "FAILED"
        "skip_reason": "TRIGGER_RULE" | "RUN_IF_PREDICATE" | null // non-null only when status == "SKIPPED"
      }
      // absent tasks: OMITTED entirely (never emitted with a null/placeholder status)
    },
    "completion_reason": "<DagCompletionReason>" | null, // null only for validation-error scenarios
    "counts": { "success": <int>, "failure": <int>, "skipped": <int>, "total": <int> },
    "structural_id_checks": {
      "name_based":            <bool>,
      "has_delimiter":         <bool>,
      "dash_free":             <bool>,
      "disjoint_from_counter": <bool>
    },
    "validation_error": "<DagCyclicDependencyError | DagDuplicateTaskError | DagInvalidTaskNameError | DagInvalidDependencyError>" | null
  }
  // ... one entry per applicable scenario
}
```

### B.2 Field rules

- **`tasks`** — one entry per task that reached a terminal (`SUCCEEDED`/`FAILED`/`SKIPPED`) or `STARTED` state. **Absent** tasks (never started, DAG-16/17/18) MUST be omitted. Each task object MUST include all four keys (`status`, `result`, `error_type`, `skip_reason`); the three non-applicable ones are `null`.
- **`result`** — the task's return value serialized as JSON. Numbers are emitted as JSON integers where integral (`10`, not `10.0`) so the four files compare byte-for-byte. For a **nested-`dag`** task the result MUST be the normalized object `{ "completion_reason": <string>, "counts": { "success", "failure", "skipped", "total" } }` (never raw sub-task values). For `map`/`parallel` tasks (not used in this catalog) the result would likewise be a normalized `{ "completion_reason", "counts" }` object.
- **`error_type`** — normalized cross-language token, NOT the native class name. Mapping table:

  | outcome                                                     | normalized token            | native examples                                                                            |
  | ----------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
  | failed `step` task                                          | `StepError`                 | JS `StepError`, Python `StepError`, Java step `RuntimeException`→step-error, Go step error |
  | failed `invoke` task                                        | `InvokeError`               | (not in this catalog)                                                                      |
  | failed `runInChildContext`/`map`/`parallel`/`callback` task | `ChildContextError`         | (not in this catalog)                                                                      |
  | cycle at registration                                       | `DagCyclicDependencyError`  | per-language `Dag*` cyclic error                                                           |
  | duplicate name                                              | `DagDuplicateTaskError`     | —                                                                                          |
  | invalid name                                                | `DagInvalidTaskNameError`   | —                                                                                          |
  | missing/foreign dep                                         | `DagInvalidDependencyError` | —                                                                                          |

  Each SDK owns the native→normalized mapping in its harness. Only the **normalized token** is emitted, so semantic error identity is comparable across languages even though native class names differ.

- **`completion_reason`** — the `DagResult` completion reason string, exactly one of: `ALL_COMPLETED`, `COMPLETED_WITH_FAILURES`, `MIN_SUCCESSFUL_REACHED`, `FAILURE_TOLERANCE_EXCEEDED`, `CUSTOM_COMPLETION_SUCCEEDED`, `CUSTOM_COMPLETION_FAILED`. `null` **only** for validation-error scenarios (DAG-11..15), where no `DagResult` exists.
- **`counts`** — the four `DagResult` counters. For validation-error scenarios all four are `0`.
- **`structural_id_checks`** — the per-language structural ID assertions, computed by each harness from **its own** entity-ID scheme (raw hashes are NOT compared cross-language):
  - `name_based` — every task's operation carries a name-derived ID / `Name` field equal to the task name (not a bare monotonic counter).
  - `has_delimiter` — every task's entity-ID **pre-image** contains the `DAG_NODE_T_` token exactly once per nesting level (checked on the pre-image for single-composition SDKs, and at the level the token is applied for per-level-re-hashing SDKs).
  - `dash_free` — every registered task name matches `^[a-zA-Z0-9_]+$` (no `-`).
  - `disjoint_from_counter` — no task ID collides with a sibling counter ID (a task ID always contains `DAG_NODE_T_`; a counter ID never does).

  For non-validation scenarios with ≥1 registered task, **all four MUST be `true`**. For the **empty DAG** (DAG-10) there are no task IDs to check: emit all four as `true` (vacuously satisfied). For **validation-error** scenarios (DAG-11..15) no task IDs are minted; emit all four as `false` and set `validation_error` non-null.

- **`validation_error`** — non-null only for DAG-11..15 (the raised normalized `Dag*Error` token). `null` for every other scenario. When non-null: `tasks` MUST be `{}`, `completion_reason` MUST be `null`, and every `counts` field MUST be `0`.

### B.3 Serialization / key-sorting (byte-diffability)

To make the four files cleanly **byte-diffable** (so a `diff ts.json python.json` shows only the intentional applicability differences), every emitter MUST:

1. Serialize as **UTF-8 JSON with 2-space indentation** and a single **trailing newline**.
2. **Sort all object keys lexicographically** (ascending, byte/codepoint order) at every level — top-level scenario ids, the `tasks` map, each task object's keys, `counts`, and `structural_id_checks`. (Scenario ids sort lexicographically: `DAG-1, DAG-10, DAG-11, …, DAG-19, DAG-2, …`. This is fine — the requirement is _stable_ ordering, not numeric.)
3. Emit **integers without decimals** (`10`, `0`) and **booleans** as `true`/`false`.
4. Never emit `NaN`, `Infinity`, timestamps, durations, raw entity-ID hashes, or native class names.
5. Emit **only the scenarios that apply to that language** (Part C). Shared scenarios MUST be byte-identical across languages; `ts.json` and `go.json` additionally contain `DAG-18`.

A record for a shared scenario (DAG-1..17, DAG-19) MUST be **byte-identical** across all four files. `DAG-18` appears only in `ts.json` and `go.json` and MUST be byte-identical between those two.

---

## Part C — Language-applicability table

| Scenario | Feature exercised                          | TS  | Python | Java | Go  |
| -------- | ------------------------------------------ | :-: | :----: | :--: | :-: |
| DAG-1    | Diamond fan-out/in, typed deps             | ✅  |   ✅   |  ✅  | ✅  |
| DAG-2    | Compensation (charge fails)                | ✅  |   ✅   |  ✅  | ✅  |
| DAG-3    | Compensation (charge succeeds)             | ✅  |   ✅   |  ✅  | ✅  |
| DAG-4    | `runIf` value-branching                    | ✅  |   ✅   |  ✅  | ✅  |
| DAG-5    | Trigger matrix — empty-upstream row        | ✅  |   ✅   |  ✅  | ✅  |
| DAG-6    | Trigger matrix — mixed succ/fail           | ✅  |   ✅   |  ✅  | ✅  |
| DAG-7    | Trigger matrix — all-failed (len>0)        | ✅  |   ✅   |  ✅  | ✅  |
| DAG-8    | Skip cascade + "includes SKIPPED"          | ✅  |   ✅   |  ✅  | ✅  |
| DAG-9    | Nested DAG + scope isolation               | ✅  |   ✅   |  ✅  | ✅  |
| DAG-10   | Empty DAG                                  | ✅  |   ✅   |  ✅  | ✅  |
| DAG-11   | Validation — cycle                         | ✅  |   ✅   |  ✅  | ✅  |
| DAG-12   | Validation — duplicate name                | ✅  |   ✅   |  ✅  | ✅  |
| DAG-13   | Validation — invalid name (dash)           | ✅  |   ✅   |  ✅  | ✅  |
| DAG-14   | Validation — invalid name (reserved token) | ✅  |   ✅   |  ✅  | ✅  |
| DAG-15   | Validation — missing/foreign dep           | ✅  |   ✅   |  ✅  | ✅  |
| DAG-16   | Early completion — `minSuccessful`         | ✅  |   ✅   |  ✅  | ✅  |
| DAG-17   | Early completion — `toleratedFailureCount` | ✅  |   ✅   |  ✅  | ✅  |
| DAG-18   | **Custom result-based completion**         | ✅  |   ❌   |  ❌  | ✅  |
| DAG-19   | Order-independence                         | ✅  |   ✅   |  ✅  | ✅  |

**Legend:** ✅ = MUST implement and emit a record · ❌ = MUST NOT implement (feature absent in v1).

**Rationale for the DAG-18 exclusion.** Custom, result-based completion (`shouldComplete` inspecting per-task results) is available only in TypeScript and Go per `DAG_SPEC_CROSS_LANGUAGE.md` §3.1 #15 and §4.2: Python has no predicate hook (threshold-only) and Java's completion is factory/threshold-only in v1 (a DAG-owned predicate is feasible later but deferred). Threshold-based early completion (DAG-16, DAG-17) **is** available in all four and is exercised for every language. So `python.json` and `java.json` carry **18** records; `ts.json` and `go.json` carry **19**.

---

## Part D — Per-repo harness integration (how scenarios plug in)

Each SDK implements the scenarios in its **existing** conformance/compliance harness idiomatically, asserts each scenario against this catalog, and writes its normalized `<lang>.json`. The four outputs are then reconciled in [`DAG_CONFORMANCE_RESULTS.md`](./DAG_CONFORMANCE_RESULTS.md).

- **TypeScript** — `packages/aws-durable-execution-sdk-js-conformance-tests/`. One handler per scenario under `handlers/dag/dag_<n>_*.ts` exporting `handler = withDurableExecution(async (event, ctx) => …)`; scenarios use `ctx.dag(name, async (d) => { d.step(name, [deps], fn, opts) })`. A local (`LocalDurableTestRunner`) driver runs all scenarios, builds the normalized record from `DagResult`, and writes `ts.json`.
- **Python** — `tests/e2e/dag_int_test.py` (+ `tests/dag_support`). Uses the in-memory `make_context(state).dag(register, name=…)` runner; `d.step(fn, deps=[…], name=…, run_if=…).trigger_rule(…)`; reads `result.get_status/get_result/completion_reason/success_count`. Emits `python.json` (18 records).
- **Java** — `sdk-integration-tests/.../DagIntegrationTest.java`. Uses `LocalDurableTestRunner`; `ctx.dag("name", d -> { var a = d.step("a", T.class, (deps,s)->…); d.step("b",…).reads(a).dependsOn(w).triggerRule(…).runIf(…); })`; `Deps.get(handle)`, `r.getResult(name)`, `r.getStatus(name)`, `r.completionReason()`. Emits `java.json` (18 records).
- **Go** — `conformance/handlers/*.go`. Self-registering `init()`→`Register(id, factory)`; free-function registration `dag.Step[T](d, name, deps, fn)`, typed access `dag.Get[T](deps, handle)`. A driver iterates the DAG scenario ids, builds records, and writes `go.json` (19 records).

---

## Summary

This catalog defines **19 numbered scenarios** (DAG-1 … DAG-19) forming the cross-language DAG conformance contract, plus a **normalized JSON record schema** (semantic outcome only, byte-diffable via lexicographic key-sorting) that each SDK emits to `dag-conformance-out/<lang>.json`. Coverage spans the diamond with typed deps, both compensation directions, `runIf` value-branching, the **complete** trigger-rule matrix (empty-upstream row with the `ALL_FAILED` len>0 guard, mixed, all-failed, all-succeeded, and includes-SKIPPED rows), skip cascade, nested DAGs with scope isolation, the empty DAG, all five validation-error types, threshold early-completion (`minSuccessful` + `toleratedFailureCount`), custom result-based completion (**TS + Go only**), and order-independence. **17 scenarios apply to all four languages**; DAG-18 (custom completion) applies to **TS + Go only** — so TS and Go emit **19** records each, Python and Java emit **18**. Semantic outcomes (statuses, results, completion reasons, counts, skip reasons, normalized error types) MUST match across languages; raw entity-ID hashes are NOT expected to match, but the four per-language **structural** ID checks MUST hold.
