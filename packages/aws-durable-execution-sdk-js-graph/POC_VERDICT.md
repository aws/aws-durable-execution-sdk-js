# Durable Graph POC — what it decided

Phase 1 spike of `the Durable Graph design doc`. Everything below is backed by either
a passing test, a source citation, or raw Lambda backend history. Nothing here is inferred.

**Verdict: the design's core thesis holds. Build it. Two design claims need correcting, and one
open question flipped from "needs a decision" to "already answered."**

- Package: `packages/aws-durable-execution-sdk-js-graph` (untracked; core SDK never modified —
  `git -P status --short` shows only the new directory)
- Local: 11 suites / 50 tests green, `tsc --noEmit` clean
- Cloud: deployed to <test-account> / us-east-1, 7/7 validations passed, resources destroyed after

---

## 1. The load-bearing question: does the superstep driver model hold?

**Yes.** Verified in the real backend, not just locally.

The §4.4 driver works essentially as written. Nodes dispatched as `parallel` branches each
receive a fresh `DurableContext`, so a node can call `ctx.step(...)` without nesting a step in a
step — which is the whole point of the design's sub-superstep granularity claim (§1). Confirmed
in cloud history: `invoke-model` and `lookup-order` are independently checkpointed steps _inside_
node contexts.

**Zero-cost suspension is real** (the headline claim of §1/§4.6/Appendix A). At the interrupt the
invocation _ended_ — `InvocationCompleted` appears in history while the execution's `Status` is
still `RUNNING`. Across a 90-second idle suspension: CloudWatch `Invocations` Sum = 1 (the
pre-suspend invocation only), `Duration` SampleCount = 1, and the durable history stayed frozen at
42 events. It is not polling.

**Replay across genuine process death is proven.** I verified this from raw history myself rather
than trusting the subagent: the final 60-event history contains 27 operation-start events with 27
**unique** operation IDs — zero duplicate `StepStarted`/`ContextStarted` — despite two distinct
`InvocationCompleted` boundaries. No completed operation re-executed. No duplicated side effect.
This is the assertion `LocalDurableTestRunner` structurally cannot make, which is why the cloud
test mattered.

---

## 2. Open questions this POC closes

### §15.3 / §5.6 — `Operation.Id` length cap and uniqueness scope → **ANSWERED**

| Question          | Answer                                                       |
| ----------------- | ------------------------------------------------------------ |
| Length cap?       | **Yes — 256 characters, hard, on `Operation.Name`**          |
| Uniqueness scope? | **Execution-wide**, and IDs are positional, not name-derived |

The cap was pinned by bisection, and I re-verified the boundary from the raw execution records:

- node name 253 chars → recorded name 256 → `SUCCEEDED`
- node name 254 chars → recorded name 257 → `FAILED`, `CheckpointUnrecoverableExecutionError`:
  `Value 't0/nxxx…' at 'updates.3.member.name' failed to satisfy constraint: Member must have
length less than or equal to 256`

Note it fails **unrecoverably** — a too-long name kills the execution rather than degrading. So
§5.6's "we plan to hash regardless; the cap decides whether it is mandatory" resolves to:
**hashing is mandatory.** A deep or long-named graph will exceed 256 raw characters, and the
failure mode is fatal, not cosmetic.

Uniqueness: 28 distinct 16-hex IDs, execution-wide unique, and identically-named steps received
_different_ IDs — confirming from the outside that identity is positional.

### §15.1 — identity Path 1 vs Path 2 → **evidence strongly favours Path 2**

The strongest finding of the spike, and it was not anticipated by the doc: **the driver already
names every operation with its full structural path.** It has to, because that is the §6 fallback.

That means an `operationIdProvider` seam that simply promotes the existing `name` into the ID is a
_near-zero-diff_ integration for this library — the paths are already computed, already pure, and
already threaded through. Path 2 is not "add a new capability to core"; it is "let core use the
string the caller already passed." Path 1 (forking the replay loop on
`DurableExecutionApiClient`) would rebuild the checkpoint manager, termination classification, and
6 MB guard to obtain that same string.

Precise requirement for the seam, from implementation experience: it must receive
`{ parentPath, ordinal, name, type, subType }` and it must **omit operation input** — the ID has to
be computable _before_ the operation runs, in order to look up a prior result. The doc's §6
signature is correct as drafted.

### §15.6 — superstep failure policy → **fail-fast is the right default**

The POC uses `batch.throwIfError()`. `ParallelConfig.completionConfig` is available for the
tolerant variants later, but fail-fast composes correctly with the child-context boundary and
produces a clean, single failure surface. No reason found to default otherwise.

---

## 3. Two design-doc claims that are wrong

### §4.3's `"GraphNode"` subType tag is impossible in core v2.3.0

I predicted this from the type definitions and then confirmed it in the real backend.

`NamedParallelBranch` is only `{ name?, func }` — no subType field. And `ParallelConfig`
(`src/types/batch.ts:414`) **omits** `topLevelSubType` / `iterationSubType`, even though the
`@public` `ConcurrencyConfig` (~line 467) exposes both. So a `parallel` caller has no way to tag
its branches.

Cloud history confirms the consequence — the subTypes actually recorded were:

```
Callback, DurableGraph, GraphSuperstep, Parallel, ParallelBranch, Step, WaitForCallback
```

