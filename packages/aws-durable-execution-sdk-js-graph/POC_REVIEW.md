# Durable Graph POC — Independent Review (Phase 1)

Reviewer stance: skeptical, verify-by-execution. Nothing below is taken from a prior stage's
self-report; every claim was re-derived by reading the source and running commands (including
two mutation tests that deliberately broke behaviour to prove the tests are non-vacuous).

**Overall verdict: the POC is sound.** The superstep driver model holds on positional ids, the
durability invariants are respected, the tests genuinely prove their claims (two of them
verified by mutation), scope is disciplined, and `POC_FINDINGS.md` is honest. No `NEEDS_CHANGES`
token is emitted. A short list of minor nits follows the verdicts.

## Verification performed

- `git -P status --short` and `git -P diff [--cached] --stat` — see A.1.
- `grep` for `Date.now|Math.random|randomUUID|crypto|new Date|uuid|nanoid|hrtime` across `src/` — see A.2.
- Full suite via the exact Docker command in the brief: **`tsc --noEmit` exit 0; jest 11 suites / 50 tests, all green** (3.9 s).
- **Mutation test 1** — disabled the drift check (`if (false && …)` in `frontier-attestation.ts`):
  the two `drift-detection` assertions flipped to FAIL (via re-suspend hang), the no-false-positive
  control still passed. Reverted.
- **Mutation test 2** — replaced `interrupt`'s `ctx.waitForCallback` with a canned `ctx.step`:
  all 3 `interrupt` tests FAILED (`bodyRuns.after` became 1; `isWaitForCallback()` became false).
  Reverted. Post-revert full suite re-run: 50/50 green, `git status` shows only the untracked
  package.

---

## A. Correctness of durability claims

**A.1 — Core untouched. PASS.** `git status --short` shows exactly one entry:
`?? packages/aws-durable-execution-sdk-js-graph/` (untracked). `git diff --stat` and
`git diff --cached --stat` are both empty. No file under `packages/aws-durable-execution-sdk-js/`
or `packages/aws-durable-execution-sdk-js-testing/` is modified. The POC consumes public exports
only (peerDependency on core, devDependency on testing).

**A.2 — No non-deterministic identity/naming. PASS.** The only `crypto` use is
`createHash("md5").update(path)` in `hashPath` (`identity/operation-path.ts:84`), which hashes a
**static structural path string** derived purely from `(tick, nodeName, localName)` — no clock,
RNG, UUID, attempt counter, or state value. All other grep hits are comments. Operation names in
the running driver come from `nodePath(tick, nodeName)` and `tickPath(tick)` (both pure);
`hashPath` is not even on the runtime path (see nit 1). Identity inputs are pure functions of
logical position, exactly as design §5.3 / brief invariant 4 demand.

**A.3 — Reducers and routing pure. PASS.** `channels.ts` (`lastValue`, `appendValue`,
`messagesValue`) and `StateSchema.reduce` perform no I/O, clock, or RNG and never mutate inputs
(spread-copy everywhere; verified by `delta-folding.test.ts` "never mutates the input state" and
the instrumented-reducer test). `route`/`orderFrontier`/router functions in `state-graph.ts` read
only `state` and node topology. The demo's conditional edge routes on the checkpointed message,
not a live call.

**A.4 — No nested steps. PASS.** The driver structure is:
`runInChildContext("DurableGraph")` → per tick `context.step("attest-tN")` (on the graph-root
context) and, as a sibling, `context.runInChildContext("superstep-N", subType:"GraphSuperstep")`
→ `tickCtx.parallel("tick-N", …)`. Each `parallel` branch receives a fresh `DurableContext`, and
node bodies call `ctx.step(...)` on that branch context. No `ctx.step` is ever lexically or
dynamically nested inside another `ctx.step`. The attestation step and the superstep child are
siblings, not nested. Confirmed the SDK's own tree accepts `waitForCallback` inside a `parallel`
branch (the interrupt tests exercise exactly that and pass).

**A.5 — Fold runs outside steps, replay-safe. PASS.** In `run-graph.ts` the fold
(`state = graph.schema.reduce(state, …)`) runs in the handler body **after** the `parallel`
result returns and **outside** any operation, so it re-executes on every replay. Because the
reducers are pure (A.3) and folding is ordered by the sorted active frontier (not by the
un-guaranteed `BatchResult.getResults()` order — the code builds a `Map<node,delta>` and iterates
`active`), the re-fold is deterministic. The interrupt/replay integration tests prove the folded
final state is identical across a genuine cross-invocation suspend/resume.

---

## B. Do the tests actually prove what they claim?

This section carried the most weight; I did not trust the pass count and instead broke the code.

