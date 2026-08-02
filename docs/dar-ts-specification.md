# The `.dar.ts` Workflow Format — Specification & Design

**Status:** approved design, phased implementation in progress ·
**Supersedes (eventually):** the JSON `.dar` format as the _authoring_ format ·
**Companions:** [dar-specification.md](./dar-specification.md) (JSON model),
[dar-vs-asl.md](./dar-vs-asl.md)

## 1. Motivation

The JSON `.dar` stores TypeScript code blocks as escaped strings inside node
objects. That makes the file hard to read, impossible to type-check, and
produces unreviewable pull-request diffs. `.dar.ts` re-projects the same model
as a **single TypeScript file**:

- the workflow graph is a typed object literal (`WorkflowDefinition`);
- every code block is a **named function** the graph references;
- canvas layout and other metadata (e.g. the deployment record) are
  quarantined in a trailing `meta` object;
- child workflows are **flat, top-level definitions**, not embedded.

The whole file type-checks with `tsc`, formats with prettier, diffs like code,
and still round-trips losslessly through Workflow Studio.

`.dar.ts` is a **definition, not a program**. It is never executed. Deploy
still works exactly as today: the code generator emits the runnable handler
(`withDurableExecution`, `context.step(...)`, retry/catch chains) from the
parsed model, and the `.dar.ts` artifact is embedded in the deployment package
for later re-editing.

## 2. File structure

A `.dar.ts` file consists of, in order:

1. **Code functions** — one named function per code block, grouped by the
   workflow that uses them (deepest child first).
2. **Child workflow definitions** — `const <name>: WorkflowDefinition = {…}`,
   deepest-first so every reference is declared before use.
3. **The root workflow** — `export const workflow = {…}`.
4. **The meta object** — `export const meta = {…}`, always last so
   diagram/deployment churn stays out of semantic diffs AND so growing it
   never shifts the function-body line numbers above it (source maps and
   debugger breakpoints recorded against an earlier save stay valid). Two
   children: `layout` (always present) and `deploy` (present once the
   workflow has been deployed).

Example:

```ts
async function fetchUser(event: { orderId: string }) {
  // step body — returns the node's result
  return db.get(event.orderId);
}

function decide(fetchUser: any) {
  // condition body — its return value is matched against edge `match`es
  return fetchUser.status;
}

async function validateItem(item: any, index: number) {
  return check(item);
}

const processItemsBody = {
  darVersion: "1.0",
  name: "process-items-body",
  nodes: [
    { id: "b_start", kind: "start", name: "start" },
    {
      id: "v1",
      kind: "step",
      name: "validate",
      code: validateItem,
      retry: {
        kind: "exponential",
        maxAttempts: 3,
        initialDelaySeconds: 5,
        maxDelaySeconds: 300,
        backoffRate: 2,
        incrementSeconds: 1,
        jitter: "FULL",
      },
    },
  ],
  edges: [{ id: "be1", source: "b_start", target: "v1" }],
};

export const workflow = {
  darVersion: "1.0",
  name: "orders",
  dependencyMode: "linear",
  inputType: "{ orderId: string }",
  nodes: [
    { id: "s", kind: "start", name: "start" },
    {
      id: "n1",
      kind: "step",
      name: "fetch-user",
      code: fetchUser,
      retry: {
        /* … */
      },
    },
    { id: "n2", kind: "condition", name: "decide", code: decide },
    {
      id: "m1",
      kind: "map",
      name: "process-items",
      itemsCode: "return input.items;",
      maxConcurrency: 5,
      body: processItemsBody,
    },
  ],
  edges: [
    { id: "e1", source: "s", target: "n1" },
    { id: "e2", source: "n1", target: "n2" },
    { id: "e3", source: "n2", target: "m1", match: "PAID" },
  ],
};

export const meta = {
  layout: {
    direction: "TB",
    positions: {
      s: [60, 40],
      n1: [60, 170],
      n2: [60, 300],
      m1: [60, 430],
      b_start: [60, 40],
      v1: [60, 170],
    },
  },
  deploy: {
    functionName: "order-pipeline",
    region: "us-east-1",
    deployedAt: "2026-07-24T20:00:00.000Z",
  },
};
```

## 3. Code functions

### 3.1 Which fields become functions

| Node kind          | Field           | Function shape                                                  |
| ------------------ | --------------- | --------------------------------------------------------------- |
| `step`             | `code`          | `async function <name>(<scope>)`                                |
| `inline`           | `code`          | `function <name>(<scope>)` (sync — determinism by construction) |
| `condition`        | `code`          | `function <name>(<scope>)` (sync)                               |
| `waitForCondition` | `code`          | `async function <name>(state, <scope>)`                         |
| `callback`         | `submitterCode` | `async function <name>(callbackId, <scope>)`                    |
| `map`              | `itemsCode`     | stays an inline string in v1 (expression-like)                  |
| `end`              | `code`          | `function <name>(<scope>)` when present                         |
| fallback branches  | `fallbackCode`  | stays an inline string in v1 (short recovery values)            |

