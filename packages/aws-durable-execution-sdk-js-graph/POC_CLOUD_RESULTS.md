# Durable Graph POC — Cloud Validation Results

Real deployment of the Phase-1 Durable Graph POC to a live AWS account, exercising the runtime
claims the local `LocalDurableTestRunner` structurally **cannot** verify (a genuine
mid-execution invocation end and replay against the real durable backend).

- **Account / region:** `<test-account>` / `us-east-1`
- **Function:** `durable-graph-poc` (runtime `nodejs22.x`, published **version 1**, durable-config
  `{ExecutionTimeout: 900, RetentionPeriodInDays: 1}`, memory 512 MB, timeout 60 s)
- **Runtime version observed:** `nodejs:22.DurableFunction.v36`
- **IAM role:** `durable-graph-poc-role` (trust `lambda.amazonaws.com`; attached
  `AWSLambdaBasicDurableExecutionRolePolicy` + `AWSLambdaBasicExecutionRole`)
- **Handler:** `index.handler`, a single esbuild-bundled CJS file (core SDK bundled in). One
  function serves all validations, dispatching on `event.mode` (`refund` | `longnames`).
- **All validations run against published version `:1`** (not `$LATEST`), per the docs' guidance
  that `$LATEST` is unsupported for production replay.

## Summary

| #   | Validation                                                              | Result                                |
| --- | ----------------------------------------------------------------------- | ------------------------------------- |
| V1  | Happy path — refund graph runs to correct completion after approval     | **PASS**                              |
| V2  | Real suspension at zero cost (no invocation while suspended)            | **PASS**                              |
| V3  | Real replay across a genuine invocation end, no duplicate side effects  | **PASS**                              |
| V4a | Custom `subType` round-trips to `Operation.SubType` in the real backend | **PASS**                              |
| V4b | `Operation.Name` length cap                                             | **PASS (cap found: 256 chars, hard)** |
| V4c | `Operation.Id` uniqueness scope observed                                | **PASS (execution-wide unique)**      |
| V5  | Cold start + bundle size measured                                       | **PASS (reported)**                   |

Nothing was BLOCKED. Reproduction scripts are committed under `cloud/` and are re-runnable.

---

## V1 — Happy path — **PASS**

Started a durable execution (`{"mode":"refund"}`), let it suspend at the `approval` interrupt,
resumed it with a callback-success carrying the decision `approve`, and asserted the final state.

Execution `e912d0fb-…` reached `SUCCEEDED`. Final state (`get-durable-execution
--include-execution-data`, `Result` field) is the exact Appendix A 6-message trace:

```
[0] user      Please refund my order A-91.
[1] assistant Let me look up that order.      toolCalls=[lookup_order{orderId:A-91}]
[2] tool      Order A-91 total 240.
[3] assistant I'll issue the refund.          toolCalls=[issue_refund{orderId:A-91,amount:240}]
[4] tool      Refunded $240 on A-91.
[5] assistant Done — $240 refunded.
orderTotal = 240
```

Asserts: `final == "Done — $240 refunded."` ✔, `messages.length == 6` ✔, `orderTotal == 240` ✔,
refund ToolMessage present ✔.

**Resume mechanics that worked** (documented because the exact CLI form is non-obvious): the
callback uses the SDK's default **pass-through** callback serdes (`deserialize(data) => data`),
so the node receives the raw `Result` bytes verbatim and the demo compares `decision ===
"approve"`. `--result` is a **blob**, so the raw string must be base64-encoded:

```bash
CB=<CallbackId from get-durable-execution-history CallbackStarted event>
aws lambda send-durable-execution-callback-success \
  --callback-id "$CB" \
  --result "$(printf '%s' approve | base64)"   # => YXBwcm92ZQ==
```

