# Workflow Studio + CDK Helper — Remaining Tasks

> Status legend: `[x]` done · `[~]` partially done · `[ ]` not started.
> Scope: the **Workflow Studio** (visual `.dar` builder in
> `aws-durable-execution-sdk-js-insight-vscode`), the **CDK helper**
> (`@aws/durable-execution-sdk-js-cdk`, generates a durable handler from a `.dar`
> at synth time), and the shared model
> (`@aws/durable-execution-sdk-js-visual-workflow-model`). See the CDK package's
> `docs/codegen-plan.md` for the codegen breakdown and `docs/shared-dar-model.md`
> for the shared-model design.

## Done so far

### Workflow Studio (authoring)

- [x] Canvas: drag/drop, zoom toolbar (in/out/%/fit), Sugiyama auto-layout, dynamic height.
- [x] **Undo/redo** (whole-`root` snapshots) in the canvas toolbar; load/clear reset history.
- [x] Node kinds: start, step, wait, callback, chainInvoke, waitForCondition,
      condition (branch/switch), map, group, parallel, end.
- [x] Containers with drill-in navigation + breadcrumb (map/group bodies, parallel branches).
- [x] Unique operation names; numbered defaults (`step1`, `step2`, …).
- [x] Per-workflow `dependencyMode` (linear default vs dag) with 1:1 enforcement in linear.
- [x] Terminal/end handling: end circles, per-branch ends, terminal marker moves.
- [x] "Edit in VS Code" scaffold that declares upstream result consts (`declare const StepA`).
- [x] End nodes: Return data / Throw error toggle + code block.
- [x] Error handling: node-owned error branches (`node.onError`) matched by error
      type, each routing to a node or a fallback value; try/catch + `instanceof`
      codegen; red/dashed canvas edges. See `workflow-studio-error-handling.md`.
- [x] Workflow **input typing**: author a TS type for `event`; codegen emits a
      typed handler param + root scaffold types.
- [x] **First-class `waitForCondition` stop predicate** (`stopCondition` boolean
      expression over `state`; replaces the `{ done: true }` convention, with a
      legacy fallback for older `.dar` files).
- [x] Dirty-tracking: Clear / Open / Edit-durable-function only prompt to discard
      after the workflow has actually been edited.
- [x] Maintainability refactor (StudioPage → hook + components + `studioModel`) +
      `studioModel` unit test harness (`npm test` in `webview-ui`).

### Deploy, inspect & round-trip

- [x] **Deploy from Studio**: bundle the generated handler, ensure an execution
      role, create/update the function (inferred `executionTimeout`), publish a
      version + `live` alias. Progress log; confirm-before-overwrite.
- [x] **Durable Functions view**: searchable function picker, function info,
      executions list.
- [x] **Start execution** (async invoke) + **Execution Detail** view — tabbed
      Summary / Input / Output (Cloudscape `CodeView` JSON) above two tabs:
      **Operations** (tree aggregated from history by operation, status colored,
      with a per-operation detail modal) and **History** (event table + CSV/JSON
      export).
- [x] **Auto-refresh** the Execution Detail while the execution is non-terminal;
      **Stop execution** (`StopDurableExecutionCommand`, confirm-gated).
- [x] **Graph tab**: read-only workflow graph rendered from the embedded `.dar`,
      each node colored by its operation status; nested map/parallel/group
      containers with collapse/expand; circular start/end.
- [x] **Store the full `.dar`** in the deployed Lambda package (Studio deploy +
      CDK construct) plus a `workflowStudioDar` tag; **Edit durable Function**
      lists tagged functions and reopens the embedded `.dar` in Studio.
- [x] **Edit-durable-Function list** filtered **server-side** via the Resource
      Groups Tagging API (`tag:GetResources`), replacing the per-function
      `ListTags` fan-out.
- [x] **Durable Functions view** streams `ListFunctions` pages progressively with a
      loading state (avoids the "no functions" flash on large accounts); the
      executions table has a **Refresh** action.
- [x] **Execution graph** colors `awsJob` nodes correctly (single child-context
      operation; legacy fallback aggregates `-start`/`-wait`).

### CDK helper

