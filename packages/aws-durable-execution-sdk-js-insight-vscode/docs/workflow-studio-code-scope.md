# Workflow Studio — per-scope code accessibility

The "Edit in VS Code" scaffold should declare exactly what a node's code can
reference **in the scope it runs in**, so authoring matches the generated
handler and different workflow levels are isolated.

## Accessible symbols per scope

| Scope                          | Symbols the scaffold declares (besides `stepCtx`)              |
| ------------------------------ | -------------------------------------------------------------- |
| Root workflow                  | `event`, `input`, upstream result consts                       |
| Map body                       | `item`, `index`, body-local result consts (no execution input) |
| Group / parallel branch body   | body-local result consts (no execution input)                  |
| Error-route target (any scope) | + `err`                                                        |
| waitForCondition check         | `state` (via codeKind signature)                               |
| callback submitter             | `callbackId` (via codeKind signature)                          |

Rationale: **child workflows don't get execution input** — a map iteration is
scoped to its `item`, a group/parallel branch to its own body. Isolation is
expressed by what each scope grants. (Runtime note: container bodies are JS
closures, so `event`/`input` are technically reachable at runtime; we enforce
softly by not surfacing them in the scaffold rather than shadowing.)

## Design

- `scopeExtras(root, path)` → the non-result symbols for the active scope:
  `[]`-path ⇒ `["event","input"]`; inside a `map` body ⇒ `["item","index"]`;
  inside a group node / parallel branch ⇒ `[]`.
- The Studio passes these `scopeSymbols` (computed from `path`) into
  `NodeInspector`, which builds each node's code scope as
  `[...scopeSymbols, ...(isErrorTarget ? ["err"] : []), ...upstreamResultNames()]`
  and threads it through `onEditCode` → `wrapCodeBlock` (declares each as `any`).

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. `scopeExtras` helper** in `studioModel`.
- [x] **3. Wire `scopeSymbols`** from `StudioPage` (has `path`/`rootWf`) into
      `NodeInspector`; add `err` for error-route targets; declare `item`/`index`
      in map bodies and `event`/`input` at root.
- [x] **4. Scaffold comment** generalized (not always "result of an upstream node").
