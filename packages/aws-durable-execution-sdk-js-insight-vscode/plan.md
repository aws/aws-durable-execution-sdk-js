# Workflow Insight — VS Code Extension Plan

A VS Code extension that acts as a UI for Workflow Insight data. The customer
configures a data destination (the same destinations the insight plugin exports
to), types a question in plain English, and the extension uses Amazon Bedrock to
convert it into a query, runs it against the destination, and renders the result
in a table.

This is a companion to `@aws/durable-execution-sdk-js-insight`. It reuses that
package's `WorkflowInsightRecord` schema — owning the schema is the key lever for
making natural-language → query reliable.

## Goals

- One-time, per-destination config (DynamoDB table, S3/Athena, CloudWatch Logs).
- A query box that accepts an English question.
- Bedrock converts the question into a destination-specific query.
- The generated query is shown for review/edit before running.
- Results render in a sortable, exportable table.

## Non-Goals (for the MVP)

- No write/mutation queries — read-only only.
- No bespoke dashboards or charts (table view only for v1).
- No multi-account federation (one profile + region at a time).
- Not a replacement for the AWS console; this is a developer-loop tool.

## Architecture

Two processes inside the extension, one boundary:

```
┌─────────────────────── VS Code Extension ───────────────────────┐
│   Webview (UI)                    Extension Host (Node.js)       │
│   ┌──────────────┐   postMessage  ┌────────────────────────┐     │
│   │ Config form  │ ─────────────► │ ConfigStore            │     │
│   │ Query box    │                │  (settings + Secrets)  │     │
│   │ Results grid │ ◄───────────── │ NL→Query (Bedrock)     │     │
│   └──────────────┘                │ QueryProvider (per dst)│     │
│                                    │ AWS SDK v3 clients     │     │
│                                    └───────────┬────────────┘     │
└────────────────────────────────────────────────┼────────────────┘
                                                  │ user's AWS creds
                          ┌───────────────────────┼───────────────────────┐
                          ▼                        ▼                       ▼
                    DynamoDB (PartiQL)    S3 + Athena (SQL)     CloudWatch Logs Insights
```

- **Webview** = pure UI. No AWS calls, no credentials. Sandboxed.
- **Extension host** = all logic: prompt building, query validation/execution,
  AWS access. Communicates with the webview only via `postMessage`.

This split keeps credentials out of the sandboxed webview.

## Components

### 1. Config / setup

Destination is a discriminated selector; fields depend on it:

| Destination     | Config fields                                                       | Query engine  |
| --------------- | ------------------------------------------------------------------- | ------------- |
| DynamoDB        | `region`, `tableName`, optional `partitionKey`                      | PartiQL       |
| S3              | `region`, `database`, `table` (Glue), `workgroup`, `outputLocation` | Athena SQL    |
| CloudWatch Logs | `region`, `logGroupName(s)`                                         | Logs Insights |

- Non-secret config → workspace/user settings or a committed
  `.workflow-insight.json` so a team can share it.
- **Auth**: use the AWS credential provider chain (`fromIni`/`fromSSO`); let the
  user pick a named profile + region. Use `context.secrets` (SecretStorage) only
  if a user pastes raw keys — never store credentials in settings.
- Validate config with a cheap call (`DescribeTable` / `GetWorkGroup` /
  `DescribeLogGroups`) and show a status indicator.

### 2. QueryProvider abstraction

Mirrors the insight exporter pattern so destinations are pluggable.

```ts
interface QueryProvider {
  readonly engine: "athena" | "partiql" | "logs-insights";
  /** Schema + dialect hints fed to Bedrock for this destination. */
  promptContext(): { schema: string; dialect: string; examples: Example[] };
  /** Reject anything that isn't a read. Throws on violation. */
  validate(query: string): void;
  /** Execute and normalize to rows + columns. */
  run(
    query: string,
    signal: AbortSignal,
  ): Promise<{ columns: string[]; rows: unknown[][] }>;
}
```

