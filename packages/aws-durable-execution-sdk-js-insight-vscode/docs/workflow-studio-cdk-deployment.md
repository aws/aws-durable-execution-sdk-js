# Workflow Studio → CDK deployment (design note)

Status: **design / not yet implemented**. Captures the agreed direction for
turning a `.dar` workflow (authored in the Workflow Studio view) into a deployed
Durable Lambda function.

## Guiding principle: behavior vs. deployment

- **The `.dar` file owns _behavior_** — the workflow graph (start/step/wait/
  callback/chainInvoke/waitForCondition/end nodes + edges) and the TypeScript
  code blocks and retry/wait strategies on those nodes.
- **CDK owns _deployment_** — everything that varies per environment
  (dev/staging/prod): `functionName`, runtime, memory, per-invocation `timeout`,
  IAM role, VPC, env vars, alias, `retentionPeriod`.

This keeps a single `.dar` deployable to multiple environments unchanged. Config
that changes per environment must not be baked into the logic artifact.

## Chosen surface: a dedicated construct (Option B)

```typescript
const fn = new DurableWorkflowFunction(this, "MyWorkflow", {
  darFile: "path/to/workflow.dar",
  functionName: "my-workflow", // optional; defaults to the .dar `name`
  role,
  // runtime / durableConfig optional — inferred from the .dar, overridable
});
fn.alias("prod");
```

The construct wraps `aws-lambda-nodejs.NodejsFunction` and, at **synth time**:

1. Reads and validates the `.dar`.
2. **Generates a deterministic `withDurableExecution` handler** from the graph
   (see "codegen, not interpreter" below) and wires it as the function `entry`.
3. Sets `durableConfig` defaults inferred from the workflow (see below).
4. Publishes a version/alias (durable functions require a qualified identifier
   to invoke).
5. Exposes the underlying `NodejsFunction` so any prop can be overridden.

A lighter intermediate is a props factory (`DurableWorkflow.fromFile(...).functionProps()`)
that returns `{ entry, handler, runtime, durableConfig }` to spread into a plain
`NodejsFunction`. The construct is preferred long-term.

## Codegen, not a runtime interpreter

Because `step` and `waitForCondition` nodes carry **real TypeScript source**, the
`.dar` cannot be safely interpreted at runtime. Deployment must compile:

```
.dar ──(synth-time generate)──▶ handler.ts ──(NodejsFunction/esbuild)──▶ Lambda
     + inferred durableConfig defaults ──────────────────────────────▶ function props
```

The generated handler MUST be **deterministic** (same `.dar` ⇒ byte-identical
handler) for two reasons: clean CloudFormation/code-review diffs, and durable
replay correctness (code outside steps must be deterministic).

## `executionTimeout` should be inferred (footgun prevention)

`durableConfig.executionTimeout` bounds the _whole_ execution including waits. A
workflow with a 7-day `wait` or a 24h `callback` timeout will fail if
`executionTimeout` is left at a small default. The generator can compute a floor
from the longest wait / callback / waitForCondition path in the graph and set it
as the default `executionTimeout`; the deployer can still raise it. The `.dar` is
uniquely positioned to know this, so it should supply the default.

## What comes from where

| Field                                                                               | Source                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| step/wait/callback/chainInvoke/waitForCondition logic + retry/wait strategies       | **`.dar`** → generated handler                                      |
| `executionTimeout` (floor)                                                          | **`.dar`** (inferred from longest wait/timeout path), CDK may raise |
| `functionName`, construct id                                                        | **`.dar` `name` as default**, CDK overrides                         |
| runtime, memory, per-invocation `timeout`, `retentionPeriod`, role, VPC, env, alias | **CDK**                                                             |

## Decisions

- **Keep the Workflow `name` field.** It is the workflow's logical identity and
  the _default_ `functionName`/construct id — not redundant with the filename.
  The filename is storage only (renamable, may contain non-identifier chars); the
  in-file `name` is portable, stable, and what deployment keys off. Later, when
  `name` drives real resources, validate it as a deployable identifier
  (`^[a-zA-Z][a-zA-Z0-9-_]{0,63}$`).
- **Filename ≠ deploy identity.** We already default the save filename from
  `name`, and on open we use the in-file `name` (not the filename), so the two
  can't silently diverge.

## Open questions / next steps (not started)

- Where does `DurableWorkflowFunction` live (new CDK construct package vs. an
  add-on to the SDK)?
- Handler code generator: templating from nodes/edges, wiring
  `createRetryStrategy`/`createLinearRetryStrategy`/`createWaitStrategy`, and
  ordering execution from the edge graph (linear vs. branching/parallel).
- Optional `.dar` "deployment hints" block (suggested runtime/memory) as
  overridable defaults.
- Validate the graph before codegen (exactly one start, reachable end, no cycles
  unless intended, every non-terminal node connected).
