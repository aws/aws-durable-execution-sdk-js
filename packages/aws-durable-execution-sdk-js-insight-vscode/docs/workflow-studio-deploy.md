# Workflow Studio — Deploy & Test from the Studio

Deploy the current workflow as a durable Lambda and invoke it, from the Studio —
automating the manual generate -> bundle -> create-function -> version -> alias
-> invoke loop. Uses the extension host's existing AWS credentials (the same
`resolveCredentials(profile)` + region the Insight side uses).

## Pipeline (host, `deploy.ts`)

1. `generateHandler(wf)` (reuse `@aws/durable-execution-sdk-js-cdk`).
2. Bundle: write `handler.ts` to a temp dir, `esbuild` build (bundle, platform
   node, format cjs, target node22) — the SDK resolves from the workspace — then
   zip the single `index.js` (`adm-zip`).
3. Execution role: use the configured role ARN if set; else ensure a role
   `<function>-role` with `AWSLambdaBasicDurableExecutionRolePolicy`
   (`@aws-sdk/client-iam`), waiting briefly for propagation.
4. `@aws-sdk/client-lambda`: `get-function` -> `create-function` (with
   `DurableConfig`: inferred `executionTimeout`, retention) or
   `update-function-code` (+ config); wait active/updated; `publish-version`;
   create/update the `live` alias.
5. Report the alias ARN back to the webview.

**Test (Phase 2):** `invoke` the alias (async when `executionTimeout` > 15 min,
else sync) and show the result + a CloudWatch tail.

## Dependencies (host)

`@aws-sdk/client-lambda`, `@aws-sdk/client-iam`, `adm-zip` (+ types),
`@aws/durable-execution-sdk-js` + `-cdk` (declare), and `esbuild` as a runtime
dep marked **external** in `esbuild.mjs` (required at runtime for bundling).

## UX

- A **Deploy** button (root only). Deploy is destructive (creates/updates AWS
  resources) -> a confirm modal shows function name, region, account before it
  runs. Status streams to a small panel (bundling / role / deploying / done +
  alias ARN, or error).
- Settings gain: **Lambda execution role ARN** (optional; auto-created when
  blank) and **retention days** (default 7). Region/profile reuse the existing
  Insight settings.

## Subtasks

- [x] **1. Doc** (this file).
- [x] **2. Deps + build**: add packages; mark `esbuild` external in `esbuild.mjs`.
- [x] **3. `deploy.ts`**: bundle (generate+esbuild+zip), ensure-role, deploy
      (create/update+version+alias). Pure-ish, host-only.
- [x] **4. Wire host**: `deployWorkflow` inbound message -> pipeline -> status
      messages; reuse `readConfig`/`resolveCredentials`.
- [x] **5. Webview**: Deploy button + confirm modal + status panel; message types.
- [ ] **6. Phase 2 — Test**: `invoke` + result/logs panel.

## Notes / caveats

- Runtime esbuild bundling works from source; a packaged `.vsix`
  (`--no-dependencies`) would need `esbuild` shipped — acceptable for now.
- Deploy performs irreversible AWS actions; always behind the confirm gate.