- **AthenaProvider** — `StartQueryExecution` → poll → `GetQueryResults`. Richest
  path. Auto-generate the Glue DDL from the known `WorkflowInsightRecord` schema
  (`operations` → `array<struct<...>>`) instead of asking the customer to define it.
- **DynamoDBProvider** — `ExecuteStatement` (PartiQL). Best for lookups by
  execution ARN; warn that non-key filters become scans.
- **LogsInsightsProvider** — `StartQuery` → poll → `GetQueryResults`.

### 3. NL → query (Bedrock)

Use the Bedrock **Converse API with a forced tool call** for structured output
(`{ query, explanation, confidence }`) instead of scraping prose.

The system prompt injects three things (this is where owning the schema pays off):

1. The exact `WorkflowInsightRecord` schema (from `plugin-contracts.md`).
2. The dialect for the selected destination, with concrete table/column names.
3. Few-shot examples (reuse the "Query Examples" table in `plugin-contracts.md`).

Always show the generated query + plain-English explanation and let the user
review/edit before running (trust + safety).

### 4. Safety & cost guardrails (required, not optional)

The query is LLM-generated from free text — treat it as untrusted.

- **Read-only enforcement.** Validate before executing. Athena: only a single
  `SELECT` / `WITH … SELECT`; reject `CREATE/DROP/INSERT/UNLOAD/ALTER/CTAS`.
  PartiQL: only `SELECT`. Logs Insights is read-only by nature.
- **Inject a `LIMIT`** when absent and cap it.
- **Athena cost controls**: dedicated workgroup with `BytesScannedCutoffPerQuery`;
  prefer Parquet + date partitioning; surface bytes-scanned / estimated cost.
- **Prompt-injection**: the model sees only the question + schema, never raw rows.
  Do not feed result rows back into the query-generation prompt.
- **IAM least privilege**: read-only on exactly the configured resources, plus
  `bedrock:InvokeModel` on the chosen model. Ship as a documented managed policy.
- **PII**: records may carry execution payloads; warn before CSV export.

### 5. Results table

Extension host normalizes every engine's output to `{ columns, rows }`. The grid
supports sorting, column resize, JSON-cell expansion (for `operations`/`input`/
`output`), CSV export, and pagination (Athena `NextToken`). Long-running queries
stream status (`QUEUED → RUNNING → SUCCEEDED`) with a cancel button wired to an
`AbortController`.

## Tech choices

- Scaffold: `yo code` (TypeScript extension).
- AWS SDK v3: `@aws-sdk/client-bedrock-runtime`, `client-athena`,
  `client-dynamodb`, `client-cloudwatch-logs`, `credential-providers`.
- Webview UI: plain HTML/CSS themed with VS Code CSS variables (`--vscode-*`),
  or a small framework (Svelte/React) bundled with esbuild, plus a data-grid
  component. (Note: `@vscode/webview-ui-toolkit` is deprecated — avoid it.)
- Share `WorkflowInsightRecord` by depending on
  `@aws/durable-execution-sdk-js-insight`.

## Proposed layout

```
src/
  extension.ts            # activate(): register command, create panel
  webview/                # UI bundle (config form, query box, grid)
  config/configStore.ts   # settings + SecretStorage + profile/region
  providers/{athena,dynamodb,logsInsights}.ts
  nl/bedrockClient.ts     # Converse + structured tool output
  nl/promptBuilder.ts     # schema + dialect + few-shots
  query/validator.ts      # read-only + LIMIT enforcement
```

## Phasing

1. **Athena-only MVP** — config + query box + grid; validator + few-shot prompt.
   (Relational path gives the best NL→SQL accuracy.)
2. Add **DynamoDB** and **CloudWatch Logs Insights** providers behind the same interface.
3. Polish — query history, saved queries, cost display, cancel, CSV export.

## Open questions

- Distribution: VS Code Marketplace vs internal/OpenVSX? Naming/publisher?
- Which Bedrock model + region default, and how to handle model access enablement?
- Auto-create the Glue table/DDL for S3, or assume the customer already has it?
- Should config live in the repo (`.workflow-insight.json`) or only in user settings?
- Do we gate on `confidence` from the model before auto-filling the query box?

```

```
