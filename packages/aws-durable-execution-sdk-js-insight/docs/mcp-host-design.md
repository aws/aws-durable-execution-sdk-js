# Workflow Insight as an MCP Host — Design

|              |                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Status**   | Phases 0–5 complete. Phase 1 merged (#809); Phases 2–5 are **this** change                            |
| **Scope**    | New package `@aws/durable-insight-mcp`, plus extraction of `durable-insight-core`                     |
| **Baseline** | `main` @ `556bfd40`, i.e. after #795 (dual host), #804 (disclosure), #809 (core)                      |
| **Legal**    | **Confirmed** — disclosure only, no consent gate. See [§8](#8-disclosure-readme-only-no-consent-gate) |

> This document ships with the implementation it describes. Phase 1 (the shared core)
> merged separately as #809; Phases 2–5 are the change you are reading. Phase 6 is
> deliberately deferred — see §11.

---

## 1. Summary

Customers have asked to use Workflow Insight from inside the AI agent they already
work in — Claude Code, Kiro IDE, Kiro CLI — rather than through a VS Code
extension or a desktop app.

We propose serving that as a **third host** on the seam introduced by #795: an MCP
server that exposes the existing query layer as tools, paired with a **skill** that
carries the per-destination schema expertise we already generate for our own
prompts.

The work is meaningfully smaller than the Electron host was, because this host
_deletes_ a subsystem rather than adding one: the agent is the model, so roughly
1,700 lines of LLM plumbing do not come along.

Phase 0 is complete: Legal confirmed the disclosure position (§8), design review
ratified that the MCP host bypasses `ExplorerSession` (§6.3), and client config paths
are verified (§6.4). Phase 1 — extracting `durable-insight-core` — is unblocked. The
remaining open items (§15) are scoping calls, not blockers.

---

## 2. Motivation

**Customer feedback.** The functionality is wanted, the delivery vehicle is not.
Users investigating a failed workflow are already in an agent session; switching to
a separate app to ask "why did this fail" and then switching back to act on the
answer is the friction being reported.

**The follow-up question is the real product.** Today a user asks one question, gets
a table, and asks the next question from scratch. In an agent, "show me the input
payloads for those three executions" is just the next turn — no new UI, no new query
mode, no chart configuration. This is a capability the extension structurally cannot
offer, not merely a packaging preference.

**Competitive parity.** Our own competitive analysis records DBOS shipping an "MCP
server for AI agents" (`workflow-observability-requirements-v2.md`, DBOS row). This
is table stakes rather than differentiation.

**Architectural validation.** #795 asserted that Explorer behavior is host-free. A
third host with a radically different shape — no UI, no webview, no LLM — is the
strongest available test of that claim, and the cheapest time to find out it is
false.

---

## 3. Goals and non-goals

### Goals

- **G1** Query workflow execution data from any MCP-capable agent with no install
  step beyond a config block.
- **G2** Support the destinations the extension supports, with the same read-only
  guarantees.
- **G3** Give the agent enough schema knowledge to write correct queries against
  whichever of the 8 destinations the customer uses.
- **G4** Reuse the existing core rather than fork it; a third consumer must not
  cause a third copy of anything.
- **G5** Setup no harder than the extension's — ideally easier, since credentials
  need no configuration.

### Non-goals

- **NG1** Charts and an interactive result grid. See §9.
- **NG2** Replacing the VS Code or Electron hosts. This is additive; both keep
  every feature they have today.
- **NG3** Shipping our own LLM integration in this host. The agent supplies the
  model, and we should not second-guess it.
- **NG4** Write operations of any kind. Read-only is a product invariant, not a
  phase-one limitation.
- **NG5** Streaming/tail in v1. See §11 Phase 6.

---

## 4. Background: what #795 left us

Measured on `main` @ `556bfd40`, in `packages/aws-durable-execution-sdk-js-insight-vscode/src`:

| Category                | Files                                                                                                           | Lines     | Fate in MCP host                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------- |
| **VS Code-bound**       | `extension.ts` (248), `config.ts` (31)                                                                          | **279**   | Not used                           |
| Data access             | `athena` 436, `opensearch` 222, `logsInsights` 218, `redshift` 205, `aurora` 148, `dynamodb` 130, `sqs` 110     | **1,469** | **Reused as-is**                   |
| Schema knowledge        | `schema.ts`                                                                                                     | **754**   | **Reused**; also becomes the skill |
| Query safety            | `queryShape` 392, `verdict` 143, `queryValidator` 127, `sandbox` 101                                            | **763**   | Reused; safety promoted (§6.7)     |
| Destination diagnostics | `destinationTest.ts`                                                                                            | **411**   | **Reused** as `test_destination`   |
| Seam                    | `configCore` 220, `hostCapabilities` 105, `hostPort` 80                                                         | **405**   | Reused, adapted                    |
| Session/dispatch        | `explorerSession.ts`                                                                                            | **1,639** | Partially reused (§6.3)            |
| **LLM machinery**       | `llm` 851, `agentLoop` 528, `bedrockModels` 86, `localServerParse` 84, `bedrockConverse` 70, `copilotBridge` 58 | **1,677** | **Dropped**                        |
| Charts                  | `chartSpec.ts`                                                                                                  | **238**   | Not used in v1 (§9)                |

Only **279 of ~7,000 lines** are VS Code-bound. The Electron host already proved
the remainder is portable, and `hostAgnostic.test.ts` mechanically enforces that no
module reachable from a non-VS-Code host imports `vscode`.

**Dropping 1,677 lines of LLM plumbing also drops its problems:** provider
selection and coercion, model lists, `downloadModel`, the `node-llama-cpp` native
addon, and the Electron binary/packaging friction that dominated #795's review.

---

## 5. Design overview

```
                       ┌──────────────────────────────────┐
                       │ durable-insight-core (host-free) │
                       │  data access · schema · safety   │
                       │   configCore · destinationTest   │
                       └──────────────────────────────────┘
                                ▲        ▲       ▲
                ┌───────────────┘        │       └────────────────┐
     ┌──────────┴──────────┐  ┌──────────┴──────────┐  ┌──────────┴──────────┐
     │  …-insight-vscode   │  │  …-insight-desktop  │  │ durable-insight-mcp │
     │   (existing name)   │  │   (existing name)   │  │        (NEW)        │
     │    extension.ts     │  │    main/host.ts     │  │      server.ts      │
     │    + webview UI     │  │     + Electron      │  │    stdio, no UI     │
     │      LLM: ours      │  │      LLM: ours      │  │   LLM: the agent    │
     └─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

**Naming:** the two new packages take the `durable-insight-*` stem. The two existing
hosts keep their current `aws-durable-execution-sdk-js-insight-*` names for now;
renaming them (and the settings namespace and display name) is deferred to separate
work — see §15 note on naming.

Three deliberate choices:

**5.1 The MCP server is a host, not a feature.** It sits where `extension.ts` and
`main.ts` sit. It owns transport, config, and tool registration, and nothing else.

**5.2 Capability and expertise are separate layers.** MCP gives the agent reach;
the skill gives it competence. Shipping tools without schema guidance produces an
agent that writes plausible-but-wrong queries against 8 subtly different backends
and blames our tool. Both are required; see §6.6.

**5.3 The agent is the model.** No provider config, no prompt engineering, no
agentic loop of our own. `queryMode` (`query`/`ask`/`agent`) collapses: every MCP
interaction is what the extension calls _agent_ mode, with the client's model
driving.

---

## 6. Detailed design

### 6.1 New package

```
packages/durable-insight-mcp/
├── package.json          # @aws/durable-insight-mcp, bin: durable-insight-mcp
├── src/
│   ├── server.ts         # MCP server, transport, registration
│   ├── tools/            # one module per tool
│   ├── config.ts         # env → InsightConfig (via configCore)
│   ├── envKeys.ts        # SETTING_KEYS ↔ env var mapping
│   └── skill/SKILL.md    # published skill (§6.6)
└── README.md
```

`workspaces: ["packages/*"]` picks it up with no root change.

**Four names, deliberately distinct:**

| Layer                         | Value                          |
| ----------------------------- | ------------------------------ |
| Directory                     | `packages/durable-insight-mcp` |
| npm package                   | `@aws/durable-insight-mcp`     |
| `bin`                         | `durable-insight-mcp`          |
| Server key in customer config | `durable-insight`              |

The server key is the customer's choice but the README should suggest
`durable-insight`: prefixed tool names are capped at 64 characters, and
`durable-insight/test_destination` is 32.

**This host must be published, unlike its siblings.** The repo's convention splits
on publishability, not on package kind:

| Kind      | Convention                       | Examples                                                                 |
| --------- | -------------------------------- | ------------------------------------------------------------------------ |
| Published | `@aws/`-scoped, `private: false` | `@aws/durable-execution-sdk-js`, `@aws/durable-execution-sdk-js-insight` |
| Hosts     | unscoped, `private: true`        | `-insight-vscode`, `-insight-desktop`                                    |

Both existing hosts are private because they ship as a VSIX and an app. This one
ships through npm — `npx -y @aws/durable-insight-mcp` cannot resolve anything
else — so it is the first host needing `@aws/` scope and `private: false`. Version
starts at `0.1.0-alpha.0` to match the insight family.

### 6.2 Prerequisite: extract `durable-insight-core`

The desktop host currently reaches the shared core by relative path with **no
declared dependency**:

```ts
from "../../aws-durable-execution-sdk-js-insight-vscode/src/explorerSession"
```

Tolerable at two hosts. At three it becomes an MCP package importing across two
sibling packages to reach code that lives, misleadingly, inside the _VS Code_
package.

Extract `packages/durable-insight-core` containing every host-free module in §4 (data access, schema, safety, `destinationTest`,
`configCore`, `hostPort`, `hostCapabilities`, `settingsKeys`). Mostly `git mv` plus
import rewrites, guarded by the existing test suites (222 in `-insight-vscode`,
36 in `-insight-desktop`).

Do this **before** the MCP work. Doing it after means rewriting three hosts'
imports instead of two.

> This is the only part of the project that touches VS Code and Electron code. It is
> a no-behavior-change refactor, but it is not zero-risk, and it should be its own
> reviewable PR.

### 6.3 What happens to `explorerSession.ts`

`ExplorerSession` (1,639 lines) is host-free but _shaped for a UI_: it dispatches
`{type}` messages and pushes results back via `HostPort.post`. Its ~17 message
types split cleanly:

| Extension message                              | MCP fate                            |
| ---------------------------------------------- | ----------------------------------- |
| `fetchDetail`                                  | → `get_execution` tool              |
| `testDestination`                              | → `test_destination` tool           |
| `generate`                                     | dropped — the agent generates       |
| `visualize`, `exportChart`                     | dropped — no charts (§9)            |
| `listModels`, `downloadModel`                  | dropped — no model management       |
| `setMode`, `newSession`, `ready`, `setConsent` | dropped — no UI session             |
| `saveSettings`                                 | dropped — config is env-only (§6.4) |
| `saveFavorite`, `deleteFavorite`               | dropped in v1 — no favorites        |
| `exportData`                                   | dropped — the agent has the data    |
| `startListening`, `stopListening`              | deferred (§11 Phase 6)              |

**Decision: the MCP host does not use `ExplorerSession`.** Only 2 of 17 messages
survive, and both are thin wrappers over functions the session itself calls. Tools
should call the core directly (`fetchAthenaRecord`, `runAthenaQuery`,
`destinationTest`). Routing request/response tools through a stateful,
push-oriented session would be adapting to an interface neither side wants.

`ExplorerSession` stays where it is, shared by the two UI hosts. This is a deliberate
divergence from the #795 pattern, **ratified in design review** — the two hosts that
render a UI keep the session; the one that answers an agent does not. AC-T4 guards the
facts they must continue to share.

### 6.4 Configuration

Env vars only — no settings file, no mutable config. MCP passes `env` natively,
which is why this host is easier to configure than either existing one.

**Convention:** `DURABLE_INSIGHT_` + `SCREAMING_SNAKE(settingKey)`.
`athenaDatabase` → `DURABLE_INSIGHT_ATHENA_DATABASE`. Mechanical, so it is
testable (§11 AC-T3), and one settings table can document all three hosts.

> **Known, accepted divergence.** The VS Code settings namespace stays
> `workflowInsight.*` until the deferred rename lands, so this host's env prefix
> (`DURABLE_INSIGHT_`) and the extension's setting prefix name the same product two
> ways. Only the prefix differs — key derivation is identical, so one settings table
> still documents all three hosts and AC-T3 is unaffected. Call it out in the README
> rather than papering over it.

The 8 LLM/consent keys are **not accepted** by this host: `llmProvider`,
`bedrockModelId`, `localModel`, `localServerUrl`, `localServerModel`,
`agenticMaxIterations`, `queryMode`, `aiDisclosureAcceptedVersion`.

Existing defaults from `DEFAULT_SETTINGS` apply unchanged, so a typical customer
sets **two to four** values:

| Destination                          | Required                                                      |
| ------------------------------------ | ------------------------------------------------------------- |
| `cloudwatch-logs-exporter` (default) | `logGroupName`                                                |
| `dynamodb`                           | `dynamodbTableName`                                           |
| `athena` / `s3`                      | `athenaDatabase` + workgroup or `athenaOutputLocation`        |
| `opensearch`                         | `opensearchEndpoint`                                          |
| `aurora`                             | `auroraResourceArn`, `auroraSecretArn`                        |
| `redshift`                           | workgroup or cluster + `redshiftSecretArn` / `redshiftDbUser` |
| `sqs`                                | `sqsQueueUrl`                                                 |

Defaulted: `region: us-east-1`, `athenaTable: workflow_insight`,
`auroraDatabase: postgres`, `opensearchIndex: workflow-insight`, and the rest.

**Credentials need no configuration.** `resolveCredentials(profile?)` is four
lines — `fromIni({profile})` or `fromNodeProviderChain()` — so env credentials,
`~/.aws/credentials`, and SSO all work already.

Customer-facing config, identical in shape across clients:

```json
{
  "mcpServers": {
    "durable-insight": {
      "command": "npx",
      "args": ["-y", "@aws/durable-insight-mcp"],
      "env": {
        "AWS_REGION": "us-east-1",
        "AWS_PROFILE": "prod",
        "DURABLE_INSIGHT_DESTINATION_TYPE": "dynamodb",
        "DURABLE_INSIGHT_DYNAMODB_TABLE_NAME": "workflow-insight"
      }
    }
  }
}
```

All three target clients accept that same `mcpServers` shape; only the file location
differs (verified against client documentation, T0.3):

| Client          | Project / workspace scope | User / global scope         |
| --------------- | ------------------------- | --------------------------- |
| **Kiro**        | `.kiro/settings/mcp.json` | `~/.kiro/settings/mcp.json` |
| **Claude Code** | `.mcp.json` (repo root)   | `~/.claude.json`            |
| **Cursor**      | `.cursor/mcp.json`        | `~/.cursor/mcp.json`        |

Workspace scope takes precedence in each. The README should **lead with the CLI
helpers** (`kiro-cli mcp add`, `claude mcp add`) and present the JSON as reference:
paths move between client versions, the `mcpServers` shape does not.

Note that every client's project scope is a committed file, so adding the server there
shares it with the whole team. Cleared by Legal (§8), but worth one README line so the
behavior is not a surprise.

### 6.5 Tool surface

Few, well-described tools plus schema discovery. Constraints observed from client
documentation: tool names must match `^[a-zA-Z][a-zA-Z0-9_]*$` and stay under 64
characters _including_ the server prefix; tool _descriptions_ over ~10,000
characters degrade agent performance. So bulk schema content belongs in tool
**results** and the skill, never in a description.

| Tool               | Parameters                                               | Returns                                                | Backed by                         |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------ | --------------------------------- |
| `test_destination` | —                                                        | connectivity, record count, most recent record         | `destinationTest.ts` (411)        |
| `describe_schema`  | —                                                        | destination type, record schema, query idioms, dialect | `schema.ts`                       |
| `list_executions`  | `status?`, `since?`, `until?`, `functionName?`, `limit?` | execution summaries                                    | engine runners                    |
| `get_execution`    | `executionId`                                            | full record incl. operations                           | `fetchAthenaRecord` + equivalents |
| `query`            | `query`, `limit?`                                        | rows + column names                                    | engine runners + safety layer     |

`list_executions` exists so the common case needs no SQL at all — cheaper in
tokens and impossible to get wrong. `query` is the escape hatch for anything else.

**Every tool result must be structured JSON**, not prose. The agent formats for
the user; our job is facts.

### 6.6 Skill delivery — three layers

Increasing polish, decreasing portability. Ship all three.

1. **`describe_schema` as a tool.** Works in every MCP client, zero extra setup.
   The floor, and the only layer we can guarantee.
2. **MCP prompts.** MCP servers can publish prompts; clients surface them (Kiro
   lists them under `/prompts` and `@name`). Ships _inside_ the server, so the
   customer installs nothing extra.
3. **A published `SKILL.md`.** For clients with skill support. Kiro loads these via
   `skill://.kiro/skills/**/SKILL.md` in an agent's `resources`, requiring YAML
   frontmatter with `name` and `description`; metadata loads at startup and full
   content only on demand — the best token economy for content this size.

**Source of truth.** `schema.ts:buildSystemPrompt(destinationType, options)` (a
~130-line builder over 8 destinations) already emits exactly this material for our
own prompts. Measured in Phase 3: **3,414 characters for DynamoDB and 10,143 for
Athena/s3** — the latter alone exceeds the 10,000-character description limit, which
settles empirically that this content belongs in tool _results_ and the skill, never in
a description. It covers: which destinations expose `operationsByName` as a dot-path-queryable
map versus a stringified field, how to reach operations by name via a JSONB
predicate on Aurora, PartiQL path syntax on DynamoDB. Layers 1–3 must all derive
from it, not restate it (§10, AC-T4). Retargeting is editing, not authoring.

### 6.7 Safety model

`assertReadOnly(query, engine)` (`queryValidator.ts:93`) and
`ensureLimit(query, max = 1000)` (`schema.ts:748`) currently guard SQL produced by
_our own_ prompt. Here they guard SQL from a model we do not control, invoked in a
loop, on behalf of a user who may approve without reading.

They move from a safety net to **the** security boundary of the host, and become
the highest-value test target in the package.

> **Structural hazard, verified in Phase 3.** `assertReadOnly` and `ensureLimit` are
> called _only_ inside `explorerSession.ts` — never inside the engine runners. Since
> this host deliberately bypasses `ExplorerSession` (§6.3), `runAthenaQuery` and
> `runDynamoDBQuery` are reachable with **no read-only enforcement at all**; nothing in
> core would stop a `DELETE`. The mitigation is deliberately not a call at each site,
> which is the pattern that let it be forgotten: `runReadOnlyQuery` is the single choke
> point, and a test mechanically asserts no other non-test file in the package imports a
> runner. **Follow-up worth considering for core:** push enforcement into the runners
> themselves, default-on, with an explicit opt-out for the one legitimate DDL caller
> (`ensureAthenaTable`, which executes `CREATE EXTERNAL TABLE` through
> `runAthenaQuery`). That would protect every future consumer, but it touches the
> extension's table-creation path and deserves its own PR.

- Every engine path routes through `assertReadOnly` before execution — no
  exceptions, enforced by test (§10, AC-T2).
- Every result set is bounded by `ensureLimit`; unbounded queries are a token-cost
  denial-of-service as much as a data risk.
- **CloudWatch Logs Insights is a deliberate exception, verified in Phase 4.**
  `assertReadOnly` must NOT be applied to it: Logs Insights is a pipe language
  (`fields @timestamp | filter … | stats …`), so a `SELECT`/`WITH` prefix check would
  reject _every valid query_. Read-only is guaranteed by the API surface instead — the
  language has no write forms and `StartQuery` can only read — so its absence removes
  no protection, and `explorerSession.ts` draws the same line. Because "add the guard
  here too, for consistency" is a plausible future change, the test is **inverted**: it
  asserts valid pipe queries are _accepted_. Adding `assertReadOnly` there fails 22
  tests.
  `ensureLimit` is correspondingly right here and wrong everywhere else, and the
  **escaping differs**: Logs Insights literals are double-quoted, so core's
  `escapeQuotedString` (backslashes first, then quotes) is required — the SQL
  quote-doubling escaper would leave the trailing-backslash breakout CodeQL flags.
- **Row bounding is per engine.** Athena stops paging at `maxRows`; DynamoDB issues one
  non-paginating statement; Aurora, Redshift and OpenSearch do **not** cap at all
  (Redshift pages every `NextToken`), so the MCP layer slices to `MAX_ROWS`.
- **`sandbox.ts:runSandboxedJs` is NOT exposed as a tool in v1.** Arbitrary
  agent-authored JS execution is a different risk class from a bounded read-only
  query, and the agent already has its own code execution. Revisit only with an
  explicit security review.

---

## 7. Customer experience

Setup is §6.4's four lines. `npx -y` fetches on first run, so there is no install
step. Then:

**Verify:**

> "Is my workflow insight connection working?"
> → `test_destination` → _"Connected to DynamoDB table `workflow-insight` in
> us-east-1. 1,284 records, most recent 4 minutes ago."_

A better failure story than the extension's: when it breaks, the agent reads the
error and suggests the fix.

**Investigate:**

> "Why did the order-processing workflow fail last night?"
> → `describe_schema` → `query` →
> _"Three executions failed between 02:14 and 02:31, all on the `charge-payment`
> step with a Stripe timeout. The retry strategy gave up after 3 attempts."_

**Then the part the extension cannot do:**

> "Show me the input payloads for those three."
> → `get_execution` ×3 — just the next turn.

---

## 8. Disclosure: README only, no consent gate

**Settled: this host needs disclosure, not consent. Legal has confirmed the position
in §8.3. Nothing here gates shipping; what remains is implementing §8.2 in the
README.**

### 8.1 Why no consent mechanism

The extension's disclosure exists because the extension _itself_ routes user data
to a provider _it_ selected — Bedrock, Copilot, a local server, on-device — and
`aiDisclosureAcceptedVersion` records acceptance of that specific set.

Neither half of that is true here.

**We make no model calls.** Verified by inspection across every module this host
would use — `athena`, `dynamodb`, `aurora`, `redshift`, `opensearch`,
`logsInsights`, `sqs`, `destinationTest`, `schema`, `queryValidator`: not one
Bedrock, Anthropic, OpenAI, or `vscode.lm` call among them. The 1,677 lines that
did talk to providers (§4) are exactly the lines this host drops. The server is
stdio in, JSON out, on the user's own machine.

**We select no provider.** There is no provider choice to disclose, because there
is none to make. Whatever reaches a model does so under the agent's terms, which
the user accepted when they chose that agent and pointed it at their source code.
We are not a party to that flow.

**Installation is the opt-in.** Unlike an extension or an app, nobody encounters
this host incidentally. Using it requires writing a config block that names our
package into the agent you already chose — a more deliberate act than accepting a
modal. There is no drive-by user to protect.

### 8.2 What the README must say

Disclosure still matters, and it should be specific rather than perfunctory,
because of one fact that is easy to miss:

**Execution records carry `input` and `output` payloads and we return them
verbatim.** Our own schema guidance uses `customerName` and `claimType` as the
example fields to extract (`schema.ts:474`). So "query my workflow data"
concretely means production payloads — whatever the workflow processes — entering
the agent's context and therefore its model.

Someone reading a README about workflow observability will not necessarily connect
those. The README section must therefore state:

- Which tools return payload data, and that `input`/`output` are returned as
  stored, not redacted or summarized.
- That the data goes to the agent that asked, and from there wherever that agent's
  configuration sends it — determined by the customer, not by us.
- That this server makes no model calls of its own.
- That `query` is read-only and cannot modify the customer's data (§6.7).

No acceptance step, no env var, no version. G5 (§3) is preserved: setup stays two
to four values.

### 8.3 Legal confirmation (received)

Legal confirmed the following position. Record the thread reference here for future
readers:

> This host makes no model provider calls and selects no provider. Installation
> into a customer-chosen agent is the opt-in. We plan specific README disclosure —
> including that execution input/output payloads are returned verbatim — and no
> consent gate or version tracking. Confirm?

Confirmed. §8.2 is therefore the whole of the obligation: specific README disclosure,
no acceptance step, no version tracking. §8.4 records the rejected alternative in case
the question is reopened.

### 8.4 Rejected: an env-var consent gate

For the record, since it is the obvious alternative. The server could refuse to
serve until `DURABLE_INSIGHT_AI_DISCLOSURE_ACCEPTED=<version>` matched
`AI_DISCLOSURE_VERSION` — affirmative, recorded, versioned, fails closed.

Rejected because it protects against nothing here (§8.1), adds a required setup
step against G5, and records the _operator's_ acceptance rather than each user's —
so it would give the appearance of consent without the substance. A shared
workspace config (Kiro reads `.kiro/settings/mcp.json`, which teams commit) would
propagate one person's acceptance to everyone, which is true of any committed MCP
server and is mitigated by client-side tool approval. Not a reason to build a gate.

Also considered and unsuitable as notice channels: MCP's `instructions` field on
`InitializeResult` is model-facing by specification ("a hint to the model") and
inconsistently consumed by clients; tool descriptions likewise reach the model, not
the user.

---

## 9. What we give up

**Charts and the interactive result grid.** `chartSpec.ts` (238 lines) has no home
in a text protocol, and there is no sortable, clickable grid.

Smaller than it sounds: an agent can render a markdown table from `query` results,
which Claude Code and Kiro both display. What is genuinely lost is
_interactivity_ — sorting, paging, click-through.

Charts are not strictly impossible: MCP tool results can carry image content, so a
server-side render is conceivable. Not free — `chartSpec.ts` emits a spec, not an
image, so a renderer would be needed, and client support varies. Out of scope for
v1; revisit on demand.

**This is the argument for adding a host rather than replacing one.** Customers who
want charts keep the extension. Both hosts run against the same destination with
the same handful of config values.

---

## 10. Alternatives considered

| Alternative                                  | Why not                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Skill only, no MCP**                       | A skill cannot reach Athena. It could teach the agent to shell out to `aws athena start-query-execution`, but then read-only enforcement, schema knowledge, and result shaping all live in prose the model may ignore. Capability needs code.          |
| **MCP only, no skill**                       | The likely failure mode: the agent writes plausible-but-wrong queries across 8 subtly different schemas and the customer concludes the tool is broken. `schema.ts` exists precisely because a model needs this material. Skipping it wastes the asset. |
| **Extend an existing AWS MCP server**        | Workflow Insight's value is the destination abstraction and record schema, which is ours, not generic AWS. A generic server would need all of `schema.ts` anyway. Revisit for distribution reach later.                                                |
| **A CLI the agent shells out to**            | Works everywhere, no protocol. But loses typed tool schemas, structured results, and the client's approval UX; every agent re-learns argument parsing from `--help`. MCP exists for this.                                                              |
| **"Copy for agent" export in the extension** | Cheap, and helps nobody who does not already run the extension — which is the actual complaint.                                                                                                                                                        |
| **Reuse `ExplorerSession` for MCP**          | Only 2 of 17 messages survive; see §6.3. Adapting request/response tools to a push-oriented session serves neither.                                                                                                                                    |

---

## 11. Task breakdown

Sizes are relative estimates (S ≈ under a day, M ≈ a few days, L ≈ a week or more)
and should be re-estimated by whoever picks the work up.

### Phase 0 — Unblock (no code)

| ID       | Task                                                                 | Size | Depends |
| -------- | -------------------------------------------------------------------- | ---- | ------- |
| **T0.1** | ~~Send §8.3 to Legal~~ — **done, confirmed**                         | S    | —       |
| **T0.2** | ~~Decide §6.3~~ — **done, ratified: MCP bypasses `ExplorerSession`** | S    | —       |
| **T0.3** | ~~Confirm client MCP config paths~~ — **done, see §6.4 table**       | S    | —       |

**AC:** All met. §8 confirmed by Legal; §6.3 ratified (MCP bypasses `ExplorerSession`);
client config paths verified against documentation (§6.4). **Phase 0 complete — Phase 1
is unblocked.**

### Phase 1 — Extract the core (L) — **MERGED** (#809)

| ID       | Task                                                                                                                                | Size | Depends |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| **T1.1** | Create `durable-insight-core`; move host-free modules (§4)                                                                          | M    | T0.2    |
| **T1.2** | Repoint `-insight-vscode` and `-insight-desktop` imports; declare real dependencies                                                 | M    | T1.1    |
| **T1.3** | Move the relevant tests of the 19 in `-insight-vscode/src`; extend `hostAgnostic.test.ts` to the new boundary                       | S    | T1.2    |
| **T1.4** | Add `durable-insight-core` to root `test` and `typecheck:hosts` and the `insight-hosts` CI job (NOT `build` — it has no build step) | S    | T1.1    |

**AC:**

- **AC-1.1** All existing tests pass unchanged in count and name: **222**
  (`-insight-vscode`) and **36** (`-insight-desktop`), redistributed but not
  reduced.
- **AC-1.2** No `../../aws-durable-execution-sdk-js-insight-*` relative import
  remains in any package; every cross-package import resolves through a declared
  dependency.
- **AC-1.3** `hostAgnostic.test.ts` still fails if a `vscode` import is introduced
  anywhere in the core — verified by deliberately adding one, not by observing
  green.
- **AC-1.4** Zero behavior change: both bundles build, and the VS Code extension
  and desktop app launch and run a query.

### Phase 2 — Server skeleton (M) — **DONE** (this change)

| ID       | Task                                                                                       | Size | Depends |
| -------- | ------------------------------------------------------------------------------------------ | ---- | ------- |
| **T2.1** | Package scaffold, `bin`, stdio transport, MCP handshake                                    | S    | T1.4    |
| **T2.2** | `envKeys.ts`: `SETTING_KEYS` ↔ env mapping; reject the 8 LLM/consent keys                  | S    | T2.1    |
| **T2.3** | Config assembly through `configCore.normalizeConfig`; credentials via `resolveCredentials` | S    | T2.2    |
| **T2.4** | `test_destination` tool over `destinationTest.ts`                                          | S    | T2.3    |

**AC:**

- **AC-2.1** Server starts under `npx`, completes an MCP handshake, and lists its
  tools in at least one real client (Kiro or Claude Code).
- **AC-2.2** `test_destination` reports success against a live destination and, on
  misconfiguration, returns an error naming the missing env var.
- **AC-2.3** ~~A missing required key fails at startup~~ **Revised during Phase 2.**
  Missing config must NOT prevent startup: a server that refuses to start appears in
  an MCP client as an unexplained failure, whereas one that starts can tell the agent
  exactly what is wrong. Instead `test_destination` returns the precise unset
  `DURABLE_INSIGHT_*` variable names with no network call, and no tool will query with
  incomplete config — so the "silent default querying the wrong table" concern is still
  covered.
- **AC-T3** _(contract test)_ Every `SETTING_KEY` except the 8 excluded maps to
  exactly one env var and round-trips; the 8 excluded are rejected if set.
  Mirrors `settingsKeys.test.ts`.

### Phase 3 — Query core, two destinations (M) — **DONE** (this change)

| ID       | Task                                                                    | Size | Depends |
| -------- | ----------------------------------------------------------------------- | ---- | ------- |
| **T3.1** | `describe_schema` derived from `buildSystemPrompt`                      | M    | T2.4    |
| **T3.2** | `query` for Athena + DynamoDB, through `assertReadOnly` + `ensureLimit` | M    | T2.4    |
| **T3.3** | `get_execution` for both                                                | S    | T3.2    |
| **T3.4** | `list_executions` (no SQL required)                                     | M    | T3.2    |

**AC:**

- **AC-3.1** An agent given only the tools answers "why did X fail last night?"
  against a seeded dataset, and correctly follows up with the failing step's input.
- **AC-3.2** Results are structured JSON; no tool returns prose.
- **AC-3.3** No tool _description_ exceeds 10,000 characters.
- **AC-T2** _(security test)_ Every mutating statement form — `INSERT`, `UPDATE`,
  `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `GRANT`, multi-statement,
  comment-obfuscated — is rejected for **every** engine. Additionally: removing the
  `assertReadOnly` call from any engine path must fail a test (mutation-verified,
  not assumed).
- **AC-T2b** Every result path bounds rows; an unbounded query cannot be issued.
  **Mechanism corrected in Phase 3:** not `ensureLimit`, which emits `" | limit N"` —
  CloudWatch Logs Insights syntax that is a syntax error appended to Trino or PartiQL.
  The SQL bound is Athena's `maxRows` pagination cap (`GetQueryResults` otherwise pages
  the entire result set into the process), with DynamoDB page-bounded by a single
  `ExecuteStatement`.

### Phase 4 — Remaining destinations (M) — **DONE** (this change)

| ID       | Task                                                                                                                    | Size | Depends |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| **T4.1** | Aurora, Redshift, OpenSearch, and the two CloudWatch Logs destinations (S3 landed in Phase 3; SQS is **not queryable**) | M    | T3.4    |

**AC:** **AC-4.1** All 8 `DestinationType` values are handled — **7 queryable**, each
with `describe_schema` output matching its real dialect, plus `sqs` explicitly refused.
`assertReadOnly` coverage per AC-T2 holds for the **five SQL engines**; the two
CloudWatch Logs destinations are the documented exception below.

### Phase 5 — Skill delivery (M) — **DONE** (this change)

| ID       | Task                                                                | Size | Depends |
| -------- | ------------------------------------------------------------------- | ---- | ------- |
| **T5.1** | Expose MCP prompts from the server                                  | S    | T3.1    |
| **T5.2** | Author `SKILL.md` with YAML frontmatter, generated from `schema.ts` | M    | T3.1    |
| **T5.3** | README: install per client, config table, destination matrix        | M    | T0.3    |

**AC:**

- **AC-5.1** Prompts appear in a real client's prompt list.
- **AC-5.2** `SKILL.md` loads in Kiro via `skill://` and its frontmatter
  `description` is specific enough to trigger on a relevant question.
- **AC-T4** _(anti-drift test)_ **Strengthened in Phase 5.** Rather than deriving schema
  facts and testing for drift, the skill and prompts contain **zero**
  destination-specific schema facts and delegate to `describe_schema`, which makes drift
  impossible rather than merely detectable — and avoids loading Athena's 10,143
  characters for a DynamoDB user. `skillDrift.test.ts` asserts a list of schema-owned
  tokens appears nowhere in the skill or prompts, **and first asserts each token really
  occurs in some destination's `buildSystemPrompt` output** so the guard cannot pass
  vacuously. That check immediately caught a candidate token (`executionarn`) that
  appears in no prompt output at all.
- **AC-5.3** A new user reaches a successful `test_destination` from the README
  alone, unaided.

### Phase 6 — Deferred

| ID       | Task                      | Notes                                                                |
| -------- | ------------------------- | -------------------------------------------------------------------- |
| **T6.1** | `tail` / live following   | MCP is request/response; needs a polling-tool or notification design |
| **T6.2** | Charts as rendered images | Requires a renderer; client support varies (§9)                      |
| **T6.3** | Favorites / saved queries | Needs writable state, which §6.4 excludes by design                  |

---

## 12. Definition of done (v1)

- **D1** `npx @aws/durable-insight-mcp` works in Kiro and Claude Code with only a
  config block — no install, no build.
- **D2** All 8 destinations queryable read-only, verified per AC-T2.
- **D3** Agent answers a realistic multi-turn failure investigation end to end
  (AC-3.1).
- **D4** Zero regression in the VS Code and Electron hosts (AC-1.4).
- **D5** No duplicated core logic — one copy, three consumers (AC-1.2, AC-T4).
- **D6** README carries the §8.2 disclosure, including that `input`/`output`
  payloads are returned verbatim. (Legal confirmation: received, §8.3.)
- **D7** CI covers the new package: typecheck, tests, and the `hostAgnostic`
  boundary.

---

## 13. Testing strategy

Follows this repo's existing norms — `npm test` chains every workspace,
`typecheck:hosts` gates the host packages, and the `insight-hosts` CI job bundles
them.

**Invariants worth a dedicated contract test**, in the style of the existing
`settingsKeys.test.ts` and `hostCapabilitiesContract.test.ts`:

| Test                              | Guards                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `hostAgnostic.test.ts` (extended) | Core stays `vscode`-free with a third consumer            |
| `envKeys.test.ts` (new)           | Env ↔ `SETTING_KEYS` parity, and the 8 exclusions (AC-T3) |
| `readOnly.test.ts` (new)          | Every engine path enforces `assertReadOnly` (AC-T2)       |
| `skillDrift.test.ts` (new)        | Skill/prompt schema facts derive from `schema.ts` (AC-T4) |

**Mutation-verify each guard.** #795 produced two tests that passed for the wrong
reason and could not fail; both were caught only by deliberately breaking the code
they claimed to protect. Every AC above marked _mutation-verified_ means exactly
that: break the thing, watch the test fail, restore. A green suite is not evidence
that a test works.

Phases 1–2 justified the rule twice over:

- **stdout purity is not proven by a working session.** stdout is the MCP transport, so
  a stray `console.log` corrupts it — yet adding one did **not** fail an end-to-end
  session test. The SDK client catches per-line parse errors, reports them to an unset
  handler, and continues, so the handshake completes and the bad line is skipped. Only
  a direct assertion that the spawned binary emits nothing on stdout catches it. Any
  future stdio server test must assert this explicitly.
- **The plan's redshift requirements were wrong.** This document asserted
  `redshiftSecretArn` was required; `destinationTest.ts` does not require it (IAM with
  a db user is a valid alternative) and wants a workgroup _or_ a cluster identifier.
  The code was right. `missingRequiredEnvVars` follows the code, not this document.

Review of #809 added two more, both of which apply directly to the phases still
unmerged:

- **A gate that only runs pre-commit is not a gate.** The boundary rules existed as
  eslint config but eslint ran only through lint-staged, which `--no-verify` bypasses,
  and there was no lint job. `npm run lint` is now a step in the `insight-hosts` job.
  When adding a rule, ask which CI job executes it.
- **`workflow_dispatch`-only workflows are invisible to PR checks.** The extraction broke
  the VSIX release workflow — it copies one package out of the workspace and runs
  `npm install --no-workspaces`, which cannot resolve a private dependency — and every
  check stayed green because no pull request runs that workflow. The same class then
  turned out to affect the MCP package more severely: it is **published**, so a private
  dependency would have failed `npx` for every customer. Both now have a
  `packaging.test.ts` asserting the invariant offline, since the real path cannot run on
  a PR. Any package this project publishes needs that check before it ships.

---

## 14. Risks

| Risk                                                         | Severity | Mitigation                                                                         |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------- |
| ~~Legal requires a consent mechanism~~                       | —        | **Resolved** — §8 position confirmed (§8.3)                                        |
| Core extraction destabilizes two shipping hosts              | Medium   | Own PR, AC-1.1/1.4, existing 258 tests as the net                                  |
| Agent writes wrong queries despite the skill                 | Medium   | `list_executions` covers the common case without SQL; iterate on `describe_schema` |
| Bypassing `ExplorerSession` (§6.3) diverges hosts and drifts | Low      | **Ratified** in review; AC-T4 guards shared facts                                  |
| Token cost of large schema output                            | Low-Med  | Layer 3 skill loads on demand; keep descriptions small (AC-3.3)                    |
| Client fragmentation (paths, prompt/skill support)           | Low      | T0.3 verifies; layer 1 works everywhere                                            |

---

## 15. Open questions

- ~~**OQ1** Legal confirmation of §8.3.~~ **Resolved** — confirmed; see §8.3.
- ~~**OQ2** Ratify §6.3 — MCP bypasses `ExplorerSession`.~~ **Resolved** — ratified;
  Phase 1 unblocked.
- ~~**OQ3** Publish `durable-insight-core`, or bundle it?~~ **Resolved — bundle.** Both
  existing hosts already bundle with esbuild, so core stays `private: true` and remains
  an internal boundary refactorable without semver obligations. Publishing it would be
  _forced_ only if a public package depended on it directly.
- **OQ4** Does `list_executions` need pagination in v1, or is `limit` + a
  `since`/`until` window enough?
- **OQ5** Should `describe_schema` be an MCP _resource_ rather than a tool? More
  idiomatic; less uniformly supported.
- **OQ6** Is one customer's feedback enough to fund Phases 1–5, or should a Phase
  2–3 prototype gather more signal first?

---

### Note on naming (decided, deferred)

New packages use `durable-insight-*`. Renaming the existing ones is **out of scope
here** and tracked separately, because package names are only one of four layers and
the other three have costs this project should not absorb:

| Layer                | Current                                                 | Cost of renaming                                                        |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Package + directory  | `aws-durable-execution-sdk-js-insight-{vscode,desktop}` | Mechanical                                                              |
| VS Code extension ID | `aws.aws-durable-execution-sdk-js-insight-vscode`       | Cheap now (`private: true`, alpha); needs a reinstall once published    |
| Settings namespace   | `workflowInsight.*` — 33 keys, 133 refs / 22 files      | User-visible; silent break for existing alpha users without a migration |
| Display name         | "Workflow Insight" — 124 refs / 34 files                | Includes the Legal-approved disclosure header (`AiConsentModal.tsx`)    |

Two things to carry into that work. The display name appears in Legal-approved
disclosure copy, so a rename should ride along with an existing Legal thread rather
than start a new one; by the `types.ts` test it should **not** need an
`AI_DISCLOSURE_VERSION` bump, since a product name changes neither the providers
named nor where data goes. And the published `@aws/durable-execution-sdk-js-insight`
library would need a new name published plus the old deprecated — a different class
of decision from renaming private packages.

## 16. Recommended next step

A prototype limited to `test_destination`, `describe_schema`, and `query` against a
single destination — deliberately skipping the Phase 1 extraction by importing
across packages the way `-insight-desktop` does today.

That is throwaway code and should be labelled as such, but it answers OQ6 and gives
the customer something to react to quickly. Nothing in Phases 1–5 depends on it, and
with §8 settled nothing gates it.
