# Workflow Studio — AI agent (generate workflow + node code)

## Goal

Use the extension's existing LLM providers (Bedrock / Copilot / local /
local-server, already configured for the Explorer) to:

1. **Generate a whole workflow** from a natural-language description — an
   **Agent** button (Studio header) opens a modal; the model returns a `.dar`
   which we validate and load onto the canvas.
2. **Generate a single node's code** — an **agent** button next to each code
   field (step, waitForCondition `code`, condition expression, callback submitter,
   map `itemsCode`, end code, error `fallbackCode`); describe what it should do
   and the model writes just that TypeScript block.

## Reuse

- **`llm.ts` `completeText(opts, prompt, maxTokens)`** — one-shot completion
  across all providers. Export it (or thin wrappers `generateWorkflowDar` /
  `generateNodeCode`) and call from new host handlers using `awsContext()` +
  `readConfig()` (`llmProvider`, `bedrockModelId`, `localModel`, …).
- **Shared model** — `DAR_JSON_SCHEMA` + `DAR_NODE_KINDS` go into the workflow
  prompt so the model emits the right shape; `parseWorkflow` (tolerant: fills
  per-kind defaults via `createNode`, runs `migrateDar`) validates/normalizes the
  result, so the model can emit minimal nodes.
- **Per-field context** — the inspector already computes the code **scope**
  (upstream result consts) + workflow **input type** for "Edit in VS Code"; feed
  the same into the node-code prompt so generated code references real names.

## Message flow (webview <-> host)

- `generateWorkflow { requestId, description }` -> `agentWorkflow { requestId, dar?, error? }`
- `generateNodeCode { requestId, kind, field, name, description, scope[], inputType?, currentCode? }`
  -> `agentNodeCode { requestId, code?, error? }`

`requestId` correlates async responses. Host handlers build the prompt, call
`completeText`, strip code fences, and (for workflows) `parseWorkflow` before
returning; errors surface as `error`.

## UX

- **Whole workflow**: header **Agent** button -> modal (multiline description +
  Generate). On success, load like an opened `.dar` (replaces canvas via the
  loaded/nonce path, resets undo history) - reuse the discard-changes confirm
  when dirty.
- **Node code**: small **agent** (magic-wand) button on each `CodeField` ->
  modal with a description box -> fills the field's code (`onChange`), which the
  user can then refine or open in VS Code. Generic in `CodeField` via an
  `onAgent(currentValue) => Promise<string>` prop.
- **Availability**: gate the buttons on a configured provider (the webview already
  receives `llmProvider` in settings). If none, disable with a tooltip pointing at
  Settings.

## Prompting (kept host-side, versioned)

- **Workflow**: system prompt describes the `.dar` shape (kinds + key per-kind
  fields: `code`, `retry`, `initialState`/`stopCondition`, `branches`, `body`,
  `itemsCode`, `onError`, edges, `dependencyMode`), embeds `DAR_JSON_SCHEMA`,
  and demands "JSON only". Parse -> on failure, one repair retry, else error.
- **Node code**: system prompt states it writes the body of a
  `context.step(...)` (or the relevant construct), lists in-scope consts
  (`event`/`input`, upstream results, `state`/`err`/`item` as applicable), the
  input type, and "return the result; TypeScript only, no fences".

## Phases

1. **Node-code agent** (smaller; reuses scope/inputType + `CodeField`). Ship first.
2. **Whole-workflow agent** (header button + modal + `.dar` parse/load).
3. Polish: repair-retry, streaming, provider-availability messaging, prompt tests.

## Risks / notes

- LLM output is untrusted: never `eval` it; only place it as editable text /
  parse as JSON. `parseWorkflow` already guards structure.
- Non-Bedrock providers have no token knob (Copilot) - accept model defaults.
- Generated code isn't type-checked in-Studio yet (ties into the open
  "typed results" / inline-Monaco work); the user reviews before deploy.
