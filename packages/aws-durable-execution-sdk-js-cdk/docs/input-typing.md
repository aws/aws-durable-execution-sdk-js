# Workflow Studio — input typing (TypeScript type)

Let the author declare the workflow's **execution input type** so the generated
handler is typed and downstream code gets real autocomplete instead of `any`.

## Model

- `DarWorkflow.inputType?: string` — a TypeScript type expression for the
  payload (e.g. `{ orderId: string; amount: number }`). Absent → `unknown`.
  Root-only (child workflows don't receive the execution input).

## Codegen (CDK)

Emit a named alias and type the handler param:

```ts
type WorkflowInput = { orderId: string; amount: number };
export const handler = withDurableExecution(
  async (event: WorkflowInput, context: DurableContext) => {
    const input = event;
    …
```

Absent `inputType` => `type WorkflowInput = unknown;`.

## Studio

- A root-only "Workflow input type" editor (shown when `path` is empty) bound to
  `inputType` via a `setInputType` hook action.
- The **root** "Edit in VS Code" scaffold declares `event`/`input` as
  `WorkflowInput` (emitting `type WorkflowInput = <inputType>` + typed
  `declare const`) instead of `any`. The `inputType` is threaded through the
  `editCode` message -> `wrapCodeBlock`. Child scopes are unaffected (they don't
  get `event`/`input`).

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. CDK**: `inputType` on the model; codegen emits the alias + typed
      param; tests.
- [x] **3. Studio model**: `inputType` on `DarWorkflow`; preserved by
      `parseWorkflow`.
- [x] **4. Studio UI + scaffold**: `setInputType` action; root-only input-type
      editor; thread `inputType` to `wrapCodeBlock` so root `event`/`input` are
      typed.

## Out of scope

Runtime input **validation** (JSON Schema -> a validator at the handler
boundary) — a separate later feature; can reuse this type or generate it.