`"DurableGraph"` (root) and `"GraphSuperstep"` (tick) **do** round-trip verbatim, which validates
the larger §4.3 claim that graph-shaped observability needs no core change. But nodes show up as
the built-in `ParallelBranch`, not `GraphNode`. I corrected the overclaiming docstring in
`run-graph.ts`.

This is worth noting because it _passes the doc's own §2 test_: adding those two fields to
`ParallelConfig` is a missing **primitive** (the concurrency layer already supports it), not a
missing framework. It is a smaller and more defensible core ask than `operationIdProvider`.

### §4.4's fold loop is unsafe as written

The doc has:

```typescript
for (const delta of deltas.getResults()) {
  state = graph.schema.reduce(state, delta);
}
```

`BatchResult.getResults()` carries no index-alignment guarantee with the input branch list, so
this can silently misattribute a delta to the wrong node. The POC instead has each node return
`{ node, delta }` and folds in sorted-frontier order via a `Map`. **Fix this in the doc** — under
reducers that are not commutative, the bug is a wrong answer with no error.

---

## 4. Where positional identity actually hurts (concrete, not theoretical)

§5.4 claims path addressing buys three properties. The POC confirms all three are genuinely
_absent_ under positional IDs, and adds a fourth:

1. **Frontier ordering is a correctness requirement, not a nicety.** The ordinal _is_ the identity,
   so a reordered frontier misattributes recorded results — silently. The POC sorts node names
   defensively, and the fan-out test honestly asserts "we always sort" rather than pretending
   reordering survives.
2. **`getResults()` is not index-aligned** (above), forcing node names into payloads.
3. **Inserting a node mid-flight is categorically fatal** — every later ordinal shifts.
4. **Skipping an operation on replay shifts the cursor**, so "skip" is not expressible.

The §5.4 tradeoff is real in the other direction too: positional IDs give _free_ drift detection.
The POC implements frontier attestation anyway (§5.4 calls it day-one), and the reviewer proved it
is load-bearing by mutation testing — disabling the check made the drift tests fail, and restoring
it made them pass. That is evidence the tests are not vacuous.

---

## 5. SDK friction worth filing against core

1. **`WaitForCallbackConfig` and `WaitForCallbackSubmitterFunc` are forgotten exports** in v2.3.0
   (api-extractor flags them). The type of the _primary interrupt mechanism_ is not nameable by a
   consumer. The POC had to redeclare `InterruptConfig`.
2. **`ParallelConfig` missing the two subType fields** (§3 above).
3. **`getSubType()` is typed to the `OperationSubType` enum** while the wire field is
   `string | undefined`, so any consumer reading a custom subType must cast.
4. **Callback default serdes is pass-through**, which is a sharp edge: resuming with
   `--result '"approve"'` instead of raw-base64 `YXBwcm92ZQ==` silently delivers a corrupted value
   and routes down the wrong conditional edge. It "succeeds" and gives a wrong answer. (This
   accidentally proved both edges of the conditional work.)

---

## 6. Phase 1 cost measurements (§13 asked for these early)

| Metric          | Value                                                    |
| --------------- | -------------------------------------------------------- |
| Bundle          | 1,698,631 bytes raw / 308,583 zipped                     |
| Cold start      | initDuration 625.12 ms (`nodejs:22.DurableFunction.v36`) |
| Warm invocation | 45–470 ms, mean ~249 ms                                  |
| Peak memory     | 111 MB of 512                                            |

No `@langchain/core` dependency was taken, so this is the floor. §15.2 remains genuinely open, and
these numbers are the baseline to judge it against.

---

## 7. What I did not prove

- **Path-based identity itself.** Out of Phase 1 scope by design; `hashPath`/`localPath` exist and
  are unit-tested but the runtime does not use them. That is Phase 2 behind the seam.
- **`Send`/dynamic fan-out, subgraph nesting, filesystem serdes, topology hashing, streaming.**
  Deliberately out of scope.
- **Long-conversation payload limits (§7).** The 6 MB ceiling was never approached. Note the
  unresolved tension I flagged in review: the delta model keeps _checkpoints_ small, but `runGraph`
  still returns fully-folded state, so the child-context result is a snapshot. That boundary is
  where offload will be needed, and it is untested.
- **Multi-node parallel supersteps in cloud.** The demo agent's frontier is one node per tick.
  Fan-out was only exercised locally.

---

## 8. Recommendation

Proceed to Phase 2. Ask the SDK team for **both** core changes together, since they are small,
additive, default-preserving, and both pass the doc's own "primitive, not framework" test:

1. `operationIdProvider` on `DurableExecutionConfig` (§6, `@internal`) — six bind sites.
2. `topLevelSubType` / `iterationSubType` on `ParallelConfig` — two fields already present on
   `ConcurrencyConfig`.

Also correct the doc: the §4.4 fold loop, the `"GraphNode"` claim, and promote "hash paths" from
optional to mandatory now that the 256-char cap is known to be fatal.

Reproduce with:

```bash
cd <repo-root>
docker run --rm -v "$PWD":/w -w /w -u $(id -u):$(id -g) -e HOME=/tmp node:22 \
  sh -c 'npm run test --workspace=@aws/durable-execution-sdk-js-graph'
# cloud: cloud/deploy.sh, then cloud/validate-suspend-replay.sh and cloud/validate-name-limits.sh
```
