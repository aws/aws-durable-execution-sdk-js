# Durable Graph POC — Findings (Phase 1)

Package: `@aws/durable-execution-sdk-js-graph`
Scope: design doc §14 Phase 1 — 3-node-ish graph (a 2-node `agent`↔`tools` cycle), one
conditional edge, one interrupt, driven by the §4.4 superstep model on **positional** operation
ids (the §6 fallback), no core SDK changes.

Verification state at time of writing: `tsc --noEmit` exits 0; `jest` 28/28 green (unit +
integration under `LocalDurableTestRunner`).

---

## 1. Does the superstep driver model hold on positional ids? — YES

The core claim of Phase 1 is confirmed. The driver in `src/runtime/run-graph.ts` runs the
LangGraph-shaped loop entirely on public SDK exports:

- **Nodes as contexts, not steps.** Each active node is a `parallel` branch, so it receives a
  fresh `DurableContext` and may legally call `ctx.step(...)` / `ctx.waitForCallback(...)`
  without ever nesting a step inside a step (brief invariant 2). The demo's `agent` node wraps
  the (fake) model call in `ctx.step("invoke-model", …)`, proving sub-superstep granularity
  works.
- **Fold outside steps.** Deltas are folded through `StateSchema.reduce` in the handler body,
  outside any operation. This is pure and re-runs on replay, exactly as §4.5 intends.
- **Routing reads checkpointed state.** The demo's conditional edge routes on whether the last
  (checkpointed) assistant message carried tool calls — never on a live call.
- **Interrupt = `waitForCallback`.** The `tools` node awaits `interrupt(...)`, which is a thin
  wrapper over `ctx.waitForCallback`. The integration test drives it through the canonical
  `getOperation("approval")` → `run()` → `waitForData(SUBMITTED)` → `sendCallbackSuccess(...)`
  pattern and gets the Appendix A trace back byte-for-byte. **Suspension is genuinely free** —
  the invocation ends at the interrupt and resumes on the external callback.
- **Composition works.** A test runs `runGraph(context, …)` inside a handler that also has its
  own `pre`/`post` steps around it; the surrounding operations and the graph's internal
  operations coexist. This validates the §2/§4.3 decision that a graph is _an operation inside a
  workflow_, not the whole program.

The model holds. Nothing about the driver required a core change.

---

## 2. Where positional identity hurts (concrete)

The POC rides on the SDK's positional ids (`3-2-1`) and only encodes the structural path into
the operation **`Name`** (`src/identity/operation-path.ts`). That works, but here is precisely
where it costs us, with the concrete mechanism:

### 2.1 Frontier ordering is load-bearing for _identity_, not just routing

Because a node's identity is its **ordinal** within the superstep's `parallel` call, the order
in which we present the frontier to `parallel` _is_ the identity assignment. If tick 1 presents
`[alpha, zeta]` on the first run and `[zeta, alpha]` on replay, then `alpha`'s recorded result
would be replayed into `zeta`'s slot — a silent misattribution, not an error.

We defend against this by sorting the frontier (`orderFrontier` = dedupe + `.sort()`), so
ordering is deterministic. But note what this means: **the sort is not a nicety, it is a
correctness requirement** under positional ids. A path-identity scheme would let a reordered
frontier resolve correctly because each branch's id would be `t1/<nodeName>`, independent of
position. Test `orders a multi-node frontier deterministically` demonstrates the ordered
frontier; the _pain_ is that we are forced to impose that order and can never relax it.

### 2.2 Attribution can't rely on batch result ordering

The brief warns `BatchResult.getResults()[i]` is not guaranteed to align with `active[i]`.
Confirmed by design: we had to carry the node name _inside each branch's return payload_
(`{ node, delta }`) and rebuild a `Map<node, delta>` to fold correctly, then iterate the
_ordered_ frontier to fold deterministically. With path identity we'd still want the payload
tag for clarity, but the determinism of the fold currently leans on the same ordering discipline
as 2.1.

### 2.3 Inserting a node mid-flight is categorically fatal