- [x] `generateHandler` for every node kind (deterministic, result-const data flow).
- [x] Retry/wait strategies; recursive scope-aware container emitter; condition
      `switch`; end return/throw; `inferExecutionTimeoutSeconds` (longest path).
- [x] `DurableWorkflowFunction` construct (NodejsFunction + durableConfig + version + alias); embeds the `.dar` + tag via `bundling.commandHooks`.
- [x] README + codegen-plan doc; tests incl. a synth test and an all-kinds handler
      that type-checks against the SDK. Validated end-to-end against AWS.

### Shared model — `@aws/durable-execution-sdk-js-visual-workflow-model`

- [x] Single source of truth for `.dar` primitives: node kinds (+ runtime
      `DAR_NODE_KINDS`), edge/errorBranch/position types, `DAR_VERSION`,
      identifiers (`toIdentifier`/`buildIdentifierMap`/`RESERVED_IDENTIFIERS`),
      retry/wait strategy spec (`normalizeStrategy` + defaults), `DAR_JSON_SCHEMA`,
      and `migrateDar` (version-aware migration engine, registry empty until the
      schema changes). CDK + Studio both import/re-export it; the cross-package
      agreement test now guards the re-export wiring.

### AWS service integrations ("Jobs" / Run-a-Job `.sync`)

- [x] **`awsJob` node kind** + shared **`SERVICE_INTEGRATIONS` registry** (start/poll/
      status/terminal-states/IAM/timeout presets), consumed by both CDK codegen and
      Studio. See `workflow-studio-service-integrations.md`.
- [x] **15 presets** across Tier 1 (Glue, Batch, CodeBuild, Athena, Step Functions,
      ECS), Tier 2 (Glue DataBrew, EMR Serverless, EMR-on-EKS, EMR, SageMaker
      training/transform/processing), Tier 3 (MediaConvert, Bedrock). EKS runJob
      intentionally omitted (Kubernetes API, not a single SDK call).
- [x] **Codegen** expands one `awsJob` into `context.runInChildContext(name, …)`
      containing a start `step` + poll `waitForCondition` + terminal-failure throw
      (AWS SDK v3; per-package client imports). The child context makes the job a
      single named operation that maps 1:1 to the graph node and fails correctly.
- [x] Permission analysis emits each preset's IAM actions; timeout inference uses
      `maxWaitSeconds`. Validated end-to-end on a live account (deploy + a real
      Step Functions execution, both success and failure paths).
- [x] Studio **"Jobs" palette** (one entry per integration), **structured start-input
      form** (`startParams` schema) with an "Edit as JSON" toggle (Phase 1), and
      **live resource pickers** (Autosuggest, Phase 2) that always allow manual
      entry when listing is denied/fails. Integration shown read-only (not a
      switchable dropdown).

## Correctness (resolved)

- [x] **Identifier-collision.** `buildIdentifierMap` is 1:1 and throws on clashes /
      reserved names; the Studio validates before export; scaffold + codegen share
      one map (now via the shared package).
- [x] **Shared `.dar` model** extracted (see above) — the extension and CDK no
      longer keep duplicate models.
- [x] **`executionTimeout` inference** takes the longest path (max branch), not the
      sum of every branch.

## Remaining — Workflow Studio

- [x] **Typed results**: optional per-node `resultType` (TS type) — emitted as a
      `const/let <name>: <Type>` annotation and threaded into the "Edit in VS
      Code" scaffold's `declare const`s (`scopeTypes`), so downstream code
      type-checks/autocompletes against real types instead of `any`. Plus
      **on-demand inference** ("Infer" button on step / waitForCondition): the
      host compiles the node's code in the scaffold and reads the return type
      back via the TS compiler API, in dependency order (upstream types feed the
      next node); author-declared types win. SDK-heavy bodies resolve to `any`
      and are dropped — precise inference of SDK call results would need the real
      `.d.ts` sets loaded into the checker (larger, not done).
- [x] **Built-in Monaco editor** (replaces the "Edit in VS Code" round-trip): an
      in-webview modal running the TS language service in-browser, seeded with the
      node's scaffold context (StepCtx/WaitCtx, typed `event`/`input`, typed
      upstream result consts) for real type-checking + autocomplete. Workers are
      bundled to `media/monaco` and spawned via a same-origin blob (`importScripts`)
      with CSP updated for `worker-src`/`blob:`.
