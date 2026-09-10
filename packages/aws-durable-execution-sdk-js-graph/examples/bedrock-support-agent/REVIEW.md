# Independent Review — Bedrock Support-Agent Example

**Reviewer stance:** independent, skeptical. Findings below are from reading the source and the
graph runtime it builds on, and from RUNNING the test suite, biome, a leak scan, and a
break-it/fix-it mutation of the single most important behaviour. The previous stage's self-report
was NOT trusted; every claim was re-verified.

**Verdict: no CRITICAL or MAJOR defects. The example is deployable as-is.** Minor nits only (no
`NEEDS_CHANGES` token). One pre-existing repo-hygiene note about `BUILD_BRIEF.md` is called out
separately — it is not part of this example and not a regression introduced by this stage.

Commands run (node:22 Docker, repo root):
- `npm run test --workspace=@aws/durable-execution-sdk-js-graph` → **12 suites / 56 tests pass** (includes `tsc --noEmit` typecheck, exit 0).
- `npx biome check ... packages/aws-durable-execution-sdk-js-graph biome.jsonc` → **Checked 46 files. No fixes applied.** (exit 0)

---

## A. Replay safety with a non-deterministic model — PASS

**A.1 — Every Bedrock/model call is inside a `ctx.step`. PASS.**
Traced every call site:
- The only `model(...)` invocation in `graph.ts` is line 264, wrapped in
  `ctx.step("invoke-model", async () => model({ messages: [...state.messages] }), { retryStrategy })`
  opened at line 262.
- The only real Bedrock network call — `bedrock.send(new ConverseCommand(...))` — is in
  `model.ts` line 205, inside the `ModelFn` closure returned by `createBedrockModel`. That
  closure is only ever reached via the step above. `grep` confirms `@aws-sdk` /
  `bedrock-runtime` are imported in **`model.ts` only**; `graph.ts` and `handler.ts` are SDK-free.
- No model call exists outside a step. On replay the recorded step result is returned, so the
  non-deterministic model is never re-invoked for a completed turn.

**A.2 — No router/reducer touches the model, clock, or RNG. PASS.**
The conditional edge (`graph.ts`, `addConditionalEdges("agent", ...)`) reads only
`state.turns` and `state.decision`. `grep -E "Date\.|Math\.random|now|new Date"` over
`graph.ts` + `model.ts` matches only a comment, never code. Reducers (`lastValue`,
`appendValue` in `src/schema/channels.ts`) are pure and allocate fresh values.
`RouterFn` is typed as a pure function of state (`src/builder/node.ts`), and the runtime
(`run-graph.ts`) computes routing (`graph.route`) OUTSIDE any step.

**A.3 — The routing decision is persisted into state, not recomputed from a raw response. PASS.**
The `agent` node calls `deriveDecision(reply)` (pure) and writes the result into the
checkpointed `decision` channel in the returned delta. The router reads `state.decision`. The
`reply` it derives from itself came out of the `invoke-model` step, so even the derivation input
is a recorded value. This satisfies the "recompute only from a stepped response" rule.

**A.4 — Reducers are pure and non-mutating. PASS.**
`appendValue.reduce` returns `[...current, ...]` (new array); `lastValue.reduce` returns the
update; `StateSchema.reduce` shallow-copies (`{ ...state }`) and never mutates its input
(`src/schema/state-schema.ts`, `src/schema/channels.ts`).

---

## B. Does the test prove anything? — PASS (proven by mutation)

**Stub is genuinely injected; no network is possible in the test path. PASS.**
`__tests__/support-agent.test.ts` imports only `../graph` (plus the SDK test runner and core
SDK). It does **not** import `model.ts`, `handler.ts`, `createBedrockModel`, or
`@aws-sdk/client-bedrock-runtime` (verified by grep). The model is supplied as `scriptedModel` /
`loopingModel`. There is no code path to real Bedrock — the test cannot hit the network.

**The interrupt test proves the graph actually SUSPENDS on `waitForCallback`. PROVEN.**
I mutated the source to make the assertion earn its keep. In `graph.ts`, I replaced the
`await interrupt<...>(nodeCtx, "approval", ...)` call in the `approval` node with a hardcoded
`const decision = "approve"` (no suspension at all), then re-ran the example suite:

- **Before revert (mutated):** `Tests: 4 failed, 2 passed`. The four failures — approve path,
  deny path, `DurableGraph` subType, and composition — all failed at
  `approvalOp.waitForData(WaitingOperationStatus.SUBMITTED)` with:
  *"Operation was not found after execution completion. Expected status: SUBMITTED. This
  typically means the operation was never executed…"* i.e. the graph never entered the
  suspended callback state. Only the two tests that don't exercise the interrupt (MAX_TICKS,
  `deriveDecision` purity) still passed.
- **After revert (original `interrupt` restored):** `Tests: 6 passed, 6 total`; full suite back
  to 56/56.

