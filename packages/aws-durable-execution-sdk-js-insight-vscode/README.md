# Workflow Insight Explorer — VS Code Extension

Query your [Workflow Insight](../aws-durable-execution-sdk-js-insight) data in plain English. Ask a question, get results — no query language knowledge required.

## How It Works

```
Type a question ──► Bedrock converts it to a query ──► Runs against your data ──► Results table
```

1. You type a question (e.g., "show me failed executions from the last hour")
2. Amazon Bedrock generates the appropriate query for your destination
3. The query runs automatically and results render in a table

The extension supports multiple destinations — each with its own query engine:

| Destination                                  | Query Engine  | Best For                                |
| -------------------------------------------- | ------------- | --------------------------------------- |
| **CloudWatch Logs** (CloudWatchLogsExporter) | Logs Insights | Quick exploration, zero setup           |
| **CloudWatch Logs** (LambdaLogExporter)      | Logs Insights | Default exporter, no infra needed       |
| **DynamoDB**                                 | PartiQL       | Fast lookups by execution               |
| **Aurora PostgreSQL**                        | SQL           | Complex queries, GROUP BY, aggregations |
| **S3** (S3Exporter)                          | Athena SQL    | Analytics at scale, long-term retention |

## Installation

```bash
cd packages/aws-durable-execution-sdk-js-insight-vscode
npm install
npm run build
```

## Getting Started

### 1. Launch the extension

Open this folder in VS Code and press **F5** to start the Extension Development Host. In the new window, run:

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

### 3. Configure Bedrock

Set the **Bedrock Model ID** to an inference profile you have access to:

```
us.anthropic.claude-sonnet-4-20250514-v1:0
```

### 4. Ask questions

Type a question and click **Ask**. Examples:

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

## Settings Reference

All settings are under the `workflowInsight.*` namespace.

| Setting                | Description                                                        | Required     |
| ---------------------- | ------------------------------------------------------------------ | ------------ |
| `region`               | AWS region                                                         | Yes          |
| `destinationType`      | Where your data lives (see above)                                  | Yes          |
| `logGroupName`         | CloudWatch log group name(s), comma-separated                      | For CW Logs  |
| `dynamodbTableName`    | DynamoDB table name                                                | For DynamoDB |
| `auroraResourceArn`    | Aurora cluster ARN                                                 | For Aurora   |
| `auroraSecretArn`      | Secrets Manager secret ARN                                         | For Aurora   |
| `auroraDatabase`       | Database name                                                      | For Aurora   |
| `auroraTable`          | Table name                                                         | For Aurora   |
| `athenaDatabase`       | Glue/Athena database name                                          | For S3       |
| `athenaTable`          | Glue table name                                                    | For S3       |
| `athenaWorkgroup`      | Athena workgroup (empty = `primary`)                               | No           |
| `athenaOutputLocation` | S3 location for Athena query results                               | For S3\*     |
| `athenaS3Location`     | S3 location `S3Exporter` writes to (used to auto-create the table) | For S3       |
| `sqsQueueUrl`          | SQS queue URL to listen to                                         | For SQS      |
| `sqsDeleteAfterRead`   | Delete messages after displaying (default `false`; peek-only)      | No           |
| `awsProfile`           | Named AWS profile (empty = default chain)                          | No           |
| `bedrockModelId`       | Bedrock model/inference profile for NL→query                       | Yes          |

\* Unless the chosen `athenaWorkgroup` already has its own output location configured.

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
| Bedrock (all)   | `bedrock:InvokeModel` on your model/inference profile                                                                                                                                                                                    |

## How Queries Are Generated

The extension sends your question to Amazon Bedrock along with:

1. **The exact record schema** (`WorkflowInsightRecord` fields and types)
2. **The query dialect** for your destination (Logs Insights / PartiQL / PostgreSQL)
3. **Few-shot examples** (proven question→query pairs)

If the generated query fails, the extension automatically sends the error back to Bedrock and asks it to fix the query (up to 2 retries).

## Error Handling

- **"The model did not return a query"** — Rephrase your question or check Bedrock credentials
- **Query errors** — The extension auto-retries by feeding the error to Bedrock
- **"No log group / table configured"** — Click ⚙ and fill in the missing field
- **Access denied** — Check IAM permissions and credential expiry

## Future Work

The extension currently supports CloudWatch Logs, DynamoDB, Aurora, and S3 + Athena. Future versions will add:

- Query history and saved queries
- CSV export
- Local LLM option (no Bedrock required)
