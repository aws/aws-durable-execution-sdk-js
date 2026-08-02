# Workflow Studio — start execution + Execution Detail view

Add to the **Durable Functions** view a way to start a new execution (always
**async**), and a new **Execution Detail** view showing one execution's data.

## Host (`functions.ts`)

- `startExecution(ctx, { functionName, qualifier?, payload })` →
  `InvokeCommand` with `InvocationType: "Event"`, `Qualifier` (default
  `$LATEST`), JSON `Payload`. Returns `{ statusCode, durableExecutionArn }`
  (durable async invokes return the execution ARN).
- `getExecution(ctx, arn)` → `GetDurableExecutionCommand` → detail:
  `{ arn, name, functionArn, status, startTime, endTime, durationMs, version,
 input, result, error }` (input/result are JSON strings; error stringified).

## Messages

- out: `startExecution {functionName, payload}` · `getExecution {arn}`
- in: `executionStarted {functionName, durableExecutionArn?, statusCode?, error?}`
  · `executionDetail {detail|null, error?}`

## UI

- **Durable Functions view**: a **Start execution** button (with the function
  selected) → modal with a JSON payload editor → invoke async. On success,
  select the returned ARN and switch to Execution Detail; also refresh the list.
  Execution table **rows are clickable** → open Execution Detail for that ARN.
- **Execution Detail view** (4th segmented tab, contextual): metadata (status,
  started/ended/duration, version, function), and **Input** / **Result** /
  **Error** panels (pretty-printed JSON). Refresh + "Back to Durable Functions".

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. Host**: `startExecution` + `getExecution` + message wiring.
- [x] **3. Webview**: Start-execution modal, Execution Detail view + 4th tab,
      clickable rows, message types + App state.

## Later

Execution **history/timeline** (`GetDurableExecutionHistory`), **Stop** a
running execution (`StopDurableExecution`), overlay on the Studio diagram.
