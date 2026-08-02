# The `.dar` Workflow Format — Specification

**Format version:** `1.0` · **Status:** living document, tracks `DAR_VERSION` in
`@aws/durable-execution-sdk-js-visual-workflow-model`

This document specifies the `.dar` file format: the JSON serialization of a
visual durable-execution workflow authored in Workflow Studio and compiled to
TypeScript by the `@aws/durable-execution-sdk-js-cdk` code generator. It is
written in the spirit of the [Amazon States Language
specification](https://states-language.net/), which describes a comparable (but
interpreted rather than compiled) workflow language; see
[dar-vs-asl.md](./dar-vs-asl.md) for a comparison.

Unlike ASL, a `.dar` file is **not** executed directly. It is an authoring
model: the code generator emits an imperative durable Lambda handler from it,
and runtime semantics (checkpointing, replay, retries, suspension) come from
the AWS Lambda durable-execution SDK. Where this document states runtime
behavior, it describes the code the generator emits.

---

## Table of Contents

1. [Structure of a Workflow](#1-structure-of-a-workflow)
2. [Nodes](#2-nodes)
3. [Edges and Control Flow](#3-edges-and-control-flow)
4. [Data Flow: Result Constants](#4-data-flow-result-constants)
5. [Node Kinds](#5-node-kinds)
6. [Error Handling](#6-error-handling)
7. [Retry and Wait Strategies](#7-retry-and-wait-strategies)
8. [Determinism Requirements](#8-determinism-requirements)
9. [Checkpoint Semantics](#9-checkpoint-semantics)
10. [Versioning and Migration](#10-versioning-and-migration)
11. [File and Artifact Conventions](#11-file-and-artifact-conventions)

---

## 1. Structure of a Workflow

A `.dar` file is a single JSON object:

```json
{
  "darVersion": "1.0",
  "name": "order-processing",
  "dependencyMode": "linear",
  "inputType": "{ orderId: string }",
  "layoutDirection": "TB",
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

| Field             | Type                                       | Required                            | Description                                                                                            |
| ----------------- | ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `darVersion`      | string                                     | no (defaults to current)            | Schema version; drives [migration](#10-versioning-and-migration).                                      |
| `comment`         | string                                     | no                                  | Optional human description (ASL `Comment` equivalent).                                                 |
| `name`            | string                                     | no (defaults `"Untitled workflow"`) | Human name of the workflow.                                                                            |
| `dependencyMode`  | `"linear"` \| `"dag"`                      | no (default `"linear"`)             | Fan-out policy: `linear` allows one outgoing edge per node (except `condition`); `dag` allows several. |
| `inputType`       | string (TypeScript type)                   | no (default `unknown`)              | Type of the execution input (`event`). Root workflow only.                                             |
| `layoutDirection` | `"TB"` \| `"LR"`                           | no (default `"TB"`)                 | Canvas auto-layout / edge-routing direction. Root workflow only; presentation-only.                    |
| `nodes`           | array of [Node](#2-nodes)                  | **yes**                             | The workflow's nodes.                                                                                  |
| `edges`           | array of [Edge](#3-edges-and-control-flow) | no (default `[]`)                   | Directed connections between nodes.                                                                    |

Container node kinds (`map`, `group`, `parallel`) embed **child workflows** of
this same shape in their `body`/`branches[].body` fields, recursively. Each
child workflow carries its own `darVersion` and is migrated independently.

A machine-readable JSON Schema (draft-07) of this structure is exported as
`DAR_JSON_SCHEMA` from the shared model package. It validates the top level
and shared primitives; the authoritative loader is `parseWorkflow`, which is
deliberately forgiving (missing kind-specific fields are filled with defaults,
unknown extra fields are preserved for forward compatibility).

## 2. Nodes

Every node is a JSON object with these common fields:

| Field                | Type                                      | Required | Description                                                                                                                                                                                 |
| -------------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | string                                    | **yes**  | Stable identifier, unique within its workflow. Edges reference nodes by id.                                                                                                                 |
| `kind`               | string                                    | **yes**  | One of the [node kinds](#5-node-kinds). Unknown kinds are a load error.                                                                                                                     |
| `name`               | string                                    | **yes**  | Human/operation name. Becomes the durable operation name and the node's [result constant](#4-data-flow-result-constants). Must be unique among operation nodes after identifier sanitizing. |
| `position`           | `{ x, y }`                                | no       | Canvas position. Presentation-only.                                                                                                                                                         |
| `terminal`           | boolean                                   | no       | When `true`, the workflow ends after this node (Studio shows an owned `end` node linked from it).                                                                                           |
| `comment`            | string                                    | no       | Optional human description; emitted as `//` lines above the generated operation.                                                                                                            |
| `onError`            | array of [ErrorBranch](#6-error-handling) | no       | Error **fallbacks** (value recovery). Error **routes** are `"error"`-kind edges; see [Error Handling](#6-error-handling).                                                                   |
| `resultType`         | string (TypeScript type)                  | no       | Type annotation of the node's result constant. Absent ⇒ inferred/`any`.                                                                                                                     |
| `resultTypeInferred` | boolean                                   | no       | `true` when `resultType` came from type inference rather than the author (inference never overwrites author-owned types).                                                                   |

Kind-specific fields are listed per kind below. Nodes may carry additional
fields; loaders preserve them.

`start` and `end` are **structural markers**, not operations: they emit no
code of their own (aside from `end`'s optional return/throw), share names
freely, and bind no result.

## 3. Edges and Control Flow

Edges are the **only** carrier of routing: nodes never route ("every
transition is an edge").

```json
{ "id": "e1", "source": "fetch", "target": "process", "match": "OK" }
{ "id": "e2", "source": "fetch", "target": "recover", "kind": "error", "errorType": "NotFoundError" }
```

| Field       | Type                  | Required              | Description                                                                                                                                     |
| ----------- | --------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string                | **yes**               | Unique edge id.                                                                                                                                 |
| `source`    | string                | **yes**               | Source node id.                                                                                                                                 |
| `target`    | string                | **yes**               | Target node id.                                                                                                                                 |
| `kind`      | `"flow"` \| `"error"` | no (default `"flow"`) | `"error"` edges run when the source node **fails** (after retries): the failing node's `catch` routes to the target.                            |
| `match`     | string                | no                    | Only on edges out of a `condition` node: the value to match against the condition's result. An edge without `match` is the default/else branch. |
| `errorType` | string                | no                    | Only on `"error"` edges: the error class(es) matched via `instanceof` — a comma-separated list matches any. Absent/blank = catch-all.           |
| `label`     | string                | no                    | Display-only text. Carries **no** routing semantics.                                                                                            |

Control flow is the edge graph: execution starts at the `start` node and
follows flow edges. Under `dependencyMode: "linear"` each node has at most one
outgoing **flow** edge — `condition` branches and `"error"` edges are exempt
(only one branch is taken at runtime; error edges run only on failure). Under
`"dag"` a node may fan out to several successors. Edges referencing
nonexistent nodes are dropped on load.

An `end` node must have at least one incoming edge (flow or error); orphaned
ends are pruned on edit.

## 4. Data Flow: Result Constants

`.dar` has no ASL-style state document or path algebra. Instead, **every
operation node's result is bound to a TypeScript `const`** named after the
node:

- The identifier is `toIdentifier(name)`: non-identifier characters become
  `_`, a leading digit gains a `_` prefix.
- Identifiers must be unique per workflow and must not collide with the
  reserved set (`event`, `input`, `context`, `ctx`, `childCtx`, `stepCtx`,
  `callbackId`, `state`, `err`, `item`, `index`, `handler`, and all JavaScript
  reserved words). Collisions are a hard error, not an auto-rename.
- Any node's code may lexically reference the result constants of **all its
  upstream nodes** (ancestors through edges, plus — inside an error route —
  the failing node's ancestors).

Scope extras by context:

| Scope                                              | Extra symbols                                                  |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Root workflow                                      | `event` / `input` — the execution input (typed by `inputType`) |
| Inside a `map` body                                | `item`, `index` — the current element                          |
| Inside a `group` body or `parallel` branch         | none (child contexts do not receive the execution input)       |
| Inside a `callback` submitter                      | `callbackId`                                                   |
| Inside a `waitForCondition` check / stop condition | `state` — the latest polling state                             |
| Inside an error branch                             | `err` — the thrown error                                       |

## 5. Node Kinds

The complete kind list (runtime constant `DAR_NODE_KINDS`):
`start`, `step`, `inline`, `wait`, `callback`, `chainInvoke`,
`waitForCondition`, `condition`, `map`, `group`, `parallel`, `awsJob`,
`awsSdkCall`, `end`.

### 5.1 `start`

Structural marker: where the workflow begins. Exactly one per workflow; no
fields beyond the common ones; no code emitted.

### 5.2 `end`

Structural marker: where the workflow terminates.

| Field     | Type                                         | Description                                                                                                                                                                     |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endMode` | `"return"` \| `"throw"` (default `"return"`) | Whether the workflow returns data or throws here.                                                                                                                               |
| `code`    | string (TS block)                            | Optional `return <expr>;` or `throw new Error(...);` body; may reference upstream result constants. Blank ⇒ `return` returns the last result, `throw` throws a default `Error`. |

### 5.3 `step`

Runs a TypeScript code block as a **durable step** —
`context.step(name, async () => { ... }, { retryStrategy })`. Checkpointed;
retried per its strategy.

| Field   | Type                                              | Description                                                  |
| ------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `code`  | string (TS block)                                 | The step body; its `return` value becomes the node's result. |
| `retry` | [RetryStrategySpec](#7-retry-and-wait-strategies) | Retry configuration.                                         |

### 5.4 `inline`

Plain, **non-checkpointed** TypeScript run inline between durable operations,
compiled to an IIFE whose result binds to the node's constant. No retry
(nothing is checkpointed); error branches are supported via `try`/`catch`.
Because it re-runs on every replay it **must be deterministic and
side-effect-free** — `await` inside the body does not compile, forcing I/O
into a `step`.

| Field  | Type              | Description                                                    |
| ------ | ----------------- | -------------------------------------------------------------- |
| `code` | string (TS block) | The inline body; its `return` value becomes the node's result. |

### 5.5 `wait`

Suspends execution for a fixed duration — `context.wait(name, { ... })`. No
compute charges while suspended.

| Field           | Type                                                | Description                                                                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `durationValue` | number                                              | Amount.                                                                                                             |
| `durationUnit`  | `"seconds"` \| `"minutes"` \| `"hours"` \| `"days"` | Unit.                                                                                                               |
| `durationCode`  | string (TS block, optional)                         | Returns the wait in **seconds**, computed from upstream results (must be deterministic). Overrides the static pair. |

### 5.6 `callback`

Waits for an external callback — `context.waitForCallback(name, submitter,
{ timeout })`. The result is the value the external system sends back.

| Field                          | Type                   | Description                                                                  |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| `timeoutValue` / `timeoutUnit` | number / duration unit | Callback timeout.                                                            |
| `submitterCode`                | string (TS block)      | Body of the submitter; receives `callbackId` to hand to the external system. |

### 5.7 `chainInvoke`

Durably invokes another Lambda function — `context.invoke(name, functionArn,
payload)`. The target must be a **qualified** function name/ARN (version,
alias, or `$LATEST`).

| Field         | Type               | Description                             |
| ------------- | ------------------ | --------------------------------------- |
| `functionArn` | string             | Qualified function ARN or name.         |
| `payload`     | string (JSON text) | Payload passed to the invoked function. |

### 5.8 `waitForCondition`

Polls until a condition is satisfied — `context.waitForCondition(name, check,
{ initialState, waitStrategy })`. The node's result is the final state.

| Field           | Type                                              | Description                                           |
| --------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `code`          | string (TS block)                                 | Check body: receives `state`, returns the next state. |
| `initialState`  | string (JSON text)                                | Initial polling state.                                |
| `stopCondition` | string (TS boolean expression over `state`)       | Polling stops when truthy.                            |
| `wait`          | [RetryStrategySpec](#7-retry-and-wait-strategies) | Polling cadence.                                      |

### 5.9 `condition`

Branch/switch. Evaluates a TypeScript expression and routes by comparing its
result to each outgoing edge's `match`; the matchless edge (if any) is the
default. Compiles to an **inline IIFE + `switch`** — deterministic, not
checkpointed, so `await` does not compile and the node shows no runtime status
of its own on the execution graph.

| Field  | Type              | Description                                                         |
| ------ | ----------------- | ------------------------------------------------------------------- |
| `code` | string (TS block) | Returns the value matched against the branch edges' `match` values. |

### 5.10 `map`

Fan-out over an array — `context.map(name, items, iteratee, config)`. The
per-element child workflow is the node's `body`; inside it, `item` and
`index` are in scope.

| Field                        | Type                                      | Description                                                                                                                            |
| ---------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `itemsCode`                  | string (TS block)                         | Returns the array to iterate.                                                                                                          |
| `maxConcurrency`             | number                                    | Concurrent iterations.                                                                                                                 |
| `minSuccessful`              | number (optional)                         | completionConfig.minSuccessful.                                                                                                        |
| `toleratedFailureCount`      | number (optional)                         | completionConfig.toleratedFailureCount.                                                                                                |
| `toleratedFailurePercentage` | number 0–100 (optional)                   | completionConfig.toleratedFailurePercentage.                                                                                           |
| `nesting`                    | `"NESTED"` \| `"FLAT"` (default `NESTED`) | `NESTED` = full child contexts with per-iteration checkpointing; `FLAT` = virtual contexts, ~30% cheaper, no per-iteration checkpoint. |
| `body`                       | Workflow                                  | The per-iteration child workflow.                                                                                                      |

### 5.11 `group`

Runs a named child workflow under a child context —
`context.runInChildContext(name, async (childCtx) => { ... })`. No
configuration of its own.

| Field  | Type     | Description                 |
| ------ | -------- | --------------------------- |
| `body` | Workflow | The grouped child workflow. |

### 5.12 `parallel`

Runs named branches concurrently — `context.parallel(name, branches, config)`.

| Field                                                                    | Type                          | Description                            |
| ------------------------------------------------------------------------ | ----------------------------- | -------------------------------------- |
| `branches`                                                               | array of `{ id, name, body }` | Each branch is a named child workflow. |
| `maxConcurrency`                                                         | number (optional)             | Concurrent branches.                   |
| `minSuccessful` / `toleratedFailureCount` / `toleratedFailurePercentage` | number (optional)             | Completion policy, as for `map`.       |

### 5.13 `awsJob`

AWS "run a job" service integration (the Step Functions `.sync` pattern):
starts an asynchronous AWS job and polls it to a terminal status. **Expands**
into a `step` (start) + `waitForCondition` (poll) in generated code. The
integration is a key into the shared `SERVICE_INTEGRATIONS` registry (e.g.
`"glue.startJobRun"`, `"ecs.runTask"`).

| Field                 | Type                           | Description                                                    |
| --------------------- | ------------------------------ | -------------------------------------------------------------- |
| `integration`         | string                         | Registry key of the service integration.                       |
| `startInput`          | string (JSON or TS expression) | Input for the start command.                                   |
| `pollIntervalSeconds` | number (optional)              | Seconds between polls (integration preset default when unset). |
| `region`              | string (optional)              | AWS region override for the SDK client.                        |

### 5.14 `awsSdkCall`

A single AWS SDK v3 call wrapped in a durable step. Generated code:
`new <clientClass>({ region? }).send(new <command>(input))` inside
`context.step`.

| Field           | Type                           | Description                        |
| --------------- | ------------------------------ | ---------------------------------- |
| `clientPackage` | string                         | e.g. `"@aws-sdk/client-dynamodb"`. |
| `clientClass`   | string                         | e.g. `"DynamoDBClient"`.           |
| `command`       | string                         | e.g. `"PutItemCommand"`.           |
| `input`         | string (JSON or TS expression) | Command input.                     |
| `region`        | string (optional)              | AWS region override.               |
| `retry`         | RetryStrategySpec (optional)   | Retry for the wrapping step.       |

## 6. Error Handling

Error handling has two parts, split by whether a destination exists:

- **Routes** — `"error"`-kind edges out of the failing node (see
  [Edges](#3-edges-and-control-flow)). Each matches an error class
  (`errorType`; blank = catch-all) and continues execution at its target,
  inside the failing node's `catch` (with the failing node's upstream result
  constants and `err` in scope).
- **Fallbacks** — `onError` branches on the node. Each matches an error type
  and supplies a **fallback value** (`fallbackCode`, a TS block returning the
  result). A fallback has no destination, so it stays on the node.

```json
"onError": [
  { "id": "b2", "errorType": "ValidationError", "fallbackCode": "return { fallback: true };" }
]
```

| Field          | Type              | Description                                              |
| -------------- | ----------------- | -------------------------------------------------------- |
| `id`           | string            | Branch id.                                               |
| `errorType`    | string (optional) | Error class name to match; blank/absent = catch-all.     |
| `fallbackCode` | string            | TS block returning the value bound as the node's result. |

Generated semantics: the operation is wrapped in `try`/`catch`; typed entries
compile to an `if (err instanceof <Type>)` chain — **routes first (in edge
order), then fallbacks** — the catch-all (an `errorType`-less error edge or a
blank-type fallback) is the `else`, otherwise `throw err` re-propagates.
Error handling fires only after the node's own retries are exhausted (or on
timeout / invoke error). Supported on: `step`, `inline`, `callback`,
`chainInvoke`, `waitForCondition`, `map`, `group`, `parallel`, `awsJob`.

Note that `fallbackCode` has no ASL equivalent (ASL must Catch-route to a Pass
state); conversely, this format has no per-node execution timeout comparable to
ASL's `TimeoutSeconds` (only `callback` carries a timeout).

## 7. Retry and Wait Strategies

The shared `RetryStrategySpec` powers step retries (`retry`) and
`waitForCondition` polling (`wait`), mirroring the SDK's strategy builders:

| Field                 | Type                                      | Description                                                                                                                                                                         |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                | `"exponential"` \| `"linear"` \| `"none"` | `exponential`: delay = initialDelay × backoffRate^(attempt−1); `linear`: delay = initialDelay + increment × (attempt−1); `none`: single attempt. Delay capped at `maxDelaySeconds`. |
| `maxAttempts`         | number                                    | Total attempts including the first.                                                                                                                                                 |
| `initialDelaySeconds` | number                                    | First retry delay.                                                                                                                                                                  |
| `maxDelaySeconds`     | number                                    | Delay cap.                                                                                                                                                                          |
| `backoffRate`         | number                                    | Exponential multiplier (used by `exponential`).                                                                                                                                     |
| `incrementSeconds`    | number                                    | Per-attempt increment (used by `linear`).                                                                                                                                           |
| `jitter`              | `"NONE"` \| `"FULL"` \| `"HALF"`          | Mirrors the SDK's JitterStrategy.                                                                                                                                                   |

Defaults: step retry = exponential, 3 attempts, 5 s → 300 s cap, rate 2,
FULL jitter. waitForCondition polling = exponential, 60 attempts, 5 s → 300 s
cap, rate 1.5, FULL jitter. Loaders merge partial/missing strategy objects
over these defaults.

## 8. Determinism Requirements

Generated handlers run under the durable-execution **replay model**: on resume
the handler re-executes from the top, completed operations return checkpointed
results, and everything _outside_ durable operations runs again. Therefore:

- `inline` and `condition` bodies, `end` code, `itemsCode`, `stopCondition`,
  and any other code outside a durable operation **must be deterministic and
  side-effect-free**. The compiled IIFEs are synchronous, so `await` in these
  positions is a compile error by construction — non-determinism and I/O
  belong in a `step`.
- Non-deterministic values (time, randomness, UUIDs) and all I/O must be
  produced inside `step`-like nodes so they are checkpointed.

## 9. Checkpoint Semantics

Unlike ASL, where every state costs a state transition, `.dar` distinguishes
checkpointed from free constructs — a first-class dimension of the model:

| Construct                                             | Checkpointed? | Notes                                         |
| ----------------------------------------------------- | ------------- | --------------------------------------------- |
| `step`, `awsSdkCall`                                  | yes           | one checkpoint per completion                 |
| `awsJob`                                              | yes (×2 ops)  | expands to step + waitForCondition            |
| `wait`, `callback`, `chainInvoke`, `waitForCondition` | yes           | durable operations                            |
| `map` NESTED / `group` / `parallel`                   | yes           | child contexts checkpoint                     |
| `map` FLAT                                            | partially     | virtual contexts, no per-iteration checkpoint |
| `inline`, `condition`                                 | **no**        | inline IIFEs; re-run on every replay          |
| `start`, `end`                                        | no            | structural only                               |

## 10. Versioning and Migration

`darVersion` identifies the schema version (current: `1.0`). On load,
`migrateDar` upgrades older versions by applying registered migrations in
sequence. A missing/blank version is treated as current. An unknown (newer)
version with no migration path loads best-effort and unchanged; Studio warns
that display/re-save fidelity is not guaranteed. Container bodies are migrated
recursively (each carries its own `darVersion`).

## 11. File and Artifact Conventions

- **File extension:** `.dar` (JSON content). Both the VS Code extension and
  the desktop app save/open this extension.
- **Embedded artifact:** functions deployed from Workflow Studio (or the
  `DurableWorkflowFunction` CDK construct) embed the full workflow — code
  included — as `workflow.dar.json` in the deployment package, and set the
  Lambda tag `workflowStudioDar=1`. Tagged functions can be reopened in Studio
  and edited further from either deploy path.
- Extra/unknown fields are preserved through load/save for forward
  compatibility (nodes are open objects; see the JSON Schema's
  `additionalProperties: true`).