- [x] **Auto-infer on editor close**: closing a step/waitForCondition block
      silently re-infers its result type — the manual "Result type (TS)" field and
      "Infer" button were removed.
- [ ] **Follow-ups from the built-in editor**: needs runtime validation in a
      launched extension (worker/CSP can't be verified from a headless build);
      remove now-dead host code (`onEditCode`/`wrapCodeBlock`/`editCode` message +
      temp-file `codeUpdated` streaming); trim the ~5 MB webview / ~6.7 MB ts.worker
      bundles if load time regresses.
- [~] **Result-type inference follow-ups**: cascade is **done** — a code change
  re-infers all inferable nodes at that level in dependency order (types fed
  forward) so downstream stored types don't go stale. Still TODO: inference
  for nodes inside map/group/parallel bodies (per-container scope, they
  self-infer today); optional real-`.d.ts` typing so SDK call results infer
  precisely instead of `any`.
- [ ] **Inline Monaco editing** — done (see "Built-in Monaco editor" above); the
      remaining gap is precise SDK-result types (needs real `.d.ts`, see below).
- [ ] **Deeper on-canvas validation**: invalid JSON in `payload`/`initialState`,
      missing/unqualified `chainInvoke` ARNs, duplicate condition labels,
      unreachable nodes, DAG-reconvergence warnings. (Could use `DAR_JSON_SCHEMA`.)
- [ ] Editor niceties: **keyboard shortcuts** (incl. Cmd/Ctrl+Z for undo/redo),
      copy/paste, multi-select.
- [ ] **Template gallery** (saga, human-approval, agentic loop).
- [ ] **Cross-link Graph ↔ Operations**: click a graph node (or operation row) to
      open its detail modal.
- [ ] **Overlay a live/replayed execution on the editing canvas** (the Graph tab
      is a separate read-only view today).
- [ ] **Session caching** for the Durable Functions list (full enumeration is still
      ~1 sequential `ListFunctions` page per 50 functions on large accounts;
      streaming helps, but re-opening the view refetches).

## Remaining — AWS service integrations

- [x] **Bounded polling / per-job timeout**: the generated `waitForCondition`
      caps attempts at `ceil(maxWaitSeconds / pollSeconds)` (via the `attempt`
      arg) and throws "did not complete within ~Ns" on a non-success terminal, so
      it can't poll to the durable `executionTimeout`. (Optional per-node max
      override still TODO.)
- [ ] **Retry strategy on the start step + poll backoff/jitter** (reuse the
      existing `RetryStrategySpec` UI on `awsJob`).
- [ ] **Resource pickers Phase 2 polish**: cover more kinds (EMR / SageMaker /
      Bedrock / MediaConvert), "optional parameters" discoverability, cross-account
      credentials field.
- [ ] Document the **soft IAM** the pickers use (`glue:ListJobs`, `batch:Describe*`,
      `codebuild:ListProjects`, `states:ListStateMachines`, `ecs:List*`) and
      `tag:GetResources` for Edit-durable-Function.

## Remaining — CDK helper

- [ ] **Synth-time validation**: throw clear errors for unsupported shapes (DAG
      joins, condition reconvergence) instead of generating subtly wrong code.
- [ ] Emit a `@aws/durable-execution-sdk-js-testing` spec per workflow.
- [x] IAM beyond checkpointing: inferred from workflow code — SDK v3 usage +
      `lambda:InvokeFunction` for `chainInvoke` targets + `awsJob` preset actions
      (`grantInferredPermissions`, default on).
- [x] The embedded-`.dar` `commandHooks` copy is now **cross-platform**
      (`copy` on win32, `cp` elsewhere).