**Interrupt test — proven non-vacuous by mutation. STRONG.** `interrupt.integration.test.ts`
asserts (a) `bodyRuns.after === 0` _while the callback is SUBMITTED_ and (b)
`approvalOp.isWaitForCallback() === true`. Mutating `interrupt` to bypass `waitForCallback`
(return a canned value via `ctx.step`) made **all three** interrupt tests fail: `after` ran
(counter 1, not 0) and `isWaitForCallback()` returned false. This proves the test genuinely
detects (a) a downstream node executing while suspended and (b) the interrupt not being a real
`waitForCallback`. The "zero node executions while suspended" claim is real and load-bearing.

**Drift test — proven non-vacuous by mutation, with one caveat. ADEQUATE.** Disabling the drift
check made the two `drift-detection` assertions fail (they no longer see the error) while the
no-false-positive control kept passing — so the tests are not tautological and attestation is
load-bearing. Caveat worth recording: with the check removed the tests fail via **timeout**, not
a clean assertion, because the divergent resume re-enters an interrupting node and submits a new
callback the harness never completes. That is a faithful manifestation of the silent-corruption
the check prevents, but the assertion `expect(() => result.getResult()).toThrow(/frontier drift/i)`
plus `toContain("tick 1"|"alpha"|"beta")` is what makes the _positive_ test specific to
`GraphDriftError` rather than "any throw". The message-level match is appropriate given the SDK
error boundary does not preserve the `GraphDriftError` class (honestly documented in FINDINGS
§10.2); class identity is separately covered at unit level in
`frontier-attestation.integration.test.ts`. Not vacuous.

**Replay-identity test. SOUND (in-process limit acknowledged).** Uses a module-level
`bodyRuns` counter reset per test, incremented in the node body _outside_ `ctx.step`, and asserts
`bodyRuns.a === 1` / `bodyRuns.c === 1` across a real suspend/resume, plus a single `"b"` in the
trail. This would fail if the driver re-ran a completed node body on replay. The honest limitation
(no local mid-step process kill; interrupt-driven replay is the strongest in-process proof) is
stated in the test header and FINDINGS §8 — accurate.

**Fan-out ordering test. SOUND but partly weaker than it reads.** The strongest assertions are
pure/observable: `graph.entry` sorted, folded `hits` deterministic, stable across 3 runs, and
`t0/alpha|beta|gamma` names present. It does **not** actually present the frontier in a permuted
order and assert stable identity (path identity is Phase 2); it demonstrates the _sort_ that pins
positional identity. That matches the POC's scope and is honestly framed in the test header, but
it proves "we always sort", not "reordering is survived" — correctly, because reordering is _not_
survived under positional ids (that is the documented pain).

**Delta-folding tests. SOUND.** Property-style: N-delta fold equals expected, idempotent re-fold,
non-mutation (distinct object identities), reducer-never-sees-partial-state (instrumented probe
observes only `[0,10]`), absent/unknown/undefined delta handling. These would fail on a mutating
or order-leaking reducer.

**Composition test. SOUND.** Asserts pre/post steps run exactly once across a surrounding
`waitForCallback` suspend/resume, graph internals (`t0/first`,`t1/second`) coexist with
surrounding ops (`validate`,`review`,`fulfill`), and the custom subTypes survive nesting. Would
fail if the graph perturbed parent replay identity.

No test was found to be tautological or asserting on something trivially true.

---

## C. Fidelity to the design doc

- **`runGraph` takes a context (4.3/4.4). PASS.** Signature is
  `runGraph(parent: DurableContext, graph, input)`; body is `parent.runInChildContext(...)`.
  `compileDurable` is the thin `withDurableExecution` wrapper (4.3 option A). Composition proven.
- **subType tags (4.3). MOSTLY PASS.** `"DurableGraph"` (root) and `"GraphSuperstep"` (tick) are
  applied and their round-trip through `Operation.SubType` is verified by tests. `"GraphNode"` is
  **not** applied — it appears only in a docstring (see nit 2). Minor.
- **Frontier attestation implemented AND load-bearing (5.4). PASS.** Implemented as a per-tick
  `ctx.step("attest-tN")` whose replayed result is the recorded frontier, compared (order-
  sensitive) against the recomputed frontier before dispatch; mismatch throws `GraphDriftError`.
  Mutation test confirms it is load-bearing (removing it changes drift-test outcome). The doc left
  "where to store the record" open; the POC's dedicated attest-step is a clean, defensible choice
  (FINDINGS §7.6). The documented blind spot — a drift in the _first_ frontier computed after a
  resume has no prior record to diverge from — is real, correctly reproduced (interrupt must be in
  the routed-to node), and honestly disclosed.
- **`interrupt` is a direct `waitForCallback`, not a thrown sentinel (4.6). PASS.** `interrupt()`
  calls `ctx.waitForCallback` directly; mutation test confirms the tests detect any deviation
  (`isWaitForCallback()`).

---

## D. Scope discipline