(Passing `--result '"approve"'` with `--cli-binary-format raw-in-base64-out` "succeeds" but
delivers a corrupted value — the CLI base64-_decodes_ the argument — and the graph then routes
to the _deny_ branch. First observed empirically, then corrected. Proof both branches are
reachable: an incorrectly-encoded resume produced `[4] Refund denied for A-91. / [5] Understood
— no refund was issued.`, i.e. the conditional edge and deny path also work.)

---

## V2 — Real suspension at zero cost — **PASS** (the headline claim)

Invoked `refund` mode asynchronously (`--invocation-type Event`); the graph advanced through
supersteps t0–t3 and reached the `waitForCallback` operation `approval`, at which point the
Lambda **invocation ended**. Evidence, three independent ways:

1. **`InvocationCompleted` in the history while the execution is still open.** At suspend the
   history is 42 events ending in:

   ```
   37 ContextStarted   ParallelBranch   t3/tools           afefa9726ba8170a
   38 ContextStarted   WaitForCallback  approval           4fb3e154f267cde0
   39 CallbackStarted  Callback                            6ce253c3a078210e
   40 StepStarted      Step   (submitter)                  0f80b6bdd7a91e5d
   41 StepSucceeded    Step   (submitter)                  0f80b6bdd7a91e5d
   42 InvocationCompleted
   ```

   Execution `Status = RUNNING` (suspended/pending the callback), but no invocation is live.

2. **No compute during the suspension window.** Held the suspended execution idle for 90 s (and
   in a separate run 120 s) with no other activity, then queried CloudWatch:

   ```
   AWS/Lambda Invocations, FunctionName=durable-graph-poc, period 60s, Sum
   window 2026-09-10T19:50:10Z .. 19:52:42Z  (covers the whole 90s idle)
   datapoints = 1
     2026-09-10T19:50:00Z  Sum = 1.0     <- the single pre-suspend invocation
   Invocations Sum over window = 1
   ```

   ```
   AWS/Lambda Duration SampleCount over same window = 1  (Sum 386.97 ms, the pre-suspend run)
   ```

   There is exactly **one** invocation datapoint, at the superstep-driving invocation _before_
   suspension. **Zero** invocations occur during the idle suspension window → suspension is not
   polling and bills no compute.

3. **History does not grow while suspended.** Events at suspend = 42; events after the 90 s idle
   = 42 (`RESULT_HISTORY_GREW_WHILE_SUSPENDED=NO`). Nothing runs.

Then the callback-success resumed it and it completed correctly (see V1). **Suspension is
genuinely free.**

---

## V3 — Real replay across a genuine process/invocation end — **PASS**

This is what the local runner cannot do. The V2 suspension forces a real invocation boundary:
the first invocation ends at `InvocationCompleted` (event 42); the callback-success starts a
**second, fresh invocation** that must replay everything before the interrupt and then continue.
Confirmed by two `platform.start`/`InvocationCompleted` pairs in logs/history bracketing the
resume, and by these assertions over the final 60-event history:

- **No completed operation was re-executed on the new invocation.** Counting `StepStarted` and
  `ContextStarted` per operation `Id` across the _entire_ final history:

  ```
  STEP_STARTED_MULTI    = NONE (each completed step started exactly once)
  CONTEXT_STARTED_MULTI = NONE
  ```

  The pre-suspend steps (`attest-t0..t3`, `invoke-model` @ t0/t2, `lookup-order`) each appear
  **once** — they were replayed from checkpoints, not re-run. If replay had re-executed them,
  their `StepStarted` would appear twice.

- **The operation tree / Ids are stable across the boundary.** The `t0/agent`, `t1/tools`,
  `t2/agent`, `t3/tools`, `superstep-N`, `attest-tN` operations keep identical `Id`s and `Name`s
  before and after resume; the post-resume tail (`CallbackSucceeded` → `t4/agent` → graph
  success) is appended without disturbing prior ids.

