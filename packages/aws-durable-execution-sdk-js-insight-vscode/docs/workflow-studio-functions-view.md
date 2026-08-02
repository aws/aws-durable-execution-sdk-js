# Workflow Studio — Durable Functions view

A third top-level view (next to **Explorer** and **Workflow Studio**) that shows
deployed durable functions: pick a function, see its metadata, and browse its
executions in a table. Data comes straight from the Lambda **durable-execution
APIs** (no Insight pipeline needed), reusing the same region/credentials.

## Data sources (host, `functions.ts`)

- **Function picker**: `ListFunctions` (paginated), filtered to functions that
  have a `DurableConfig` → `{ name, runtime }[]`.
- **Function info**: `GetFunctionConfiguration` → name, runtime (language),
  memory, Lambda timeout, `DurableConfig` (executionTimeout, retention), last
  modified, code size, version, handler, description.
- **Executions**: `ListDurableExecutionsByFunction` (`ReverseOrder: true`,
  `MaxItems`, `Marker` for paging) → rows `{ arn, name, status, start, end }`
  (+ derived duration).

## Messages

- out: `listFunctions` · `getFunctionInfo {functionName}` ·
  `listExecutions {functionName, qualifier?, marker?}`
- in: `functionsList {functions,error?}` · `functionInfo {info,error?}` ·
  `executionsList {functionName, executions, nextMarker?, error?}`

## UI (`FunctionsPage.tsx`)

- Function **Select** (durable functions in the region) + Refresh.
- **Metadata** panel (key/value): runtime, memory, Lambda timeout, durable
  executionTimeout + retention, version, last modified, handler.
- **Executions table** (Cloudscape `Table`): Name/Id, Status (indicator),
  Started, Ended, Duration; a status filter, Refresh, and "Load more"
  (NextMarker). Newest first.

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. Host `functions.ts`** + message wiring (list/info/executions).
- [x] **3. Webview `FunctionsPage.tsx`** + message types + the 3rd tab.

## Later (not now)

Row → execution detail (`GetDurableExecutionHistory`), Stop a running execution
(`StopDurableExecution`), and overlaying an execution on the Studio diagram.
