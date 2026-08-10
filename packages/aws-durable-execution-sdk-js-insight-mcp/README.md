# Workflow Insight — MCP Server

Query the execution history that AWS Lambda durable functions emit, from any MCP
client, over stdio.

This package is a **host adapter, not a second product**. It exposes the same
read-only query capability the VS Code extension and desktop app provide —
destination resolution, query engines, read-only enforcement — but through the
[Model Context Protocol](https://modelcontextprotocol.io) instead of a UI. The
engine runners, the `assertReadOnly` validator, and the per-destination schema
guidance all come from `durable-insight-core`; nothing is forked here, so the
hosts cannot drift.

Concretely, this server is **stdio in, JSON out, on your machine**. It reads a
query request from the agent driving it, runs it against the one destination it
was configured for, and returns machine-readable JSON. It makes no model calls
of its own (see [Data handling and AI disclosure](#data-handling-and-ai-disclosure)).

## Install

The package is published; you never clone or build it. Every client launches it
the same way — `npx -y @aws/durable-execution-sdk-js-insight-mcp` — and every client takes the
same `mcpServers` JSON shape. Only the file the config lives in differs.

**Lead with the CLI helper for your client.** The config-file paths below move
between client versions; the server shape does not, so a helper that writes the
file for you is the durable instruction.

### Kiro

```bash
kiro-cli mcp add \
  --name durable-insight \
  --command npx \
  --args "-y,@aws/durable-execution-sdk-js-insight-mcp" \
  --env DURABLE_INSIGHT_DESTINATION_TYPE=dynamodb \
  --env DURABLE_INSIGHT_DYNAMODB_TABLE_NAME=my-workflow-table \
  --env DURABLE_INSIGHT_REGION=us-east-1 \
  --scope workspace
```

`--scope workspace` writes `.kiro/settings/mcp.json`; omit it (or use
`--scope global`) to write `~/.kiro/settings/mcp.json`. Workspace scope wins when
both are present.

### Claude Code

```bash
claude mcp add durable-insight \
  --scope project \
  --env DURABLE_INSIGHT_DESTINATION_TYPE=dynamodb \
  --env DURABLE_INSIGHT_DYNAMODB_TABLE_NAME=my-workflow-table \
  --env DURABLE_INSIGHT_REGION=us-east-1 \
  -- npx -y @aws/durable-execution-sdk-js-insight-mcp
```

`--scope project` writes `.mcp.json` at the repo root; the default (user) scope
writes `~/.claude.json`. Project scope wins when both are present.

### JSON reference (all clients)

If you prefer to edit the file directly, or your client has no helper, add this
block. The shape is identical everywhere:

```json
{
  "mcpServers": {
    "durable-insight": {
      "command": "npx",
      "args": ["-y", "@aws/durable-execution-sdk-js-insight-mcp"],
      "env": {
        "DURABLE_INSIGHT_DESTINATION_TYPE": "dynamodb",
        "DURABLE_INSIGHT_DYNAMODB_TABLE_NAME": "my-workflow-table",
        "DURABLE_INSIGHT_REGION": "us-east-1"
      }
    }
  }
}
```

Where that block lives, per client:

| Client      | Project scope (wins)      | User scope                  |
| ----------- | ------------------------- | --------------------------- |
| Kiro        | `.kiro/settings/mcp.json` | `~/.kiro/settings/mcp.json` |
| Claude Code | `.mcp.json` (repo root)   | `~/.claude.json`            |
| Cursor      | `.cursor/mcp.json`        | `~/.cursor/mcp.json`        |

> **Project scope is a committed file.** Adding the server at project scope
> (`.kiro/settings/mcp.json`, `.mcp.json`, `.cursor/mcp.json`) shares it — and
> the destination it points at — with everyone who checks out the repo. Use user
> scope if the destination is yours alone.

## Configuration

Configuration is **environment-only** — there is no settings file and no mutable
state. Every knob is an environment variable named `DURABLE_INSIGHT_` + the
SCREAMING_SNAKE form of its setting key (`athenaDatabase` →
`DURABLE_INSIGHT_ATHENA_DATABASE`). Set them in the `env` block above.

Two standard AWS variables are honored as fallbacks when their prefixed form is
unset: `AWS_REGION` fills in `DURABLE_INSIGHT_REGION`, and `AWS_PROFILE` fills in
`DURABLE_INSIGHT_AWS_PROFILE`. The prefixed form wins when both are set. Region
falls back further to `AWS_DEFAULT_REGION`, then defaults to `us-east-1`.

**Credentials need no configuration.** They come from the standard AWS SDK
provider chain — environment variables, `~/.aws/credentials`, SSO — honoring
`DURABLE_INSIGHT_AWS_PROFILE` (or `AWS_PROFILE`) when set. The identity you use
needs read access to whichever destination you point at.

### Destinations and their required variables

`DURABLE_INSIGHT_DESTINATION_TYPE` selects the backend. Seven destination types
are **queryable**; each requires the variables below (anything not listed has a
working default, shown in parentheses). If `DURABLE_INSIGHT_DESTINATION_TYPE` is
unset it defaults to `cloudwatch-logs-exporter`. A value that is **set but not
recognized** (a typo such as `dynamo`, or wrong casing such as `DynamoDB`) also
falls back to that default, so the server warns on startup and names the valid
values — otherwise it would report a CloudWatch variable as missing to someone who
had configured DynamoDB correctly.

| `DURABLE_INSIGHT_DESTINATION_TYPE` | Required variables                                                                                                              | Notable defaults                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamodb`                         | `DURABLE_INSIGHT_DYNAMODB_TABLE_NAME`                                                                                           | —                                                                                                                                                                                                                                     |
| `s3` (Athena)                      | `DURABLE_INSIGHT_ATHENA_DATABASE`, **and** one of `DURABLE_INSIGHT_ATHENA_WORKGROUP` / `DURABLE_INSIGHT_ATHENA_OUTPUT_LOCATION` | `DURABLE_INSIGHT_ATHENA_TABLE` (`workflow_insight`)                                                                                                                                                                                   |
| `aurora`                           | `DURABLE_INSIGHT_AURORA_RESOURCE_ARN`, `DURABLE_INSIGHT_AURORA_SECRET_ARN`                                                      | `DURABLE_INSIGHT_AURORA_DATABASE` (`postgres`), `DURABLE_INSIGHT_AURORA_TABLE` (`workflow_insight`)                                                                                                                                   |
| `redshift`                         | one of `DURABLE_INSIGHT_REDSHIFT_WORKGROUP_NAME` / `DURABLE_INSIGHT_REDSHIFT_CLUSTER_IDENTIFIER`                                | `DURABLE_INSIGHT_REDSHIFT_DATABASE` (`dev`), `DURABLE_INSIGHT_REDSHIFT_TABLE` (`workflow_insight`), `DURABLE_INSIGHT_REDSHIFT_SCHEMA` (`public`); `DURABLE_INSIGHT_REDSHIFT_SECRET_ARN` / `DURABLE_INSIGHT_REDSHIFT_DB_USER` optional |
| `opensearch`                       | `DURABLE_INSIGHT_OPENSEARCH_ENDPOINT`                                                                                           | `DURABLE_INSIGHT_OPENSEARCH_INDEX` (`workflow-insight`)                                                                                                                                                                               |
| `cloudwatch-logs-exporter`         | `DURABLE_INSIGHT_LOG_GROUP_NAME` (comma-separated for multiple)                                                                 | —                                                                                                                                                                                                                                     |
| `lambda-log-exporter`              | `DURABLE_INSIGHT_LOG_GROUP_NAME` (comma-separated for multiple)                                                                 | —                                                                                                                                                                                                                                     |

For Athena, note that `DURABLE_INSIGHT_ATHENA_S3_LOCATION` is **not** required:
that is the source-data location used only to create the table, which this server
never does. What it needs is somewhere to write query _results_ — a workgroup
with an output location configured, or an explicit
`DURABLE_INSIGHT_ATHENA_OUTPUT_LOCATION`.

`sqs` is **not queryable.** It is a tail-only destination — a message queue this
server can only long-poll, with no query engine behind it — so `query`,
`get_execution`, and `list_executions` refuse it with an explanatory error rather
than pretend. Do not configure `sqs` for use with this server.

## The tools

The server registers five tools. Call them roughly in this order.

- **`test_destination`** — Run first. Read-only connectivity and completeness
  checks against the configured destination. If required variables are unset it
  names them and returns _without any AWS call_. Stop and fix if it reports a
  problem.
- **`describe_schema`** — **Call this before writing a `query`.** Returns the
  configured destination's record schema, query engine/dialect, the table or log
  group in play, and the row cap — sourced from the SDK for whatever destination
  is actually configured. It makes no AWS call, so it is safe even before setup
  is complete. Writing a query without it is guessing: field names, column
  casing, and quoting genuinely differ across DynamoDB (PartiQL), Athena, Aurora,
  Redshift, OpenSearch, and CloudWatch Logs.
- **`list_executions`** — The common case. List execution records filtered by any
  of `status`, `functionName`, `since`, and `until`, with a bounded `limit` — no
  query language required. **Prefer this over a hand-written `query`:** it cannot
  be got wrong and costs fewer tokens. Reach for `query` only when a question
  cannot be expressed through these filters. On log destinations the scanned window
  follows `since`, so filtering to last week scans last week.
- **`get_execution`** — Fetch a single execution record by its execution ARN. A
  record that does not exist is a success with `found: false`, not an error. For
  the Athena/`s3` destination you may also pass `year`/`month`/`day` to prune to
  one partition instead of scanning the whole table.
- **`query`** — The escape hatch. Execute a single read-only query against the
  destination. For the SQL destinations (`dynamodb`, `s3`, `aurora`, `redshift`,
  `opensearch`) only `SELECT`/`WITH` is accepted; any data-modifying or DDL
  statement is refused before any AWS call. For the CloudWatch Logs destinations
  (`cloudwatch-logs-exporter`, `lambda-log-exporter`) pass a CloudWatch Logs
  Insights pipe query, not SQL, and use `lookbackHours` to set the time window.

### Result bounding

- **Row cap.** Every result from every destination is capped at **1000 rows**
  (`MAX_ROWS`). Pass a smaller `limit` when you only need a few rows: it is honored,
  and rows you did not want still cost tokens to read. `limit` cannot raise the cap.
- **`truncated` means "there may be more matching data than this."** It does not
  mean the returned array was trimmed. Reaching the cap sets it; on DynamoDB a
  response that hit the service's ~1 MB limit also sets it, which can happen far
  below 1000 rows. Either way, narrow your filters rather than assuming you saw
  everything.
- **Log lookback window.** CloudWatch Logs Insights has no "all time"; a query must
  carry an explicit `[start, end]` window, and that window is separate from any
  filtering inside the query. All three tools report the window they scanned as
  `searchedLookbackHours`, because a window narrower than your filters ask for returns
  a partial answer that otherwise looks complete.
  - `list_executions` **derives the window from `since`**, so filtering to last week
    scans last week. Pass `lookbackHours` to widen a search that has no `since`.
  - `query` defaults to the **last 24 hours**, `get_execution` to the **last 7 days**;
    both accept `lookbackHours`.
  - A `found: false` from `get_execution` therefore means "not in that window", not
    "does not exist".
  - This window is ignored by the SQL destinations, which are not time-windowed.

## Prompts

The server ships two MCP prompts, so no separate install is needed — a client
such as Kiro surfaces them under `/prompts` and `@name`, Claude Code as slash
commands. Each encodes the correct _order of operations_ (verify, describe
schema, narrow, drill in) and defers all schema facts to `describe_schema` at
runtime.

- **`investigate_workflow_failure`** — Guided, correct-order investigation of a
  durable function failure. Accepts optional `functionName` and `lookbackHours`
  to scope the search.
- **`explore_recent_executions`** — Guided overview of recent executions. Accepts
  an optional `status` filter.

## Skill

`SKILL.md` (shipped in the package under `src/skill/`) is a progressively-loaded
skill that teaches an agent the one rule that keeps its queries correct: ask the
server for the schema with `describe_schema` before writing a `query`. It
contains zero destination-specific schema facts on purpose, so it can never drift
from the server.

For a client that supports skills, install it by placing the file where the
client looks for skills and referencing it from an agent. In Kiro, drop it under
`.kiro/skills/` and let an agent load it via a `skill://` entry in that agent's
`resources`, for example:

```json
{
  "resources": ["skill://.kiro/skills/**/SKILL.md"]
}
```

Custom Kiro agents inherit workspace skills by default, so a file under
`.kiro/skills/` is typically picked up without any config change.

## Settings this host does not accept

This host takes its model from the **agent** that drives it — the agent already
has an LLM — so eight provider/model/agent-loop settings that the VS Code
extension and desktop app accept are deliberately ignored here. There is no
provider to choose, no local model to run, no agent loop of its own, and no
AI-usage consent for it to record (that relationship belongs to the agent's own
host):

- `llmProvider`
- `bedrockModelId`
- `localModel`
- `localServerUrl`
- `localServerModel`
- `agenticMaxIterations`
- `queryMode`
- `aiDisclosureAcceptedVersion`

If you set the corresponding environment variable anyway (for instance, copied
from VS Code settings), the server does not fail — it starts and emits a warning
that the variable is ignored.

## Data handling and AI disclosure

Read this before pointing the server at production data.

- **Execution records carry `input` and `output` payloads, and this server
  returns them verbatim** — not redacted, not summarized, not filtered. The
  `get_execution`, `list_executions`, and `query` tools all return record data,
  and `get_execution` and `query` can surface the full `input` and `output`
  payloads of an execution. In plain terms: asking your agent to "query my
  workflow data" means the production payloads your workflows process — whatever
  that data is — enter the agent's context, and therefore the model behind it.
- **Where the data goes is determined by the customer, not by this server.** Data
  flows to the agent that requested it, and from there wherever that agent's own
  configuration sends it (its model provider, its logs, its storage). This server
  chooses none of that and cannot see past its own stdout.
- **This server makes no model calls of its own.** It selects no model provider
  and contacts none. It is stdio in, JSON out, running on your machine; the only
  outbound calls it makes are the read-only AWS API calls needed to run your
  query.
- **Every query is read-only; the server cannot modify your data.** On the SQL
  destinations any statement that is not `SELECT`/`WITH` is refused before a
  single AWS call is made. On the CloudWatch Logs destinations the Logs Insights
  query language has no write or DDL forms at all, and the only API used can only
  read. There is no code path through this server that mutates the customer's
  data.

Installing this server into an agent you chose is itself the opt-in; there is no
separate consent gate, acceptance flag, or version to accept.

## Troubleshooting

- **`test_destination` reports missing configuration.** When required variables
  are unset, `test_destination` returns a successful result with `ok: false` and
  a `missingEnvVars` array **naming the exact `DURABLE_INSIGHT_*` variables** that
  are unset — it does not guess and does not call AWS. Set the named variables in
  your client's `env` block and re-run it.
- **The server starts even when misconfigured — on purpose.** Missing destination
  configuration is not a startup error. A server that refused to launch would
  surface in an MCP client as an unexplained failure; one that starts can tell
  the agent, through `test_destination`, exactly what is wrong. So if tools are
  listed but queries report incomplete config, run `test_destination` first — it
  is the diagnostic.
- **A query is refused as not read-only.** That is the security boundary working:
  only `SELECT`/`WITH` reaches an AWS call on the SQL destinations. Rephrase as a
  read.
- **`query` against `sqs` errors out.** Expected — `sqs` is tail-only and has no
  query engine. Point the server at a queryable destination.

## From zero to a confirmed connection

A complete path for a new user, using DynamoDB as the example:

1. Have AWS credentials available to the standard SDK chain (an exported
   `AWS_PROFILE`, `~/.aws/credentials`, or SSO) with read access to the table.
2. Add the server to your client with the destination variables set — use the
   [Kiro](#kiro) or [Claude Code](#claude-code) helper above, substituting your
   real table name and region. Nothing to install: `npx -y` fetches the package.
3. Restart / reload your client so it launches the server.
4. Ask the agent to run **`test_destination`**. A result with `ok: true` confirms
   the connection. If it returns `missingEnvVars`, set those exact variables and
   repeat step 4.
5. Then run **`describe_schema`**, and start querying with **`list_executions`**.
