# Workflow Studio — identifier integrity (collision fix)

## The bug

A node's result is bound in the generated handler as `const <ident>` where
`ident` comes from the CDK's `buildIdentifierMap`, which **de-duplicates
collisions with a `_2` suffix**. But a node's _code_ (and the "Edit in VS Code"
scaffold's `declare const`) references upstream results by **`toIdentifier(name)`
with no suffix**. So when two distinct names sanitize to the same identifier
(`"my step"` and `"my-step"` → `my_step`), or a name sanitizes to a runtime
symbol (`event`, `input`, `err`, `item`, …) or a JS keyword (`return`), the
scaffold and the generated code disagree → silent wrong reference (or broken
generated code).

## Fix

Make identifiers **1:1 with `toIdentifier(name)`** and reject clashes instead of
silently renaming:

- **CDK `buildIdentifierMap`**: map each operation node to `toIdentifier(name)`
  directly; **throw** a clear error if two nodes collide or an identifier is
  reserved. Generated consts then exactly match the scaffold's `declare const`.
- **Studio validation**: flag (as errors) operation nodes whose
  `toIdentifier(name)` duplicates another's or hits a **reserved identifier**
  (runtime-injected names + JS keywords). This surfaces the problem at authoring
  time so a workflow is always "identifier-clean" before codegen.
- **Reserved set**: runtime-injected symbols (`event`, `input`, `context`,
  `stepCtx`, `ctx`, `childCtx`, `callbackId`, `state`, `err`, `item`, `index`,
  `handler`) + JS reserved words. Defined identically in both packages.

## Drift note (follow-up)

`toIdentifier` + the reserved set are duplicated across the extension and the
CDK package. This change keeps them in sync by hand + tests in both suites. The
real fix is the **shared `.dar` model package** (separate, larger effort:
new workspace package, webview bundling, versioned schema + migrations) — tracked
in `workflow-studio-remaining-tasks.md`.

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. CDK**: 1:1 `buildIdentifierMap` + throw; expand reserved; update tests.
- [x] **3. Studio**: reserved set + identifier-clash validation; test.