This is the sharpest pain and the clearest reproduction of the design doc's §5.4 claim.
Under positional ids, every operation after an inserted one shifts by one ordinal. So if a
deploy adds a node to a superstep (or adds a `ctx.step` inside a node) while an execution is
in flight, **every subsequent operation's recorded result lands in the wrong slot on replay.**
The SDK's own `validateReplayConsistency` will _usually_ catch this as a `Name`/`Type` mismatch
(because we also encode the path into the name — that is the one thing the fallback buys back),
but the failure is positional coincidence, not design: two operations that happen to share a
type and name at the shifted position would slip through. Path identity makes unchanged paths
resolve and only genuinely-new paths execute (§5.4 point 3) — the POC cannot get there.

### 2.4 Skipping an operation on replay shifts the cursor

Same root cause: positional ids assume a single linear instruction stream per context. A graph
does not have one — it has a tree-shaped address space (tick → node → local op). Encoding that
tree into the _name_ documents it but does not make it the _identity_, so we inherit the linear
assumption's fragility.

**Net:** the driver _works_, but every one of the §5.4 "gained" properties is currently a
_lost_ property we must discipline around. The POC is living proof of the exact constraints the
seam is meant to remove.

---

## 3. What an `operationIdProvider` seam would need to accept — precisely

The design doc §6 Path 2 sketch is close. From building the driver, here is what the provider
must be handed so this runtime can supply path identity, and why each field is load-bearing:

```ts
operationIdProvider?: (info: {
  parentPath: string | undefined;   // parent operation's id/path — REQUIRED to build "t1/tools/approval"
  ordinal: number;                  // keep it: lets a provider fall back to positional, and disambiguates
                                    //   two structurally-identical ops the runtime failed to name distinctly
  name: string | undefined;         // REQUIRED — this is where we already put the structural path today,
                                    //   so a provider can simply promote name→id with zero new plumbing
  type: OperationType;              // useful for prefixing/namespacing (step vs context vs callback)
  subType: OperationSubType | undefined; // we already ride custom subType strings; a provider may want them
}) => string;
```

Findings that sharpen the sketch:

1. **`name` is the single most important input.** We already compute the full structural path
   and pass it as the operation `Name` (e.g. `t1/tools` for a node, `attest-t1` for the
   attestation step, `approval` for the interrupt). A provider that simply returns
   `hashPath(name)` when `name` is set, and falls back to positional otherwise, would give this
   runtime correct path identity **with no change to the driver at all** — the driver is already
   naming everything structurally. This is the cheapest possible integration and argues for
   Path 2 over Path 1 strongly.
2. **`parentPath` must be the resolved id of the parent**, i.e. whatever the provider returned
   for the parent, not the positional prefix. The doc notes child contexts already inherit the
   parent entity id as `stepPrefix`; the provider must compose with _that_ so nested `runGraph`
   (subgraphs) produce `…/t1/tools/<subgraph>/t0/model`. Confirmed necessary by the composition
   test — a graph nested in a workflow needs its paths rooted at the enclosing context.
3. **Purity contract must be explicit and enforced-by-documentation.** The provider is invoked
   on the hot path _before_ the operation runs (it is the dedup key). A provider that reads the
   clock/RNG/state silently breaks replay. `@internal` + a doc-level "unsupported if
   non-deterministic" is the right mitigation (matches the doc). The runtime's own path helpers
   are already pure functions of `(tick, nodeName, localName)` — invariant 4 — so a
   graph-supplied provider inherits that purity for free.
4. **It does _not_ need input/state.** Confirmed: the driver never needs operation inputs to
   build an id, and must not — the id has to be computable before running to look up a prior
   result (§5.3). The seam should deliberately _omit_ input from `info` to make the wrong thing
   impossible.
5. **A length/charset contract is needed.** We hash to 16 hex chars (`hashPath`) to match the
   SDK convention and stay clear of a possible `Operation.Id` length cap (§5.6, still
   unverified). The seam doc should state the cap so providers know whether hashing is mandatory
   or optional.

---

## 4. Is `BatchResult`'s real API adequate for superstep failure policy? — YES for fail-fast; PARTIAL for richer policies