All other string fields (`initialState`, `stopCondition`, `payload`,
`startInput`, `input`, …) remain literal strings in the definition.

### 3.2 Naming

The function name is `toIdentifier(node.name)` — the same identifier the code
generator binds the node's result to, so definition and generated code agree.
Node-name uniqueness (already enforced) guarantees function-name uniqueness.

### 3.3 Scope as parameters

Inside the generated handler a node's code sees upstream results as lexical
consts. A standalone function can't, so its **parameter list encodes its
scope**, in order:

1. Kind-specific leads: `state` (waitForCondition), `callbackId` (callback).
2. Context extras: `event`/`input` at the root (typed by `inputType`),
   `item`/`index` inside a map body, `err` when the node is an error-route
   target.
3. Upstream result names (sorted), each typed by its node's `resultType` or
   `any`.

Parameter lists are **regenerated on save and ignored on load** — the body
text is the model content; the signature is derived. This makes the file
type-check while keeping the model unchanged.

## 4. The definition literal (static subset)

The parser accepts a deliberately restricted TypeScript subset inside
`WorkflowDefinition`/`meta` literals:

- object literals, array literals;
- string / number / boolean / `null` literals (including template-free
  strings);
- **identifier references** for `code` (must resolve to a top-level function
  declaration in the same file) and `body` (must resolve to a top-level
  workflow const declared earlier);
- unary minus on numbers.

Everything else — spreads, computed properties, function calls, ternaries,
imports of runtime values into the literal — is a **load error** with a
message naming the offending construct and location. This keeps loading a
pure static analysis: **the file is never executed**.

## 5. Child workflows

Container bodies (`map`/`group` `body`, `parallel` `branches[].body`) are
top-level consts referenced by identifier — never nested literals.

- Serialization emits deepest-first so references precede use (also satisfies
  tsc's use-before-declaration check).
- Validation rejects cycles (a definition reachable from itself) and, in v1,
  sharing (two containers referencing one definition). Sharing is reserved as
  a future reusable-sub-workflow feature.
- Node ids must be unique across the whole file (they already are — `newId`
  guarantees it) because `meta.layout.positions` is one flat map.

## 6. Meta

The trailing `meta` object carries everything that is ABOUT the workflow
rather than part of it:

- `layout` — presentation only: `direction` (`"TB"`/`"LR"`) and `positions`
  (`nodeId → [x, y]`). Advisory — missing entries fall back to auto-layout,
  stale ids are dropped on save. The definition itself contains no
  `position` fields.
- `deploy` — the deployment record, stamped by Workflow Studio on every
  deploy: `functionName`, `region`, `deployedAt` (ISO 8601). Lets a
  reopened file reconnect to its deployed Lambda (one-click debugging,
  deploy-name prefill) across editor restarts. Identity only — never
  machine-specific paths (debug artifact folders are derived from
  `functionName` at use time).

## 7. Round-trip & preservation policy (v1)

- On load, the parser recognizes: an optional type import, top-level function
  declarations, workflow consts, and the meta const. Any other top-level
  statement is a load error (v2 will add a preserved "helpers" region whose
  functions steps may call).
- On save, Studio always writes the canonical serialization: section order as
  §2, prettier-compatible formatting, parameter lists regenerated.
- JSON `.dar` remains the internal in-memory shape and (for now) the
  wire/embed format; `.dar.ts` ⇄ model conversion happens at the file
  boundary in the host.

## 8. Security

The parser uses the TypeScript compiler API for static extraction only.
Opening a `.dar.ts` must never evaluate it: no `import()`, no `eval`, no
module loading. Function bodies are carried as text into the model exactly
like JSON `code` strings are today, and receive the same treatment (they
become part of generated code the user deliberately deploys).

## 9. Phased rollout

| Phase        | Scope                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 (done)** | `darTs.ts` serializer + parser in the host (vscode-free, shared by desktop); round-trip tests.                                                                  |
| 2            | `.dar.ts` becomes the default save format and the embedded deploy artifact (`workflow.dar.ts` + tag); ASL importer and AI workflow generation emit it natively. |
| 3            | Helpers region (preserved user functions callable from steps), reusable shared sub-workflow definitions, `itemsCode`/`fallbackCode` promotion to functions.     |

## 10. Design decisions log

- **Function references, not name strings** — `code: fetchUser` is
  compiler-checked and navigable; a string would reintroduce silent drift.
- **Layout separated, not embedded** — same principle as edge-carried routing,
  applied in reverse: the definition holds exactly what codegen consumes;
  presentation lives in its own always-last section (BPMN DI precedent).
- **Flat child workflows** — readability, flat layout keying, tsc-checked
  references, future reuse (Argo-templates precedent); cycles/sharing pushed
  to validation, the same trade accepted for edges.
- **Params regenerated / ignored** — keeps the model identical to today's;
  the signature is a projection of scope, never hand-maintained truth.
- **Never execute** — static parse only; a workflow file must be safe to open.
