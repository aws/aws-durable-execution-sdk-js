# Workflow Insight Explorer — VS Code Extension

Query your [Workflow Insight](../aws-durable-execution-sdk-js-insight) data from inside VS Code — in plain English, or with a query you write yourself — get results as a table, and optionally chart them.

## How It Works

The composer's **Send** button offers three modes (your choice is remembered across sessions):

```
Query ─► run your query verbatim ──────────────────► Results table
Ask ───► LLM writes one query ──► runs it ─────────► Results table
Agent ─► LLM explores: query → refine → answer ────► Results table
```

- **Query** — you write the query yourself; it runs verbatim against your data source. **No LLM is involved.**
- **Ask** — you type a question in plain English; the configured LLM translates it into a single query and runs it once.
- **Agent** — the LLM works agentically, running and refining queries over several steps until it can answer your question.

The LLM used by **Ask** and **Agent** is your choice — **Amazon Bedrock**, **GitHub Copilot**, a **self-hosted local server**, or an **on-device model** (see [Choose an LLM provider](#3-choose-an-llm-provider)). You can also **visualize** any result as a chart, **export** it (CSV/JSON), and **save queries** as favorites.

The extension supports multiple destinations — each with its own query engine:

| Destination                                  | Query Engine  | Best For                                |
| -------------------------------------------- | ------------- | --------------------------------------- |
| **CloudWatch Logs** (CloudWatchLogsExporter) | Logs Insights | Quick exploration, zero setup           |
| **CloudWatch Logs** (LambdaLogExporter)      | Logs Insights | Default exporter, no infra needed       |
| **DynamoDB**                                 | PartiQL       | Fast lookups by execution               |
| **Aurora PostgreSQL**                        | SQL           | Complex queries, GROUP BY, aggregations |
| **S3** (S3Exporter)                          | Athena SQL    | Analytics at scale, long-term retention |

## Install (Preview Build)

> The extension isn't on the VS Code Marketplace yet. During the preview it's
> distributed as a packaged **`.vsix`** attached to a **GitHub Release** — that's
> how you give a tester/customer access before the public launch: point them at
> the release and have them side-load it. No Marketplace account needed.

**1. Download the `.vsix` for your platform**

Grab the latest `.vsix` matching your OS/arch from the repo's
[**Releases**](https://github.com/aws/aws-durable-execution-sdk-js/releases) page
(look for a `workflow-insight-vscode-*` tag). Each release attaches one `.vsix`
per supported platform:

| Platform              | Filename suffix      |
| --------------------- | -------------------- |
| Apple Silicon (macOS) | `-darwin-arm64.vsix` |
| Windows (Intel/x64)   | `-win32-x64.vsix`    |
| Windows (ARM64)       | `-win32-arm64.vsix`  |
| Linux (x64)           | `-linux-x64.vsix`    |

> Other platforms (Intel macOS, ARM Linux) aren't built yet during preview —
> [open an issue](https://github.com/aws/aws-durable-execution-sdk-js/issues/new) if you need one.

**2. Install it into VS Code**

- **From the UI:** open the **Extensions** view (`⇧⌘X` / `Ctrl+Shift+X`) → the
  **⋯** (Views and More Actions) menu → **Install from VSIX…** → pick the file.
- **From the command line:**

  ```bash
  code --install-extension aws-durable-execution-sdk-js-insight-vscode-<version>-<platform>.vsix
  ```

**3. Open the Explorer**

Run **`⇧⌘P`** → **Workflow Insight: Open Explorer**, click **⚙** to set your
region, destination, and model provider, then ask a question (see
[Getting Started](#getting-started)).

> **Updating:** install a newer `.vsix` the same way (VS Code replaces the old
> version), or uninstall the previous one from the Extensions view first.
>
> **Model providers in the `.vsix`:** the packaged build supports **Bedrock**
> (default), **GitHub Copilot**, **Local server** (an OpenAI-compatible
> endpoint you run, e.g. Ollama), and **Local (on-device)** — see
> [LLM provider](#3-choose-an-llm-provider). The on-device provider bundles a
> native runtime (`node-llama-cpp`) built for the `.vsix`'s specific
> platform/arch, which is why each platform ships its own `.vsix`.

## Build from Source

For contributors, or to produce your own `.vsix`:

```bash
cd packages/aws-durable-execution-sdk-js-insight-vscode
npm install
npm --prefix webview-ui install   # webview-ui isn't an npm workspace; install it separately
npm run build
```

Package a shareable `.vsix` (build + bundle into `vsix/`, git-ignored):

```bash
npm run package   # writes vsix/<name>-<version>.vsix
```

Publishing a preview to testers: create a GitHub Release and attach that `.vsix`
(e.g. `gh release create workflow-insight-vscode-v<version> vsix/*.vsix
--title "Workflow Insight Explorer <version>" --notes "Preview build"`).

## Getting Started

### 1. Launch the extension

- **Installed from the `.vsix`:** run **⌘⇧P** (`Ctrl+Shift+P`) → **Workflow Insight: Open Explorer**.
- **Running from source:** open this folder (`packages/aws-durable-execution-sdk-js-insight-vscode`) directly in VS Code — not the monorepo root — then press **F5** to start the Extension Development Host, and run the same command in the new window.

  `.vscode/` is git-ignored, so F5 does nothing until you create
  `.vscode/launch.json` yourself:

  ```json
  {
    "version": "0.2.0",
    "configurations": [
      {
        "name": "Run Extension",
        "type": "extensionHost",
        "request": "launch",
        "args": [
          "--extensionDevelopmentPath=${workspaceFolder}",
          "${workspaceFolder}"
        ]
      }
    ]
  }
  ```

  See [TESTING.md](./TESTING.md) for the full source setup, including a
  `.vscode/settings.json` example for pointing the extension at your own
  AWS region/log group.

> **⌘⇧P** → **Workflow Insight: Open Explorer**

### 2. Configure your destination

Click the **⚙** button and fill in your settings. The form shows only the fields relevant to your chosen destination.

#### CloudWatch Logs (CloudWatchLogsExporter)

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| Region           | `us-east-1`                                  |
| Destination Type | CloudWatchLogsExporter                       |
| Log Group Name   | `/workflow-insight/demo` (or your log group) |

#### CloudWatch Logs (LambdaLogExporter)

| Field            | Value                            |
| ---------------- | -------------------------------- |
| Region           | `us-east-1`                      |
| Destination Type | LambdaLogExporter                |
| Log Group Name   | `/aws/lambda/your-function-name` |

#### DynamoDB

| Field               | Value                              |
| ------------------- | ---------------------------------- |
| Region              | `us-east-1`                        |
| Destination Type    | DynamoDB                           |
| DynamoDB Table Name | `workflow-insight` (or your table) |

#### Aurora PostgreSQL

| Field              | Value                           |
| ------------------ | ------------------------------- |
| Region             | `us-east-1`                     |
| Destination Type   | Aurora PostgreSQL               |
| Aurora Cluster ARN | Your cluster ARN                |
| Aurora Secret ARN  | Your Secrets Manager secret ARN |
| Aurora Database    | `postgres`                      |
| Aurora Table       | `workflow_insight`              |

#### S3 + Athena

Records land in S3 via `S3Exporter` as one JSON object per execution, Hive-partitioned
by date (`year=YYYY/month=MM/day=DD/`). The Explorer queries them through Amazon
Athena.

| Field                 | Value                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| Region                | `us-east-1`                                                                         |
| Destination Type      | S3 + Athena                                                                         |
| Glue Database         | The Glue/Athena database to hold the table (e.g. `default`)                         |
| Glue Table            | `workflow_insight` (or your preferred name)                                         |
| S3 Location           | The bucket + prefix `S3Exporter` writes to, e.g. `s3://my-bucket/workflow-insight/` |
| Athena Workgroup      | Optional — leave empty to use `primary` and set Query Result Location instead       |
| Query Result Location | S3 path for Athena's query output, e.g. `s3://my-bucket/athena-results/`            |

On **Save**, the Explorer checks whether the Glue table already exists. If not, it
auto-creates it with `CREATE EXTERNAL TABLE`, using
[partition projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html)
so Athena computes valid year/month/day partitions (and their S3 locations)
directly from the table properties instead of listing them from the Glue
Catalog — today's data is queryable the moment `S3Exporter` writes it, with no
`MSCK REPAIR TABLE` or crawler run, and no re-discovery step needed as more days
accumulate.

Because the canonical `operations` array (not `operationsByName`) is what
`S3Exporter` writes, per-operation questions are answered with `UNNEST` rather than
a map lookup (see the query dialect the model is given).

> **⚠️ Athena cost:** in **Agent** mode the assistant may issue several
> model-authored queries per question (bounded by `workflowInsight.agenticMaxIterations`,
> default 8); **Ask** runs one query (plus an optional verify/refine), and
> **Query** runs exactly the one you typed. That cap limits the _number_ of
> queries, not the data scanned per query — Athena bills per byte scanned. To
> bound per-query scan cost, set a
> [per-query data-usage limit](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html)
> (`bytes_scanned_cutoff_per_query`) on your Athena **workgroup**. This is the
> only per-query scan-cost guard once the query runs.

#### Amazon SQS (live view)

SQS has no query engine, so this destination doesn't use the "Ask" pipeline at
all — it's a **live view** instead. Click **Start Listening** and messages
appear as they arrive on the queue.

| Field                            | Value                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Region                           | `us-east-1`                                                                                                                                   |
| Destination Type                 | Amazon SQS (live view)                                                                                                                        |
| SQS Queue URL                    | Your queue's URL                                                                                                                              |
| Delete messages after displaying | Off by default (peek-only — other consumers still get every message). Turn on only if this Explorer should be the sole consumer of the queue. |

Peek-only mode (the default) uses SQS long-polling without deleting messages,
so the same message can be redelivered after its visibility timeout — the
Explorer de-duplicates by message ID when displaying, but this also means it
is not a substitute for a real consumer if you need exactly-once processing.

### 3. Choose an LLM provider

Pick a provider under **⚙ → LLM Provider**:

- **Amazon Bedrock** (default) — set the **Bedrock Model ID** to an inference profile you have access to:

  ```
  us.anthropic.claude-sonnet-5
  ```

  Click **List available models** next to the field to fetch the models
  available for your configured Region and AWS Profile and pick one from the
  suggestions — or type any model / inference profile ID directly.

- **GitHub Copilot** — uses the VS Code Language Model API; requires an active Copilot subscription. No extra config.

- **Local server** — an OpenAI-compatible endpoint you run yourself, so no data leaves your machine and no cloud model access is needed. Works with **Ollama**, **LM Studio**, or a **llama.cpp** server. For Ollama:

  ```bash
  ollama serve                 # starts the server on http://localhost:11434
  ollama pull llama3.1         # or any model you want to use
  ```

  Then set **Server URL** (default `http://localhost:11434/v1`) and **Model** (e.g. `llama3.1`). This is the recommended way to run local models from the packaged `.vsix`.

- **Local LLM (on-device)** — an embedded model downloaded on first use. Only available when running from source (not bundled in the `.vsix`).

> Bedrock is the most capable, especially for the multi-step **agent** mode
> (it uses Bedrock's tool-use API); Copilot and the local providers run the
> single-shot **ask** and the verify/refine loop.

### 4. Run a query or ask a question

Pick a mode from the **Send** button's dropdown (**Query**, **Ask**, or **Agent** — see [How It Works](#how-it-works)); the choice is remembered. In **Query** mode you type a query and it runs verbatim; in **Ask**/**Agent** you type a question in plain English. Examples of natural-language questions for Ask/Agent:

| Question                                                | Works best with                         |
| ------------------------------------------------------- | --------------------------------------- |
| "show me the last 50 records"                           | Any destination                         |
| "count executions by status"                            | Any destination                         |
| "show failed executions from the last hour"             | Any destination                         |
| "average duration of successful executions"             | Aurora, S3+Athena, CloudWatch           |
| "failure rate percentage"                               | Aurora                                  |
| "average duration grouped by function"                  | Aurora                                  |
| "show executions longer than 5 seconds"                 | Any destination                         |
| "find execution with name abc123"                       | DynamoDB, Aurora                        |
| "executions where operation convert_data took under 5s" | CloudWatch, DynamoDB, Aurora, S3+Athena |
| "executions where the charge operation failed"          | CloudWatch, DynamoDB, Aurora, S3+Athena |

> Per-operation-name questions use the `operationsByName` index (CloudWatch
> direct + DynamoDB), a JSONB query over the operations array (Aurora), or
> `UNNEST(operations)` (S3 + Athena). With the `LambdaLogExporter` (nested
> logs) these are best-effort — the `CloudWatchLogsExporter` gives the most
> reliable per-operation queries.

For row-level results (not aggregates like "count by status"), the Explorer
adds a hidden identifier column to the generated query if it's missing, and
selecting a row fetches and shows the _full_ record — including
`operations`, `input`, `output`, and `error` — even if the question's answer
only needed a couple of columns (e.g. "show me the last 10 executions" only
returns 4 columns, but you can still click a row to see everything else).
Aggregate results have no single execution a row corresponds to, so no
identifier is added and rows aren't clickable for those.

**Working with a result:** each result table has an **Actions** menu to **export** the full result as CSV or JSON, **save the query** to favorites (re-run it later from the composer's ⭐ picker), and **copy the query**. Expand the **Query** section above the table to see exactly what ran. To chart a result, open **Visualize** — the LLM proposes a chart spec from your columns (this is an AI feature; see below).

## Settings Reference

All settings are under the `workflowInsight.*` namespace.

| Setting                       | Description                                                                     | Required         |
| ----------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| `region`                      | AWS region                                                                      | Yes              |
| `destinationType`             | Where your data lives (see above)                                               | Yes              |
| `logGroupName`                | CloudWatch log group name(s), comma-separated                                   | For CW Logs      |
| `dynamodbTableName`           | DynamoDB table name                                                             | For DynamoDB     |
| `auroraResourceArn`           | Aurora cluster ARN                                                              | For Aurora       |
| `auroraSecretArn`             | Secrets Manager secret ARN                                                      | For Aurora       |
| `auroraDatabase`              | Database name                                                                   | For Aurora       |
| `auroraTable`                 | Table name                                                                      | For Aurora       |
| `athenaDatabase`              | Glue/Athena database name                                                       | For S3           |
| `athenaTable`                 | Glue table name                                                                 | For S3           |
| `athenaWorkgroup`             | Athena workgroup (empty = `primary`)                                            | No               |
| `athenaOutputLocation`        | S3 location for Athena query results                                            | For S3\*         |
| `athenaS3Location`            | S3 location `S3Exporter` writes to (used to auto-create the table)              | For S3           |
| `sqsQueueUrl`                 | SQS queue URL to listen to                                                      | For SQS          |
| `sqsDeleteAfterRead`          | Delete messages after displaying (default `false`; peek-only)                   | No               |
| `awsProfile`                  | Named AWS profile (empty = default chain)                                       | No               |
| `bedrockModelId`              | Bedrock model/inference profile for NL→query                                    | For Bedrock      |
| `llmProvider`                 | `bedrock` (default), `copilot`, `local-server`, or `local`                      | No               |
| `localServerUrl`              | OpenAI-compatible base URL for `local-server` (e.g. Ollama)                     | For local-server |
| `localServerModel`            | Model name the local server should use (e.g. `llama3.1`)                        | For local-server |
| `localModel`                  | On-device model for the `local` provider (source builds only)                   | For local        |
| `queryMode`                   | Default composer mode: `query`, `ask`, or `agent`                               | No               |
| `agenticMaxIterations`        | Max queries the agent runs per question (default 8)                             | No               |
| `aiDisclosureAcceptedVersion` | Records the accepted AI disclosure version (set on consent; clear to re-prompt) | No               |

\* Unless the chosen `athenaWorkgroup` already has its own output location configured.

## AI Features & Data Handling

Workflow Insight uses generative AI (a large language model) for some features.
The first time you use one, an in-app notice explains this and asks for your
consent; you can review or withdraw it at any time (see below).

- **Features that use AI:** the **Ask** and **Agent** composer modes and the
  **Visualize** page (query generation, result summaries, chart configuration).
- **Feature that does not:** **Query** mode runs the query you type directly
  against your data source and sends **nothing** to any model provider.
- **What is sent:** your request text and, in some cases, limited portions of
  your data — result **column names** and a **small sample of result rows**
  used for summaries or building charts. Full result sets and raw records are
  not sent.
- **Consent:** before the first AI use you must accept the disclosure. Your
  acceptance is stored in `workflowInsight.aiDisclosureAcceptedVersion`; the
  notice is shown again if it is updated. **Clearing that setting withdraws
  consent** and re-prompts you. The AI-free **Query** mode works regardless.

**Where your data goes depends on the provider you select** (`workflowInsight.llmProvider`):

| Provider           | Where AI requests + the data above go                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Amazon Bedrock** | Amazon Bedrock in your configured AWS account/region; under your AWS agreement + Bedrock terms                           |
| **GitHub Copilot** | GitHub Copilot via the VS Code Language Model API; under your Copilot subscription terms                                 |
| **Local server**   | Only the OpenAI-compatible endpoint you run and control (e.g. Ollama on localhost) — no third-party cloud if self-hosted |
| **On-device**      | Stays entirely on your machine; nothing leaves your computer (source builds only)                                        |

Data you send is subject to the terms and privacy policy of the provider you
select — review them before sending sensitive data. AI-generated queries and
answers may be inaccurate or incomplete; review them before relying on the
results, and only submit content you are authorized to share with the provider.

## Authentication

The extension uses the **standard AWS credential provider chain**:

1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. SSO / `~/.aws/credentials` named profiles
3. Default profile

If you use `ada`:

```bash
ada credentials update --once --account=YOUR_ACCOUNT --role=YOUR_ROLE
```

No credentials are stored by the extension.

## Required IAM Permissions

Depending on your destination:

| Destination     | Permissions needed                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CloudWatch Logs | `logs:StartQuery`, `logs:GetQueryResults`                                                                                                                                                                                                |
| DynamoDB        | `dynamodb:PartiQLSelect` (or `dynamodb:Scan` + `dynamodb:Query`)                                                                                                                                                                         |
| Aurora          | `rds-data:ExecuteStatement`, `secretsmanager:GetSecretValue`                                                                                                                                                                             |
| S3 + Athena     | `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`, `glue:GetTable`, `glue:CreateTable`, `glue:GetPartitions`, `glue:BatchCreatePartition`, `s3:GetObject`, `s3:PutObject` on the data + results buckets |
| SQS             | `sqs:ReceiveMessage` (plus `sqs:DeleteMessage` if `sqsDeleteAfterRead` is enabled)                                                                                                                                                       |
| Bedrock         | `bedrock:InvokeModel` on your model/inference profile — **only** when `llmProvider` is `bedrock` (Copilot, local-server, and on-device need no Bedrock/AWS model permissions)                                                            |

## How Queries Are Generated

In **Ask** and **Agent** modes, the extension sends your question to the configured LLM provider (Bedrock, Copilot, local server, or on-device) along with:

1. **The exact record schema** (`WorkflowInsightRecord` fields and types)
2. **The query dialect** for your destination (Logs Insights / PartiQL / PostgreSQL / Trino-Athena SQL)
3. **Few-shot examples** (proven question→query pairs)

If the generated query fails, the extension automatically sends the error back to the model and asks it to fix the query (up to 2 retries). **Query** mode skips all of this — it runs your text verbatim (read-only enforced, row-capped).

## Error Handling

- **"The model did not return a query"** — Rephrase your question, or check your LLM provider setup (Bedrock model access / Copilot subscription / local server reachable)
- **Query errors** — In Ask/Agent, the extension auto-retries by feeding the error back to the model
- **"No log group / table configured"** — Click ⚙ and fill in the missing field
- **Access denied** — Check IAM permissions and credential expiry

## Future Work

The extension supports CloudWatch Logs, DynamoDB, Aurora, and S3 + Athena, three
query modes (Query/Ask/Agent), four LLM providers (Bedrock, Copilot, local
server, on-device), result export (CSV/JSON), saved-query favorites, and chart
visualization. Potential future additions:

- Additional destinations and query engines
- Richer chart/visualization options
- Marketplace distribution (currently a preview `.vsix` via GitHub Releases)