This is direct evidence the suite would FAIL if suspension regressed — it is not a test that
passes with the feature broken. The runtime path is real too: `src/interrupt/interrupt.ts`
delegates straight to `ctx.waitForCallback`.

---

## C. Loop safety — PASS

`MAX_TICKS = 12` is a real, terminating cap: the conditional edge returns `END` when
`state.turns >= MAX_TICKS`. `turns` is incremented once per `agent` turn. It is tested by
*"enforces MAX_TICKS: a looping model is forced to END"*, which drives a model that always
requests a small (no-approval) tool — an otherwise-infinite ReAct loop — and asserts
`finalState.turns === MAX_TICKS`. That test completes in finite time in the suite, which itself
demonstrates the cap terminates the loop (without it the test would hang). An unbounded loop
against a paid model is therefore prevented and covered.

---

## D. Leak / portability check — PASS (for this example)

Scanned the example tree (`examples/bedrock-support-agent/`):
- `<internal-account-id>` — none in the example.
- internal credential-tool / account-system references — none in the example.
- `/home/<alias>` (and any `/home/<alias>/`) — none.
- Hardcoded ARN with a literal account number — none. The only account reference in
  `deploy.sh` is the parameterised `${ACCOUNT}` in the inference-profile ARN.
- `[0-9]{12}` hits exist only inside the generated, **git-ignored** `cloud/build/index.js`
  bundle, and they are numeric literals in the bundled AWS SDK (e.g. `9223372036854776e3`,
  `18446744073709551616`), not account ids.

`.gitignore` correctness verified: `git check-ignore` confirms `cloud/build/` (the 1.8 MB
bundle) and `function.zip` are ignored; `git add -n` on the example dir lists only source files
(`graph.ts`, `model.ts`, `handler.ts`, `cloud/{entry,bundle}.mjs`, `deploy.sh`, `.gitignore`,
README, test). The bundle will not be committed.

**`deploy.sh` fails loudly when `AWS_ACCOUNT_ID` is unset. PASS.** It uses
`ACCOUNT=${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID to the target account}` under `set -euo pipefail`.
Simulated with the variable unset: exits `1` with the message, before any `aws` call — it cannot
deploy to an unintended account.

**Resolved after review:** the build brief that carried internal host/account references was a
transient authoring artifact and has been deleted rather than committed, so nothing outside the
example carries internal identifiers either.

---

## E. IAM correctness — PASS

`deploy.sh` attaches an inline policy granting
`["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"]` on **both**:
- `arn:aws:bedrock:*::foundation-model/*`, and
- `arn:aws:bedrock:*:${ACCOUNT}:inference-profile/*`.

That is exactly what an inference-profile model id
(`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) requires: the profile resource authorises the
call and it fans out to the underlying foundation models, so both ARNs are needed. A policy
missing the profile ARN would fail at runtime with `AccessDenied`; this one covers it.

---

## F. Guardrails — PASS

`git -P status --short`:
```
 M biome.jsonc
 M packages/aws-durable-execution-sdk-js-graph/tsconfig.build.json
 M packages/aws-durable-execution-sdk-js-graph/tsconfig.json
?? packages/aws-durable-execution-sdk-js-graph/examples/
```
No modification under `packages/aws-durable-execution-sdk-js/` or
`packages/aws-durable-execution-sdk-js-testing/`. The three tracked edits are all inside the
allowed graph package / root biome config and match the stated scope.

---

## Minor nits (non-blocking, no source change required to ship)

2. **Retry `retryStrategy` regex is broad.** `/…|5\d\d/` matches any `5xx`-looking substring
   anywhere in `name + message`; a message that merely contains "500" unrelated to an HTTP
   status could be treated as retryable. Low risk for a POC (worst case: a few extra retries of
   an idempotent Converse call), but a structured check on the SDK error name/`$metadata`
   status would be tighter.
3. **`toConverseMessages` never emits an `assistant` text-only turn's tool history when
   `content` is empty and there are no tool calls** — fine for the scripted flow, and real
   multi-turn histories always carry either text or toolUse, so this is only a theoretical edge.
4. **`resume` on `NodeContext` is unused** by the approval node (it reads the value via the
   callback return instead). This is documented in the code and in the POC friction notes; it is
   a runtime-API limitation, not a defect in the example.

## What was verified by running (not by trusting the report)

- Full test suite + typecheck: 12/12 suites, 56/56 tests, exit 0.
- Biome: 46 files checked, no fixes, exit 0.
- Mutation test on the interrupt: 4 targeted failures with the suspend bypassed, back to 6/6 on
  revert (no residual diff).
- Leak scan + `.gitignore` behaviour via `git check-ignore` / `git add -n`.
- `deploy.sh` unset-account abort via a `set -euo pipefail` simulation.
- `git status --short` for the forbidden-package guardrail.