- Fail-fast (the POC's choice, §15 q6) is trivial: `batch.throwIfError()` after the `parallel`
  call. Works, tested implicitly (a node throw would fail the superstep via the child context).
- Richer policies (§4.7 `minSuccessful` / `toleratedFailureCount`) are expressible: `parallel`
  accepts `completionConfig`, and `BatchResult` exposes `succeeded()`/`failed()`/`hasFailure`/
  counts. Adequate.
- **Gap for a graph specifically:** `getResults()` is not index-aligned to branches (§2.2), and
  the `STARTED` set is explicitly _not stable across suspend/resume_ (per the SDK's own
  `batch.ts` docs). So a superstep failure policy that wants "which _nodes_ failed" must, again,
  carry the node name in the payload and read `failed()[].error` / the payload — it cannot map a
  failed slot back to a node by index. This is workable but is a second instance of the same
  ordering-fragility theme as §2.

---

## 5. Does a custom `subType` string survive the round trip? — YES

Directly tested (`tags the graph root context with subType 'DurableGraph'`). We set
`subType: "DurableGraph"` on the root `runInChildContext` and `"GraphSuperstep"` on each tick
context, then read them back via `operation.getSubType()` after a full run. Both strings are
present in `Operation.SubType`. Caveat matching the brief: `getSubType()` is _typed_ as the
`OperationSubType` enum, so consuming the custom value requires a cast
(`getSubType() as unknown as string`). The wire value is faithful; only the TS typing is narrow.
This validates the §4.3 observability-without-core-changes plan.

## 6. Does folding deltas outside steps behave across replay? — YES

The fold is pure CPU over checkpointed state and re-runs every invocation. The interrupt test is
the real proof: the execution suspends at t3 and resumes on a _fresh invocation_, which replays
t0–t2 (folding their recorded deltas) before continuing. The final message history is exactly
the expected 6-message Appendix A trace, so the re-fold reproduced identical state. The
delta-fold property test (`folding N deltas equals applying them sequentially`) covers the pure
algebra separately.

---

## 7. Where the design doc was wrong / underspecified

1. **`WaitForCallbackConfig` is not a public export (SDK friction, blocks §4.6 as written).**
   The brief lists its signature, but in v2.3.0 it is a _forgotten export_ — api-extractor emits
   `(ae-forgotten-export) The symbol "WaitForCallbackConfig" needs to be exported by the entry
point`, and it is not re-exported from the package root. A consumer literally cannot name the
   config type of the very method the interrupt design depends on. **Workaround:** `interrupt()`
   redeclares the fields it passes through (`InterruptConfig`), reusing the public `Duration` and
   `Serdes` types. Same applies to `WaitForCallbackSubmitterFunc`. This should be filed against
   core — a framework building on `waitForCallback` needs its config type.
2. **§4.4 pseudocode dispatches nodes directly under the graph context; the demo needed a tick
   context.** The doc's `runGraph` calls `context.parallel("tick-${tick}", …)` straight on the
   graph root. To get the `"GraphSuperstep"` subType rendering (which the doc _also_ wants, §4.3)
   we wrap each tick in its own `runInChildContext(subType: "GraphSuperstep")` and call
   `parallel` inside it. Minor, but the two parts of the doc are in mild tension: you can't both
   call `parallel` directly on the root _and_ have a per-tick context to tag.
3. **§4.4's `deltas.getResults()` fold is unsafe as written.** The doc folds
   `for (const delta of deltas.getResults())`, but the brief (correctly) says `getResults()` is
   not ordered/attributable. The doc's own pseudocode would misattribute deltas under a
   completion policy that reorders. Fixed here by tagging each result with its node name and
   folding in ordered-frontier order.
4. **`resume` plumbing is vestigial in the `waitForCallback` model.** §4.4 threads a `resume`
   value into node bodies (LangGraph's `Command({ resume })` shape). But because interrupt _is_
   `waitForCallback`, the resume value is delivered by the callback _directly into the node_,
   not through the driver loop. We keep `NodeContext.resume` for source-compat/API shape, but in
   Phase 1 it is always `undefined` — the real resume path is the callback return. The doc should
   note that its `resume` variable has no job in the `waitForCallback` design and exists only for
   LangGraph parity.
5. **"3 nodes linear" (§14 / brief item 7) is not quite the Appendix A agent.** The refund agent
   is a **2-node cycle** (`agent`↔`tools`) that _executes_ 5 superstep bodies (t0..t4), not 3
   distinct linear nodes. We implemented the Appendix A agent faithfully (it is the more
   valuable test — it exercises a cycle, a conditional edge, and an interrupt) and added a
   separate genuinely-linear 3-node graph in the attestation test to cover the "3 nodes linear"
   wording. Worth reconciling the two descriptions in the doc.
6. **Frontier attestation needs a home for the record; the doc doesn't say where.** §5.4 says
   "checkpoint the expected frontier as part of state" but the driver's state is the _user's_
   graph state (folded deltas), which we must not pollute. We instead record the frontier in a
   dedicated durable `step` per tick (`attest-t<N>`) whose replayed result _is_ the recorded
   frontier — a clean, separate checkpoint. This is a small but real design decision the doc
   leaves open.

---

## 8. Notable SDK friction encountered

- **Forgotten exports** (`WaitForCallbackConfig`, `WaitForCallbackSubmitterFunc`) — see §7.1.
- **`isolatedModules` requires `export type`** for every type re-export in barrel files. Not a
  bug, but every `index.ts` had to split value vs type exports. Expected for anyone building a
  sibling package.
- **`getSubType()` is typed to the enum** while the wire field is `string | undefined`; custom
  subType consumers must cast (§5).
- **No local way to force a mid-execution kill.** `LocalDurableTestRunner` cannot simulate a
  Lambda timeout mid-step (confirmed by the core repo's own `step-interrupted-no-retry` example,
  which is cloud-only). So the _hardest_ replay-identity assertions the design wants (§11 test 1:
  "kill between supersteps, assert no node ran twice") cannot be written locally — the interrupt
  test exercises a genuine suspend/resume across invocations, which is the strongest replay proof
  available in-process. A cloud integration test would be needed for the process-kill case.
- **`node` on the host is v16 (glibc 2.26); everything runs via `node:22` Docker** — as the
  brief warned. `tsc`/`jest` only work inside the container.

---

## 9. Recommendation carried out of Phase 1

Path 2 (`operationIdProvider` seam) is strongly indicated. The driver already names every
operation with its full structural path, so a provider that promotes `name → id` (with a
positional fallback) is a near-zero-diff integration on the graph side and removes _all four_
positional-identity pains in §2 at once. The seam's `info` object should carry
`{ parentPath, ordinal, name, type, subType }` and deliberately **omit** operation input.

---

## 10. Test-suite findings (Phase 1 §11 coverage)

Added a dedicated Phase 1 suite under `src/__tests__/` (6 files, 22 tests) covering the §11
subset in POC scope. Full package suite: **50/50 green**, `tsc --noEmit` exit 0, via `node:22`
Docker. Files:

- `replay-identity.integration.test.ts` — stable operation tree + no node body runs twice,
  tracked by a module-level counter reset per test (§11.1, in-process subset).
- `interrupt.integration.test.ts` — suspend on `waitForCallback`, zero downstream node bodies
  while suspended, correct resume-value delivery (§11.4).
- `drift-detection.integration.test.ts` — forced non-deterministic routing → `GraphDriftError`
  (§11.2).
- `fan-out-ordering.integration.test.ts` — stable ordered frontier behaviour (§11.3).
- `delta-folding.test.ts` — folding N deltas == expected final state; reducers never see
  partial state; pure/non-mutating; idempotent re-fold (§11.5).
- `composition.integration.test.ts` — `runGraph` inside a handler with `ctx.step` before/after
  and a `ctx.waitForCallback` around it (§11.7, §4.3).

Two genuinely NEW findings surfaced while writing the tests (neither was in the implement_core
notes):

### 10.1 Frontier attestation has a blind spot for the FIRST tick computed after a resume

This is the sharpest new finding and it refines §5.4 / §7.6. Attestation records a tick's
frontier in a durable step (`attest-t<N>`) at the _top_ of that tick's loop iteration, i.e.
**immediately before dispatch**. A drift is only caught if the tick's frontier was recorded on
an _earlier_ invocation and recomputed differently on a _later_ one.

But when a node interrupts, the invocation ends _inside_ that tick's dispatch — after that
tick's own attestation, but **before** `route()` runs to produce the _next_ tick's frontier.
So the next tick's frontier is first computed (and first recorded) only on the _resume_
invocation. There is no pre-suspend record for it to diverge from. Concretely, my first drift
reproduction put the interrupt in `seed` (tick 0) and made `seed`'s router impure; the graph
happily ran the "wrong" branch on resume with **no** drift error, because `attest-t1` was
authored fresh on the resume run.

The reproduction only fires when the divergent routing decision feeds a tick whose attestation
was already recorded _before_ the suspension — i.e. the interrupt must live in the **routed-to**
node (tick 1), not in the node that does the routing (tick 0). The working test encodes exactly
this: `seed` (tick 0) completes and records `attest-t1 = [alpha]`, `alpha` (tick 1) interrupts;
on resume the impure router yields `[beta]`, and `assertFrontierMatchesRecord(1, [beta])`
compares against the recorded `[alpha]` → `GraphDriftError (tick 1: recorded=[alpha]
computed=[beta])`.

**Implication for the design:** attestation as currently placed protects a tick's frontier only
across a replay boundary that occurs _at or after_ that tick. A divergence in the very next
frontier after a suspend point is invisible to it. Phase 2's path-identity scheme does not have
this specific hole (each op resolves by path regardless of when it was first seen), but any
attestation-based net — including the one the doc mandates as a day-one requirement — must
document that its coverage is "ticks recorded on a prior invocation," not "all ticks." A
stronger net would checkpoint the _routing decision itself_ at the end of each tick (before the
invocation can end), not just the next frontier at the top of the next tick.

### 10.2 A failed graph execution surfaces on the RESULT, not by rejecting the run promise

Non-obvious `LocalDurableTestRunner` contract that shaped every drift/failure assertion:
`runner.run()` **resolves** even when the execution fails. The failure is surfaced on the
returned `TestResult`:

- `result.getStatus()` is not `"Succeeded"`;
- `result.getResult()` **throws** an `Error` whose `message` is the thrown error's message
  (here, the full `GraphDriftError` message including `tick N: recorded=[…] computed=[…]`);
- `result.getError()` returns the structured error (and itself throws if the execution
  succeeded).

So `await expect(runner.run()).rejects.toThrow(...)` is WRONG for a durable failure — the
promise resolves. The correct pattern is `const r = await runner.run(); expect(() =>
r.getResult()).toThrow(...)`. The `GraphDriftError` class identity does not survive the Lambda
error boundary (it comes back as a plain `Error` with the message and stack preserved), so
assert on the message text, not `instanceof GraphDriftError`. Unit-level `instanceof` still
works and is covered separately in `frontier-attestation.integration.test.ts`.

### 10.3 Confirmations (not new, but verified by the new tests)

- **No node body runs twice across a genuine suspend/resume replay.** The module-level counter
  shows completed-tick node bodies at count 1 after a full cross-invocation replay; the
  suspended node's body may re-enter once on resume but folds its delta exactly once (asserted
  via the single-occurrence trail check). This is the strongest in-process replay-identity proof
  available (the mid-step process-kill case remains cloud-only, §8).
- **Suspension is free at the node granularity too.** While the callback is `SUBMITTED`, the
  downstream node's module-level counter is provably 0 — nothing beyond the interrupt ran.
- **Composition is identity-neutral.** Surrounding `ctx.step`/`ctx.waitForCallback` operations
  and the graph's internal `t<N>/<node>` operations coexist in one tree, each runs exactly once
  across the surrounding suspend/resume, and the custom `subType`s (`DurableGraph`,
  `GraphSuperstep`) survive even when the graph is nested inside a larger workflow.
- **Reducers never observe partial state.** An instrumented channel reducer recorded only its
  own channel's consistent prior values (`[0, 10]`), never a half-applied whole-state object,
  confirming the fold hands each reducer its channel value in isolation.