**PASS — no over-building found.** Grep confirms no `Send`/dynamic fan-out class, no subgraph
implementation, no filesystem serdes, no topology hashing, no `@langchain/*` dependency, and no
streaming. `package.json` carries only the core (peer) and testing (dev) SDKs. Explicitly
out-of-scope items are all absent. The demo is hermetic (fake deterministic model, no Bedrock).
`ctx.map` (data-driven fan-out) is not used. The only surplus is dead code, not features (nit 1).

---

## E. Honesty of POC_FINDINGS.md

**PASS — findings are supported by the code, not aspirational.** Spot-checked:

- §1 driver-holds claims (nodes-as-contexts, fold-outside-steps, routing-on-checkpointed-state,
  interrupt=waitForCallback, composition) all match the source and pass under test.
- §2 positional-identity pains are accurate: `orderFrontier` sort is genuinely a correctness
  requirement here; attribution genuinely carries node name in payload (`NodeResult`) rather than
  trusting `getResults()` order — both verified in `run-graph.ts`.
- §5 subType round-trip is real and tested.
- §7.1 forgotten-export friction (`WaitForCallbackConfig`/`WaitForCallbackSubmitterFunc`) is
  reflected by the `InterruptConfig` redeclaration in `interrupt/interrupt.ts` — consistent.
- §7.2 tension (can't both `parallel` on the root _and_ tag a per-tick context) is real: the
  driver added a `runInChildContext("superstep-N")` wrapper, exactly as the finding says.
- §10.1 attestation blind spot and §10.2 (`run()` resolves on failure; `GraphDriftError` class
  identity lost across the boundary) are both consistent with how the drift tests are written and
  assert. These are non-obvious and correctly documented.
- Test inventory (6 new files / 22 new tests; 50 total across 11 suites) matches the executed run.

No finding required correction. If anything, the findings under-sell one point: FINDINGS §5 could
note that `hashPath` and `localPath` are exported/tested but unused by the runtime (nit 1) — minor.

---

## Minor nits (no src change required for the POC to be sound)

1. **Dead identity helpers.** `hashPath` and `localPath` are exported and unit-tested but never
   called by the runtime (`run-graph.ts` uses only `nodePath`/`tickPath`; interrupt names are
   literals like `"approval"`). They are forward-looking (Phase 2) and harmless, but are currently
   dead code relative to Phase 1. Consider either wiring `localPath` into interrupt/step naming
   inside nodes (so node-local ops get structural names too) or marking these `@internal`/"Phase 2".
2. **`"GraphNode"` subType claimed but not applied.** `run-graph.ts:34` docstring and brief item 3
   list a `"GraphNode"` tag, but `parallel` branches carry only a structural `name`, no subType.
   Either drop the docstring claim or note that per-branch subType isn't expressible via
   `ParallelConfig` in v2.3.0 (branch identity still rides in the `name`, so observability is not
   lost — only the label). Purely cosmetic/documentation.
3. **Drift test fails-by-timeout under mutation.** Not a defect in the shipped code, but if a
   future regression disables attestation the drift tests will hang for the full timeout rather
   than fail fast. Optional hardening: give those tests an explicit short `testTimeout` so a
   regression surfaces quickly.
4. **`GraphHandlerEvent.input` is optional and silently defaults to `{}`-init.** `compileDurable`
   passes `event?.input`; a malformed event yields empty initial state rather than an error. Fine
   for a POC, worth a note for Phase 2.

## Answers to the POC's own learning questions

- **Does the superstep driver model hold on positional ids?** Yes — verified by execution and by
  the hermetic refund-agent producing the exact Appendix A trace across a real suspend/resume.
- **Where does positional identity hurt?** Confirmed real: frontier sort is load-bearing for
  _identity_; batch-result order can't be trusted for attribution; node insertion / op-skip is
  fragile. These are documented with concrete mechanisms, not hand-waved.
- **What must an `operationIdProvider` seam accept?** `{ parentPath, ordinal, name, type, subType }`,
  deliberately **omitting** input/state — well-argued in FINDINGS §3 and consistent with the code
  (the driver already names everything structurally, so a `name→id` promotion is near-zero-diff).
- **Is `BatchResult` adequate for superstep failure policy?** Yes for fail-fast (used); partial for
  richer policies — accurately assessed.
- **Does a custom `subType` survive the round trip?** Yes (`DurableGraph`, `GraphSuperstep`),
  tested; typing requires a cast — accurately noted.
- **Does folding outside steps behave across a real replay?** Yes — the interrupt replay
  reproduces identical state.

**Conclusion:** Phase 1 answers its load-bearing question affirmatively and documents the
positional-identity cost precisely. The implementation is faithful, in scope, and its tests are
genuinely protective. Ship as the Phase 1 spike; carry the two `@internal`/docstring nits into
Phase 2 cleanup.
