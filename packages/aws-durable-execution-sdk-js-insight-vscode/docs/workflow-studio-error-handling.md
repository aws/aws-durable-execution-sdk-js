# Workflow Studio — Node error handling (error edges + fallback)

Phase 1 of error handling: let a node handle failure (retries exhausted,
callback timeout, invoke failure, etc.) instead of always failing the execution.
Two complementary mechanisms:

- **Fallback value** (Option 3): on failure, bind a fallback result and continue.
- **Error path / error edge** (Option 2): on failure, route to another node
  (a `try/catch` whose catch runs the error branch).

## Model

`DarEdge`:

- `onError?: boolean` — marks the edge as the failing node's **catch/error**
  path (default/absent = normal flow edge). A node may have one normal "next"
  edge **and** one `onError` edge.

Operation nodes (via `DarNodeCommon`, meaningful only for supported kinds):

- `errorMode?: "fail" | "fallback" | "errorPath"` — default `"fail"`.
- `fallbackCode?: string` — a JS **expression** used when
  `errorMode === "fallback"` (may reference `err` and upstream result consts).
  Default `undefined`.

**Supported kinds:** `step`, `callback`, `chainInvoke`, `waitForCondition`,
`map`, `group`, `parallel`. Not `wait` (void), not `condition` (has its own
branching), not `start`/`end`.

## Codegen mapping

The node's durable call becomes an assignable expression; `emitChain` composes
the binding + try/catch based on `errorMode`.

- **fail** (today):
  ```ts
  const X = await context.step("X", fn, { retryStrategy });
  ```
- **fallback**:
  ```ts
  let X;
  try {
    X = await context.step("X", fn, { retryStrategy });
  } catch (err) {
    X = <fallbackCode ?? undefined>;
  }
  ```
- **errorPath** (follows the node's `onError` edge target):
  ```ts
  let X;
  try {
    X = await context.step("X", fn, { retryStrategy });
  } catch (err) {
    // → error-branch tail (notify / compensate / end-throw / end-return)
  }
  ```

The walker's "next" is the first **non-`onError`** outgoing edge; the error edge
is followed only inside the catch. If the error branch doesn't itself terminate
(end node throw/return), control falls through to the node's normal next with
`X` left `undefined` (documented "handle and continue"). The caught error is
bound as `err` in scope.

## Authoring UX (recommended)

Node inspector gains an **"On failure"** section:

- `Select`: **Fail** (default) · **Fallback value** · **Error path**.
- **Fallback value** → a code field for the fallback expression (may use `err`).
- **Error path** → a target-node picker that creates/updates the `onError` edge
  from this node (reuses the `Select` pattern; avoids new canvas drag mechanics).

Canvas renders `onError` edges distinctly (**red, dashed, "on error" badge**);
the existing edge-delete ✕ removes them. (A canvas drag affordance for error
edges is a later enhancement.)

## Validation

- `errorMode === "errorPath"` requires exactly one `onError` edge (warn if none).
- `fallbackCode` blank in fallback mode → falls back to `undefined` (info).
- `onError` edge out of an unsupported kind → warn.

## Subtasks (one reviewed commit each)

- [x] **1. This design doc.**
- [x] **2. CDK codegen.** Model fields in `darModel`; refactor `emitNode` to emit
      the durable call as an expression; `emitChain` composes const / let+try/catch
      (fail/fallback/errorPath); "next" = first non-`onError` edge; error branch
      emitted in the catch. Tests for all three modes + a per-kind smoke test.
- [x] **3. Studio model.** `DarEdge.onError`; node `errorMode` + `fallbackCode`;
      preserve in `parseWorkflow`; validation rules above.
- [x] **4. Studio inspector.** "On failure" section (Select + fallback code field + error-path target picker that manages the `onError` edge).
- [x] **5. Studio canvas.** Render `onError` edges red/dashed with a badge.
- [x] **6. Docs.** Add an "Error handling" section to
      `workflow-studio-remaining-tasks.md`; note it in the CDK README.

## Out of scope (later phases)

Try/catch **container**, **finally/cleanup**, **saga/compensation**, and
**error filtering** (by error type/pattern) — tracked in the improvements list.

## Phase 2 — node-owned error branches (route OR fallback per branch)

Folds "fallback value" into the error-branch list: each branch matches an error
type and either **routes** to a node or supplies a **fallback value**. Error
routing moves **off edges** onto the node (Option A).

### Model changes

- Remove `DarEdge.onError` and the node's `errorMode` + `fallbackCode`.
- Add to the node:
  ```ts
  interface ErrorBranch {
    id: string;
    errorType?: string; // blank/undefined = catch-all (else)
    target?: string; // node id — a "route" branch
    fallbackCode?: string; // block returning the fallback — a "fallback" branch
  }
  // node.onError?: ErrorBranch[]   (empty/absent = fail/propagate)
  ```
  A branch routes when `target` is set, or is a fallback when `fallbackCode` is
  set (mutually exclusive in the UI). Order = `instanceof` order.

### Codegen

- No branches → `const X = <op>;` (unchanged fail behavior).
- ≥1 branch → `let X; try { X = <op>; } catch (err) { <chain> }` where the chain
  is `if (err instanceof <errorType>) { … }` per labelled branch (unlabelled =
  `else`, else `throw err`). A **route** branch emits the target's tail; a
  **fallback** branch emits `X = await (async () => { <fallbackCode> })();`.

### Studio

- Inspector: an "Error branches" list (add/remove); each row = error type input +
  a Route/Fallback toggle + (target picker | fallback code field with
  Edit-in-VS-Code). Managed by patching `node.onError` via `updateNode` — the
  `setErrorEdge`/`addErrorBranch` hook actions are removed.
- Per-branch fallback round-trip token: `${nodeId}::onErrorFallback::${branchId}`
  (the codeUpdate effect updates that branch's `fallbackCode`).
- Canvas: **derive** red/dashed edges from route branches (display-only, with the
  error-type or "any" badge); edges are no longer the source of truth.

### Subtasks (one reviewed commit each)

- [x] **P2.1 Doc** (this section).
- [x] **P2.2 CDK.** `ErrorBranch` + `node.onError` in `darModel`; remove
      `DarEdge.onError`; codegen over branches (route/fallback); tests.
- [x] **P2.3 Studio model.** Same model change; `parseWorkflow` parses/validates
      `onError`; validation over branches; drop `errorMode`/`fallbackCode`.
- [x] **P2.4 Studio inspector + round-trip.** Branch-list editor; nested fallback
      token in the codeUpdate effect; remove the old hook edge actions.
- [x] **P2.5 Studio canvas.** Derive route-branch edges + badges.
- [x] **P2.6 Docs.** Checkoff + README/remaining-tasks.