- [ ] Remove the `cwd` side-effect + esbuild `import.meta` warning (write the entry
      into `cdk.out` / `Code.fromAsset`, force the SDK's CJS build).
- [ ] Golden-file / snapshot tests of generated handlers.
- [ ] Expose more SDK knobs: callback `heartbeatTimeout`, step `semantics`, custom
      completion predicates.
- [ ] A tiny CLI (`dar deploy w6.dar`) wrapping generate → bundle → deploy.
- [ ] True DAG/parallel-join codegen once the SDK supports it.

## Known limitations (documented, not blocking)

- `condition` branches must be independent linear tails (no reconvergence).
- `map` `itemsCode` must be deterministic (it runs outside a step).
- Generated handler bridges `const input = event;`; a benign esbuild `import.meta`
  warning appears during bundling (dead code in the CJS bundle).

## Second-eye review (2026-07-19)

Independent audit of the extension after the service-integrations / typed-results
/ inference / built-in-Monaco work.

**Resolved:**

- [x] **Bounded `awsJob` poll loop** (attempt cap + timeout throw).
- [x] **Inference cascade** (level-wide, dependency-ordered on each code change).
- [x] **Removed the dead "Edit in VS Code" path** (host + webview).
- [x] **Inbound message hardening**: ignore malformed messages; validate the
      AWS-mutating commands' string fields (`deployWorkflow`/`startExecution`/
      `stopExecution`).
- [x] **Inferred-IAM wildcard warning** surfaced in the deploy confirmation
      (which was already a modal listing actions `on *` + explicit consent).

**Open (prioritized):**

- [ ] **CRITICAL — VSIX packaging.** `esbuild`, `typescript`, `node-llama-cpp`
      are esbuild `external` (native binary / on-disk lib files) but don't ship:
      this is a hoisted monorepo, so `vsce package --no-dependencies` excludes
      node_modules, and `.vscodeignore` negations don't help under
      `--no-dependencies` (verified with `vsce ls`). Deploy (esbuild), on-host
      inference (typescript), and local models (node-llama-cpp) therefore only
      work in F5/dev. Needs a dedicated step that vendors these packages (+
      transitive deps) into `dist/node_modules/`, validated by building +
      installing an actual `.vsix`.
- [ ] Tighten inferred IAM `Resource: "*"` to concrete ARNs where derivable.
- [ ] Tests for `resources.ts`, `deploy.ts`, `monacoSetup`/editor.
- [ ] **Harden the sandbox dry-run validator (`agent.ts` `dryRun`/`validateDarJson`)**
      so conversions are trustworthy _before_ deploy. Today the mock SDK is too
      lenient and masked two real runtime failures found while deploying converted
      Step Functions machines (us-east-2, 2026-07-19): - **`JSON.parse(response.Payload)`** on a Lambda invoke — SDK v3 returns a
      `Uint8Array`, so this throws at runtime; the mock returned `{}` so it
      passed. (Now mitigated by a codegen guard: `JSON.parse(...Payload)` →
      `JSON.parse(new TextDecoder().decode(...Payload))`.) - **Map over `undefined`** (`input.items` when invoked with `{}`) — real
      `context.map` throws on `items.length`; the mock defaulted a non-array to
      `[]` and hid it. (Now mitigated by a codegen guard: map items `?? []`.)
      Codegen guards prevent the _crash_, but the validator should still _catch_
      these classes pre-deploy. Options: (a) make the mock `map`/`invoke` behave
      like the real SDK (invoke `Payload` = an encoded `Uint8Array`; `map` requires
      an array and throws otherwise) so bad code fails the dry-run; (b) dry-run with
      a representative input derived from `inputType`/the source ASL instead of the
      current empty `{}`; (c) surface a warning when step code parses `.Payload`
      without decoding or maps a possibly-nullish expression. Goal: the
      validate→judge loop rejects code that would fault at runtime rather than
      relying only on the deterministic codegen safety nets.
- [ ] LOW/nits: revoke Monaco worker blob URLs; drop `script-src blob:` if
      `worker-src` suffices; post-`await` cancelled check in the editor create
      effect; `__MONACO_WORKER_BASE__` `</script>` escaping (trusted value);
      cache the TS `Program` across inference calls.

## Top 3 (biggest payoff now)

1. **VSIX packaging** — vendor the esbuild/typescript/node-llama-cpp externals so
   deploy, inference, and local models work in a packaged install (not just dev).
2. **Cross-link Graph ↔ Operations** + overlay on the editing canvas (inspection UX).
3. **CDK synth-time validation** (prevents silently-wrong deploys).
