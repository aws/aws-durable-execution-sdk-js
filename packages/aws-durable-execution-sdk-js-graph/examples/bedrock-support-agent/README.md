# Bedrock support-agent example

A **real** agent graph, driven by a **real** LLM (Amazon Bedrock — Claude Sonnet 4.5 via the
Converse API), deployed as a durable Lambda function on the Durable Graph POC runtime. It is the
real-model sibling of the hermetic `src/demo/refund-agent.ts`.

## What it demonstrates

This is the canonical ReAct-plus-approval shape — a customer-support refund agent:

```
START -> agent
agent --(conditional on a CHECKPOINTED decision)--> tools | approval | END
tools -> agent          # the ReAct cycle
approval -> agent       # human-in-the-loop; resumes the loop
```

Four things a LangGraph + database-checkpointer stack cannot do as well:

1. **An agent loop with a real model** — `agent ⇄ tools`, driven by Bedrock tool-use.
2. **Every model call is individually checkpointed** with its own retry policy. The floor is a
   single `ctx.step`, not a whole superstep — crash mid-loop and completed model calls are not
   re-paid for.
3. **Human-in-the-loop that costs nothing while waiting.** A refund over `$100` suspends via
   `ctx.waitForCallback`. The invocation *ends*; nothing is billed while it waits (up to a year).
4. **Replay safety around a non-deterministic model** — the subtle one, below.

## The critical correctness point

An LLM is non-deterministic, and the durable runtime replays the handler from the top on every
resume. So:

- **Every Bedrock call is inside `ctx.step("invoke-model", ...)`** (`graph.ts`, `agent` node). On
  replay the *recorded* response is returned instead of re-invoking the model. A call outside a
  step would return a different answer on replay, the graph would route differently, and the
  execution would corrupt.
- **Routing reads only a checkpointed `decision`** the agent node wrote into the state delta. The
  router never calls the model.
- **Reducers and routers are pure** (no clock, no RNG, no I/O), and **tools are deterministic
  canned data** — so the model is the *only* source of non-determinism, which is what makes
  "every model call in a step" sufficient for replay safety.
- A **`MAX_TICKS` cap** stops a confused model from looping forever.

These rules are flagged at their call sites in `graph.ts`.

## Files

| File | Purpose |
|------|---------|
| `graph.ts` | State schema, deterministic tools, nodes, and wiring. SDK-free; takes the model as an injected callable. |
| `model.ts` | The real Bedrock Converse-backed `ModelFn`. The only file touching the AWS SDK / Converse wire shapes. |
| `handler.ts` | Lambda entry: builds the graph with the real model and wraps it via `compileDurable`. |
| `cloud/entry.mjs`, `cloud/bundle.mjs`, `cloud/deploy.sh` | Re-runnable bundle + deploy, parameterized by `AWS_ACCOUNT_ID`. |
| `__tests__/support-agent.test.ts` | Hermetic local test with a **stubbed** model (free, deterministic, no network). |

## Verified environment facts

- **Region:** `us-east-1` for both Lambda and Bedrock.
- **Model id (an inference profile, used verbatim):** `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **API:** Converse (`ConverseCommand`), which has native tool-use. Tool results go back as a user
  message carrying a `toolResult` block.
- The execution role needs `bedrock:InvokeModel` on both
  `arn:aws:bedrock:*::foundation-model/*` **and** `arn:aws:bedrock:*:<account>:inference-profile/*`
  (the deploy script attaches exactly this).

## Run the local test (hermetic, no AWS)

From the repo root, using the node:22 Docker container (the repo needs node >= 22):

```bash
docker run --rm -v "$PWD":/w -w /w -u $(id -u):$(id -g) -e HOME=/tmp node:22 \
  sh -c 'npm run test --workspace=@aws/durable-execution-sdk-js-graph'
```

## Deploy (real Bedrock)

The deploy script is re-runnable and parameterized by `AWS_ACCOUNT_ID` — nothing is hardcoded.
Export standard AWS credentials for your account (or point `AWS_ENV_FILE` at a `KEY=value` file if
`~/.aws` is not writable), then:

```bash
AWS_ACCOUNT_ID=<your-account-id> \
  packages/aws-durable-execution-sdk-js-graph/examples/bedrock-support-agent/cloud/deploy.sh
```

It bundles the handler (esbuild in node:22 Docker), creates/updates the role with the durable +
Bedrock policies, creates/updates the function, and prints the published `FUNCTION_ARN`.

## Invoke it

```json
{ "input": { "messages": { "role": "user", "content": "Please refund order A-91." } } }
```

Order `A-91` totals `$240` (> `$100`), so the model will request `issue_refund` and the graph
suspends at the human-approval gate. The invocation ends and is billed nothing while it waits.

## Resume the approval callback

When the graph suspends, the durable execution has an open `waitForCallback` named `approval`.
Resume it by sending a callback-success with the human decision (`approve` or `deny`) using the
callback token surfaced for that execution — in production your `submitter` (see the `approval`
node in `graph.ts`) is where you'd notify the reviewer with that token and where the resume path
is wired. On resume the agent loop continues: the human decision becomes a tool result the model
reads, and the agent produces its final answer.

Locally, the test harness resumes it directly:

```ts
const approvalOp = runner.getOperation<string>("approval");
// ... run(), then:
await approvalOp.waitForData(WaitingOperationStatus.SUBMITTED);
await approvalOp.sendCallbackSuccess("approve"); // or "deny"
```