- **Side-effect non-duplication, concretely:** the three `invoke-model` steps (the fake "model
  call", the closest thing to a side-effect in the hermetic demo) carry three **distinct** ids
  `0290efc46328e521` (t0), `2405b68f3da8d01a` (t2), `6c77458a3f372c3c` (t4), each with exactly
  one `StepStarted`. The two that ran _before_ the process boundary did not fire a second time
  on the replay invocation.

Full final event stream (both invocations, single execution) is in
`/tmp/dg-hist-final.json`; the 60-event trace ends `… 58 ContextSucceeded DurableGraph
refund-approval → 59 InvocationCompleted → 60 ExecutionSucceeded`.

> Note: a dedicated DynamoDB side-effect counter was considered (the brief's "strongest
> evidence" option). It proved unnecessary and was intentionally _not_ added: the durable
> history already records every `StepStarted`/`StepSucceeded` with a stable operation id, so the
> "each step started exactly once across a real replay" assertion is a direct, backend-authored
> proof of non-re-execution — strictly stronger than an app-level counter, which could only
> observe the same steps. Keeping the demo hermetic also avoids extra IAM/table teardown.

---

## V4 — Backend facts the design doc lists as OPEN (§5.6)

### V4a — Custom `subType` survives to `Operation.SubType` — **PASS**

The real backend records our free-form subType strings verbatim in the history:

```
EventId 2  ContextStarted  SubType="DurableGraph"    Name="refund-approval"
EventId 5  ContextStarted  SubType="GraphSuperstep"  Name="superstep-0"   (and superstep-1..4)
```

Both custom strings round-trip faithfully through the real `Operation.SubType` wire field — the
cloud confirms what the local runner only suggested. (SDK-minted subTypes `Step`, `Parallel`,
`ParallelBranch`, `WaitForCallback`, `Callback` appear on the operations we did not tag, as
expected.)

### V4b — `Operation.Name` length cap — **PASS: hard cap of 256 characters**

Probed by running the `longnames` graph with escalating node-name lengths and reading back the
recorded names. The driver encodes the node's structural path into the _context_ name
(`t0/<nodeName>`), so the recorded name length ≈ `nodeName + 3`.

|       node name len | recorded name len | execution status |
| ------------------: | ----------------: | ---------------- |
|                   8 |                16 | SUCCEEDED        |
|                  64 |                67 | SUCCEEDED        |
|             **253** |           **256** | **SUCCEEDED**    |
|             **254** |           **257** | **FAILED**       |
|                 256 |               259 | FAILED           |
| 1024 / 4096 / 16384 |  (would be 1027+) | FAILED           |

The failure is a hard, unrecoverable checkpoint validation error from the backend:

```
ErrorType: CheckpointUnrecoverableExecutionError
ErrorMessage: 1 validation error detected: Value 't0/nxxx…' at 'updates.3.member.name'
              failed to satisfy constraint: Member must have length less than or equal to 256
```

**Largest proven-working `Operation.Name` = 256 characters. 257 characters fails the execution
unrecoverably.** This resolves design doc §5.6's open question with real data and validates
POC_FINDINGS §3.5: a Phase-2 path-identity scheme **must** hash long paths (the POC's `hashPath`
→ 16 hex chars) rather than embed raw structural paths that can exceed 256 chars in deep graphs.

Secondary observation: inner-step names use the **local** label only (`mark`, `invoke-model`,
`lookup-order`, `attest-t0`), not the full path — so in this driver only the per-node _context_
name is at risk of the cap, and it is bounded by `nodeName + len("t0/")`. A node name up to
**253 chars** is safe at tick `t0`; higher tick numbers (`t10/`, `t100/`) shave 1–2 chars off
that budget.

### V4c — `Operation.Id` uniqueness scope — **PASS: execution-wide unique**

From the refund execution's final history, 28 distinct 16-hex operation ids, **zero collisions**
(no id maps to two different operations). Notably the three `invoke-model` steps share the same
_Name_ but have three different _Ids_ — confirming the doc-comment "unique within the execution"
and that identity is **positional**, not name-derived. `Operation.Id` is always a 16-char lower
hex token regardless of name length.

---

## V5 — Cold start & bundle size — **PASS (reported)**

Design doc §13 flags bundle/cold-start as a medium risk to measure in Phase 1.

- **Bundle size:** unzipped handler `cloud/build/index.js` = **1,698,631 bytes (1.62 MB)**;
  deployed zip = **308,583 bytes (301 KB)**. The core SDK is bundled in (peer dep, resolved from
  the monorepo root `node_modules` by esbuild).
- **Cold start:** one on-demand cold start observed. `platform.initStart`
  (`initializationType: on-demand`, `runtimeVersion: nodejs:22.DurableFunction.v36`) followed by
  `platform.report` with **`initDurationMs = 625.12`**.
- **Invocation durations** (16 invocations across the session): min 45 ms, max 1013.5 ms (the
  max is the cold-start invocation's `durationMs`), mean ≈ 249 ms; warm superstep-driving
  invocations 45–470 ms. **Max memory used = 111 MB** of 512 configured.

A ~625 ms init for a 1.6 MB bundle at 512 MB is modest and well within the medium-risk envelope;
raising memory or trimming the bundle would reduce it further if needed.

---

## Deliverables created (reproducible)

All under `packages/aws-durable-execution-sdk-js-graph/cloud/` (new files only; no core-package
edits):

- `entry.mjs` — the Lambda handler; dispatches `refund` / `longnames` on `event.mode`, importing
  the graph package's TS source and the core SDK.
- `bundle.mjs` — esbuild bundler → single CJS `build/index.js` (target node22), prints byte size.
- `deploy.sh` — idempotent deploy (bundle → zip → ensure IAM role → create/update function →
  publish version). Re-runnable.
- `validate-suspend-replay.sh` — V1/V2/V3 driver (start, detect suspension, measure CloudWatch
  invocations over the idle window, resume, analyze replay). Re-runnable; prints `RESULT_*` lines.
- `validate-name-limits.sh` — V4b/V4c probe across node-name lengths. Re-runnable.

Raw evidence JSON captured to `/tmp/dg-*.json` during the run (histories, exec data, metrics,
logs).

## Environment / credential notes

- Credential setup is environment-specific; this run passed credentials via an env file. Used
  `AWS_ENV_FILE` with standard AWS credential env vars`and prefixed every AWS call with`env $(cat /tmp/adacreds.env)`. No secret values were printed.
- Host node is v16 (glibc 2.26) and cannot run this code; **all** node/npm/esbuild work ran in
  the `node:22` Docker container, as instructed.

## Guardrail compliance

- **No files under `packages/aws-durable-execution-sdk-js/` or
  `packages/aws-durable-execution-sdk-js-testing/` were modified.** `git -P status --short`
  shows only the untracked new package dir (`?? packages/aws-durable-execution-sdk-js-graph/`);
  a scoped status of the two protected packages is clean.
- Only `durable-graph-poc`-named resources were created. No DynamoDB table was created (V3 proof
  needed none).

## Cleanup

All cloud resources created for this validation were deleted at the end of the run and
verified gone:

- **Deleted** Lambda function `durable-graph-poc` (and its published version `:1` and all its
  durable executions) — `lambda delete-function` returned 202; `get-function` now returns
  `ResourceNotFoundException`; `list-functions` shows no `durable-graph-poc*`.
- **Deleted** IAM role `durable-graph-poc-role` after detaching both managed policies —
  `iam get-role` now returns `NoSuchEntity`.
- **Deleted** CloudWatch log group `/aws/lambda/durable-graph-poc` — `describe-log-groups`
  prefix query now returns empty.
- **No DynamoDB table** was created (V3 needed none).

**Nothing remains** in account `<test-account>` from this experiment. To reproduce, re-run
`cloud/deploy.sh` then `cloud/validate-suspend-replay.sh` and `cloud/validate-name-limits.sh`.
