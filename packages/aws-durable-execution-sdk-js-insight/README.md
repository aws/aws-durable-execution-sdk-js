# @aws/durable-execution-sdk-js-insight

**Workflow Insight** is an observability plugin for [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html). It automatically captures execution state — status, timing, operations, input/output, and errors — and exports it to the destination(s) of your choice.

One line of configuration gives you full visibility into your durable workflows without building custom instrumentation.

## What it does

Every time your durable function runs, Workflow Insight builds a **cumulative snapshot** of the execution (`WorkflowInsightRecord`) and sends it to one or more exporters. The record includes:

- **Execution identity** — ARN, function name, region, account
- **Status** — RUNNING, SUCCEEDED, FAILED
- **Timing** — start/end time, total duration
- **Input/Output** — the event and result of the execution
- **Operations** — every step, wait, invoke, and callback with individual timing and status
- **Errors** — error name and message when the execution fails

## Record Schema (`WorkflowInsightRecord`)

Every emitted record has this shape:

```typescript
interface WorkflowInsightRecord {
  recordType: "WorkflowInsight"; // Fixed discriminator — use to filter insight records
  schemaVersion: "1.0";
  emittedAt: string; // ISO-8601 timestamp of emission

  // Execution identity
  executionArn: string; // Full ARN including execution/invocation IDs
  executionName?: string; // Customer-provided name (--durable-execution-name)
  functionName: string; // Lambda function name
  functionQualifier: string; // Version or alias
  region: string; // AWS region
  accountId: string; // AWS account ID

  // Execution state
  status: "RUNNING" | "SUCCEEDED" | "FAILED"; // suspends (waits/timers) surface as RUNNING
  startTime: string; // ISO-8601
  endTime?: string; // ISO-8601 (absent while running)
  durationMs?: number; // Total duration (absent while running)

  // Payload
  input?: unknown; // Execution input (the event)
  output?: unknown; // Execution result (on success)
  error?: {
    // Error details (on failure)
    name: string;
    message: string;
  };

  // Operations (steps, waits, invokes, callbacks)
  operations: OperationRecord[];

  // Truncation markers — present only when the size limiter dropped data
  truncated?: boolean; // true when data was dropped to fit maxRecordSizeBytes
  droppedOperations?: number; // count of whole operations dropped
  droppedInput?: boolean; // true if execution input was dropped (last resort)
  droppedOutput?: boolean; // true if execution output was dropped (last resort)
}

interface OperationRecord {
  id: string; // Stable hash ID (same across replays)
  name?: string; // Customer-provided name (from step("name", fn))
  type: string; // STEP | WAIT | CALLBACK | CHAINED_INVOKE | CONTEXT
  subType?: string; // Additional categorization
  parentId?: string; // Parent operation ID (for child contexts)
  status: string; // STARTED | SUCCEEDED | FAILED | PENDING | CANCELLED
  startTime?: string; // ISO-8601
  endTime?: string; // ISO-8601
  durationMs?: number; // Operation duration
  attempt?: number; // Retry attempt count
  error?: {
    // Per-operation error
    name: string;
    message: string;
  };
  truncated?: boolean; // true if the size limiter dropped this operation's result
}
```

### Example Record

```json
{
  "recordType": "WorkflowInsight",
  "schemaVersion": "1.0",
  "emittedAt": "2026-06-16T17:00:27.514Z",
  "executionArn": "arn:aws:lambda:us-east-1:123456789012:function:order-processor:$LATEST/durable-execution/abc123/inv456",
  "executionName": "abc123",
  "functionName": "order-processor",
  "functionQualifier": "$LATEST",
  "region": "us-east-1",
  "accountId": "123456789012",
  "status": "SUCCEEDED",
  "startTime": "2026-06-16T17:00:22.100Z",
  "endTime": "2026-06-16T17:00:27.514Z",
  "durationMs": 5414,
  "input": { "orderId": "order-12345", "customerId": "cust-789" },
  "output": {
    "orderId": "order-12345",
    "status": "completed",
    "charged": 99.99
  },
  "operations": [
    {
      "id": "c4ca4238a0b92382",
      "name": "validate-order",
      "type": "STEP",
      "subType": "Step",
      "status": "SUCCEEDED",
      "startTime": "2026-06-16T17:00:22.200Z",
      "endTime": "2026-06-16T17:00:22.450Z",
      "durationMs": 250
    },
    {
      "id": "c81e728d9d4c2f63",
      "name": "check-inventory",
      "type": "STEP",
      "subType": "Step",
      "status": "SUCCEEDED",
      "startTime": "2026-06-16T17:00:22.450Z",
      "endTime": "2026-06-16T17:00:22.800Z",
      "durationMs": 350
    },
    {
      "id": "eccbc87e4b5ce2fe",
      "name": "cool-down",
      "type": "WAIT",
      "subType": "Wait",
      "status": "SUCCEEDED",
      "startTime": "2026-06-16T17:00:22.800Z",
      "endTime": "2026-06-16T17:00:27.800Z",
      "durationMs": 5000
    },
    {
      "id": "a87ff679a2f3e71d",
      "name": "charge-payment",
      "type": "STEP",
      "subType": "Step",
      "status": "SUCCEEDED",
      "startTime": "2026-06-16T17:00:27.400Z",
      "endTime": "2026-06-16T17:00:27.480Z",
      "durationMs": 80
    }
  ]
}
```

## Installation

```bash
npm install @aws/durable-execution-sdk-js-insight
```

**Requirements:**

- Node.js ≥ 22
- `@aws/durable-execution-sdk-js` ≥ 2.0.0-alpha.1 (peer dependency)
- Lambda runtime: `nodejs22.x` or later

Exporter-specific AWS SDK packages (e.g., `@aws-sdk/client-s3`) are **optional peer dependencies** — they're already available in the Lambda runtime, so you don't need to install them. They're only needed if you bundle your own dependencies or run outside Lambda.

## Quick Start

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { workflowInsight } from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({});

export const handler = withDurableExecution(
  async (event, context) => {
    const result = await context.step("process", async () => doWork(event));
    return result;
  },
  { plugins: [insight] },
);
```

That's it. With zero configuration, insight records appear in your function's own CloudWatch log group as JSON (via the default `LambdaLogExporter`). No extra IAM permissions, no infrastructure to set up.

## Configuration

```typescript
const insight = workflowInsight({
  // When to emit records (default: "on-complete")
  emitMode: "on-complete",

  // Sampling rate: 0.0–1.0 (default: 1.0 = all executions)
  samplingRate: 1.0,

  // Where to send records (default: [new LambdaLogExporter()])
  exporters: [new LambdaLogExporter()],

  // Control what data is included (default: include everything)
  content: { ... },
});
```

### `emitMode`

| Mode                      | Behavior                                                    | Use case                                              |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `"on-complete"` (default) | Emit one record when execution completes (SUCCEEDED/FAILED) | Low overhead; sufficient for post-hoc analysis        |
| `"on-change"`             | Emit on every operation change + at end                     | Real-time monitoring; see executions as they progress |
| `"on-failure"`            | Emit one record only when execution ends in FAILED          | Lowest overhead; error-focused alerting and triage    |

### `samplingRate`

A number between 0 and 1 (default `1.0` = every execution). When below 1.0, only a fraction of executions emit records; the rest are skipped entirely — no records and no exporter calls.

```typescript
samplingRate: 0.1, // Only 10% of executions emit records
```

The decision is **per-execution and all-or-nothing**: a sampled-in execution emits all of its records, a sampled-out execution emits none — you never get fragmented partial data. It is **deterministic across replays**: the decision is derived from a hash of the execution ARN, which is stable across replays, so a resumed execution always reaches the same decision. Values outside `[0, 1]` or non-numeric values are clamped/defaulted to `1.0` with a warning.

### `exporters`

An array of destinations. Records are sent to **all** exporters in parallel. If one fails, others still receive the record. Exporter errors never fail the execution.

```typescript
exporters: [
  new S3Exporter({ bucket: "my-bucket" }),
  new DynamoDBExporter({ tableName: "insight" }),
  new OTelExporter({ endpoint: "https://otlp.vendor.com/v1/logs" }),
],
```

### `content` (advanced)

Control what data is included in records. By default, execution input/output are
included as-is, per-operation errors are included, and operation results are
**not** included. Use `content` to redact/reshape input/output, opt specific
operation results in (with optional transforms), exclude operations, or drop
operation errors:

```typescript
content: {
  // Include/exclude/transform execution input
  input: true,                          // include as-is (default)
  input: false,                         // exclude
  input: (i) => ({ id: i.orderId }),    // transform (redact sensitive fields)

  // Same for output
  output: true,

  // Operation-level control
  operations: {
    includeErrors: true,                // include per-operation errors (default)
    overrides: [
      { operationName: "charge-payment", result: (r) => ({ amount: r.amount }) },
      { operationName: "internal-log", exclude: true },
    ],
  },
},
```

> **Note:** operation overrides are matched by `operationName`. If multiple
> override entries (or multiple operations) share a name, the last matching
> entry wins.

> [!IMPORTANT]
> **Operation `result` reflects the checkpointed, serialized value — not
> necessarily your original return value.** The plugin passes your `result`
> transform the operation's checkpointed result, JSON-parsed when it is valid
> JSON and otherwise the raw string. It does **not** run your SDK
> `Serdes.deserialize`. If the operation uses a custom `Serdes` — one that
> serializes to a non-JSON format (e.g. XML), encrypts, or offloads large values
> to external storage and checkpoints only a **pointer/filepath** (overflow
> mode) — your transform receives that serialized form or pointer, not the
> original deserialized object. Only enable operation results for operations
> using the default JSON serialization, or whose serialized form your transform
> can handle. Input/output transforms are not affected by this.

## Querying by operation name (`operationsByName`)

`operations` is a canonical **array** — lossless (it keeps every occurrence of a
repeated step name), and queryable in the analytical stores that support nested
data (Athena `UNNEST`, Postgres/Redshift JSON path, OpenSearch `nested`):

```sql
-- Postgres (JSONB): executions where "convert_data" ran under 5s
WHERE record_json @? '$.operations[*] ? (@.name == "convert_data" && @.durationMs < 5000)';
```

Point-access stores that can't filter "the array element named X" —
**CloudWatch Logs** (`LambdaLogExporter`, `CloudWatchLogsExporter`) and
**DynamoDB** (`DynamoDBExporter`) — emit an `operationsByName` map **instead of
the `operations` array**, so name-based queries become a simple dot-path (these
stores trade the per-occurrence array detail for queryability):

```
# CloudWatch Logs Insights
fields executionArn | filter operationsByName.convert_data.maxDurationMs < 5000
```

Each entry aggregates metrics across all occurrences of the name; `result`/`error`
are kept only when the name ran exactly once:

```json
"operationsByName": {
  "insert_to_db": {
    "type": "STEP", "subType": "Step",
    "count": 1, "minDurationMs": 6200, "maxDurationMs": 6200, "totalDurationMs": 6200,
    "failedCount": 0, "maxAttempt": 1,
    "status": "SUCCEEDED",
    "result": { "rows": 1200 }
  }
}
```

Notes:

- **Metrics** (`count`, `min`/`max`/`totalDurationMs`, `failedCount`, `maxAttempt`)
  span all occurrences; `type`/`subType`/`status` reflect the most recently seen
  occurrence.
- **`result`/`error` are included only when the name occurs exactly once.** For a
  repeated name (loops/retries/map) they're dropped — there's no single
  representative value — but `failedCount` still flags failures.
- Operations **without a name are excluded** (they can't be keyed or queried).
- **Choosing store-safe operation names is your responsibility.** Names are used
  verbatim as keys/identifiers — the library never sanitizes or escapes them. Any
  character your target store treats specially (e.g. `.` in CloudWatch Logs
  Insights / OpenSearch field paths, reserved or quoting characters in
  DynamoDB attribute names and SQL identifiers, etc.) can make an operation hard
  or impossible to query there. Stick to simple, portable names — letters,
  digits, `-`, `_` — to stay safe across destinations.
- The array remains the source of truth; array-native exporters (S3/Athena,
  OpenSearch, Aurora, Redshift) emit only the array. See
  [`docs/operations-shape.md`](./docs/operations-shape.md).

## Record size & truncation

Destinations cap payload size (CloudWatch Logs events at 256 KB, DynamoDB items
at 400 KB, etc.). Each exporter carries a `maxRecordSizeBytes`; when a record's
serialized JSON exceeds it, the plugin truncates a **per-exporter copy**
(best-effort) before sending — the same record can go out full to one exporter
and trimmed to another.

Drop order, until the record fits:

1. operation `result` fields, **oldest operation first**;
2. whole operations, **oldest first**;
3. as a last resort (once every operation is gone), execution `input`, then
   `output`.

Identity/timeline fields are **never** dropped, and `input`/`output` are dropped
only after all operations are gone — so prefer `content.input` /
`content.output` transforms to bound them earlier (those run before truncation).
When anything is dropped, the emitted record carries `truncated: true`; each
operation whose result was dropped is itself marked `truncated: true`, and
`droppedOperations` (count), `droppedInput` / `droppedOutput` flags are set as
applicable — so a trimmed record is always distinguishable from a complete one
("cut, not missing").

The size check measures the **exact shape each exporter emits**, not just the
canonical record. Exporters that reshape operations (the `operationsByName`
expansion used by CloudWatch Logs / DynamoDB / Lambda log, or the `"both"`
format) expose a `render` the limiter sizes against, so a record trimmed to its
limit reflects what is actually serialized. This bounds the serialized record
_body_; it does not model the destination wire envelope (DynamoDB type
descriptors, CloudWatch Logs event framing, gzip, etc.) — which is why the
first-party defaults below sit under each destination's hard limit to leave
headroom.

Per-exporter defaults (override via each exporter's `maxRecordSizeBytes`):

| Exporter(s)                                   | Default |
| --------------------------------------------- | ------- |
| Lambda log, CloudWatch Logs, SQS, EventBridge | 256 KB  |
| DynamoDB                                      | 400 KB  |
| Aurora, Redshift, Firehose, OTel              | 1 MB    |
| S3                                            | 5 MB    |
| OpenSearch                                    | 10 MB   |
| HTTP, File                                    | none¹   |

¹ No default — truncation is disabled unless you set `maxRecordSizeBytes`.

## Exporters

### Comparison Table

| Exporter                 | Destination                     | Upsert        | Query Method     | Setup              | Best For                            |
| ------------------------ | ------------------------------- | ------------- | ---------------- | ------------------ | ----------------------------------- |
| `LambdaLogExporter`      | Function's CloudWatch log group | No            | Logs Insights    | None               | Getting started, zero-config        |
| `CloudWatchLogsExporter` | Any CloudWatch log group        | No            | Logs Insights    | Log group + IAM    | Centralized logging, cross-function |
| `S3Exporter`             | Amazon S3                       | Yes (by key)  | Athena SQL       | Bucket             | Analytics, long-term retention      |
| `DynamoDBExporter`       | Amazon DynamoDB                 | Configurable  | GetItem / Query  | Table              | Fast lookups by execution           |
| `AuroraExporter`         | Aurora MySQL/PostgreSQL         | Yes (UPSERT)  | SQL              | Cluster + Data API | Relational queries, joins           |
| `RedshiftExporter`       | Amazon Redshift                 | Yes (MERGE)   | SQL              | Cluster/Serverless | Large-scale analytics               |
| `OpenSearchExporter`     | Amazon OpenSearch               | Yes (by \_id) | Full-text / DSL  | Domain             | Search, dashboards                  |
| `FirehoseExporter`       | Kinesis Firehose → anywhere     | N/A           | Depends on dest. | Delivery stream    | Fan-out to S3/Redshift/Splunk       |
| `EventBridgeExporter`    | Amazon EventBridge              | N/A           | Rules/patterns   | Event bus          | Event-driven reactions              |
| `SQSExporter`            | Amazon SQS                      | N/A           | Consumer         | Queue              | Decoupled processing                |
| `OTelExporter`           | Any OTLP backend                | N/A           | Varies           | Endpoint           | Third-party observability           |
| `HttpExporter`           | Any HTTP endpoint               | N/A           | N/A              | URL                | Custom backends, webhooks           |
| `FileExporter`           | Filesystem (EFS/mount)          | Configurable  | File read        | Directory          | Local dev, EFS persistence          |

---

### Destination Setup

Before using an exporter, you need to create the target resource and grant your Lambda function the required permissions. Below is what each exporter needs.

#### LambdaLogExporter

**No setup required.** Uses the function's own CloudWatch log group (automatically created by Lambda).

#### CloudWatchLogsExporter

**Resource:** A CloudWatch log group.

```bash
aws logs create-log-group --log-group-name /custom/workflow-insight
aws logs put-retention-policy --log-group-name /custom/workflow-insight --retention-in-days 30
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
  "Resource": "arn:aws:logs:*:*:log-group:/custom/workflow-insight:*"
}
```

#### S3Exporter

**Resource:** An S3 bucket.

```bash
aws s3 mb s3://my-insight-bucket --region us-east-1
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-insight-bucket/workflow-insight/*"
}
```

**Optional (for Athena queries):** Create a Glue table or run a crawler over the prefix. The Hive-style partitioning (`year=YYYY/month=MM/day=DD/`) is auto-discovered by crawlers and `MSCK REPAIR TABLE`.

#### DynamoDBExporter

**Resource:** A DynamoDB table with the partition key (and optional sort key) matching your config.

```bash
# With sort key (full history per execution)
aws dynamodb create-table \
  --table-name workflow-insight \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Without sort key (upsert only)
aws dynamodb create-table \
  --table-name workflow-insight \
  --attribute-definitions AttributeName=pk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": "dynamodb:PutItem",
  "Resource": "arn:aws:dynamodb:*:*:table/workflow-insight"
}
```

#### AuroraExporter

**Resource:** An Aurora cluster with the **Data API enabled** and a Secrets Manager secret for credentials.

**Table creation (PostgreSQL):**

```sql
CREATE TABLE workflow_insight (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json TEXT,
  emitted_at VARCHAR(30)
);
```

**Table creation (MySQL):**

```sql
CREATE TABLE workflow_insight (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json LONGTEXT,
  emitted_at VARCHAR(30)
);
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": ["rds-data:ExecuteStatement", "secretsmanager:GetSecretValue"],
  "Resource": [
    "arn:aws:rds:*:*:cluster:my-cluster",
    "arn:aws:secretsmanager:*:*:secret:my-db-creds-*"
  ]
}
```

**Network:** No VPC required — the Data API is an HTTP endpoint. Your Lambda does NOT need to be in the Aurora VPC.

#### RedshiftExporter

**Resource:** A Redshift Serverless workgroup or provisioned cluster.

**Table creation:**

```sql
CREATE TABLE public.workflow_insight (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json VARCHAR(MAX),
  emitted_at VARCHAR(30)
);
```

**IAM policy (Serverless):**

```json
{
  "Effect": "Allow",
  "Action": [
    "redshift-data:ExecuteStatement",
    "redshift-serverless:GetCredentials"
  ],
  "Resource": "*"
}
```

**IAM policy (Provisioned with Secrets Manager):**

```json
{
  "Effect": "Allow",
  "Action": ["redshift-data:ExecuteStatement", "secretsmanager:GetSecretValue"],
  "Resource": [
    "arn:aws:redshift:*:*:cluster:my-cluster",
    "arn:aws:secretsmanager:*:*:secret:redshift-creds-*"
  ]
}
```

**Network:** No VPC required — the Redshift Data API is HTTP-based.

#### OpenSearchExporter

**Resource:** An Amazon OpenSearch Service domain (or self-managed cluster).

The index is auto-created on first write. No manual index creation needed (unless you want a custom mapping).

**IAM policy (SigV4 auth):**

```json
{
  "Effect": "Allow",
  "Action": "es:ESHttpPut",
  "Resource": "arn:aws:es:*:*:domain/my-domain/workflow-insight/*"
}
```

**Network:** If the OpenSearch domain is in a VPC, your Lambda must be in the same VPC (or a peered one) with a security group allowing HTTPS to the domain.

#### FirehoseExporter

**Resource:** A Kinesis Data Firehose delivery stream configured with your target destination (S3, Redshift, Splunk, HTTP endpoint, etc.).

```bash
aws firehose create-delivery-stream \
  --delivery-stream-name workflow-insight-stream \
  --s3-destination-configuration \
    RoleARN=arn:aws:iam::123456789012:role/firehose-role,\
    BucketARN=arn:aws:s3:::my-bucket,\
    Prefix=workflow-insight/
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": "firehose:PutRecord",
  "Resource": "arn:aws:firehose:*:*:deliverystream/workflow-insight-stream"
}
```

#### EventBridgeExporter

**Resource:** An EventBridge event bus (or use the `default` bus — no creation needed).

```bash
# Only if using a custom bus:
aws events create-event-bus --name workflow-insight-bus
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:*:*:event-bus/default"
}
```

**Example rule** (trigger SNS on failure):

```bash
aws events put-rule --name insight-failures \
  --event-pattern '{"source":["aws.durable-execution.insight"],"detail-type":["FAILED"]}'
aws events put-targets --rule insight-failures --targets Id=1,Arn=arn:aws:sns:...
```

#### SQSExporter

**Resource:** An SQS queue (standard or FIFO).

```bash
# Standard queue
aws sqs create-queue --queue-name workflow-insight-queue

# FIFO queue (content-based dedup enabled — exporter provides dedup IDs)
aws sqs create-queue --queue-name workflow-insight-queue.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false
```

**IAM policy:**

```json
{
  "Effect": "Allow",
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:*:*:workflow-insight-queue*"
}
```

#### OTelExporter

**Resource:** An OTLP-compatible endpoint (Datadog, Grafana Cloud, Splunk, New Relic, etc.). Setup varies by vendor.

**No IAM policy needed** — uses HTTPS to an external endpoint. Authentication is via headers (API key, bearer token) configured in the exporter.

**Network:** If the endpoint is external (internet), Lambda needs outbound internet access (default for non-VPC Lambdas, or NAT Gateway for VPC-attached Lambdas).

#### HttpExporter

**Resource:** Any HTTP endpoint that accepts JSON POSTs.

**No IAM policy needed.** Authentication is via custom headers.

**Network:** Same as OTelExporter — needs outbound access to the endpoint.

#### FileExporter

**Resource:** A writable directory. For Lambda:

- **EFS mount:** Attach an EFS file system to your Lambda function via an access point.
- **S3 File Gateway:** Mount an S3-backed NFS share.
- **`/tmp`:** Ephemeral (512MB–10GB), lost between invocations. Only for testing.

**EFS setup (summary):**

1. Create an EFS file system and access point
2. Add VPC config to your Lambda (same VPC as EFS)
3. Configure the file system in the Lambda function:
   ```bash
   aws lambda update-function-configuration \
     --function-name my-fn \
     --file-system-configs Arn=arn:aws:elasticfilesystem:...:access-point/fsap-...,LocalMountPath=/mnt/efs
   ```

**IAM policy (EFS):**

```json
{
  "Effect": "Allow",
  "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
  "Resource": "arn:aws:elasticfilesystem:*:*:access-point/fsap-*"
}
```

**Network:** Lambda must be in the same VPC as the EFS file system.

---

### CDK Infrastructure (Automated Setup)

> **Note:** This CDK stack is designed for **getting started and testing**. It uses minimal configurations (single-AZ, no backups, `RemovalPolicy.DESTROY`) to keep costs low and teardown easy. For production, build your own infrastructure with proper security, redundancy, monitoring, and cost controls tailored to your workload.

Instead of creating resources manually, you can use the included CDK stack to deploy all destination infrastructure, IAM permissions, and an example Lambda function with a single command.

**Location:** `cdk/` directory within this package.

#### Quick Start

```bash
cd packages/aws-durable-execution-sdk-js-insight/cdk
npm install
npx cdk deploy
```

> The CDK package depends on the `@aws/durable-execution-sdk-js` and
> `@aws/durable-execution-sdk-js-insight` workspace packages (the example
> Lambda imports them). The `deploy`, `synth`, `test`, and `typecheck` scripts
> automatically build these dependencies first via a `build:deps` pre-step, so
> no manual ordering is required. (If you prefer to build manually, run
> `npm run build:deps`.)

#### Configuration (`cdk/config.json`)

Edit `config.json` to enable/disable destinations and configure settings:

```json
{
  "destinations": {
    "cloudwatchLogs": {
      "enabled": true,
      "logGroupName": "/workflow-insight/demo",
      "retentionDays": 30
    },
    "dynamodb": { "enabled": true, "tableName": "workflow-insight" },
    "aurora": {
      "enabled": true,
      "tableName": "workflow_insight",
      "databaseName": "postgres",
      "minCapacity": 0.5,
      "maxCapacity": 1
    },
    "s3": { "enabled": false, "bucketName": "workflow-insight-records" },
    "redshift": {
      "enabled": false,
      "namespaceName": "insight-namespace",
      "workgroupName": "insight-workgroup",
      "databaseName": "dev",
      "tableName": "workflow_insight",
      "schema": "public"
    },
    "opensearch": { "enabled": false, "domainName": "workflow-insight" },
    "firehose": {
      "enabled": false,
      "streamName": "workflow-insight",
      "bufferIntervalSeconds": 60,
      "bufferSizeMB": 1
    },
    "sqs": { "enabled": false, "queueName": "workflow-insight", "fifo": false },
    "eventbridge": { "enabled": false, "eventBusName": "default" }
  },
  "lambda": {
    "roleNames": [],
    "discoverDurableFunctions": false,
    "createExampleFunction": true,
    "autoInvoke": { "enabled": false, "rateMinutes": 5 }
  }
}
```

#### Lambda Settings

| Setting                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roleNames`                | Array of **existing** IAM role names to attach the Insight permissions policy to. Default: `[]` (empty). The example function's role is added automatically when `createExampleFunction` is `true`, so you can leave this empty to start. Add your own durable function roles here to grant them access.                                                                                                                                                                      |
| `discoverDurableFunctions` | When `true`, the CDK app lists all Lambda functions **at synth time** and identifies durable functions by the presence of `DurableConfig` (the native Lambda API field). The Insight permissions policy is attached directly to their exact execution-role ARNs — no runtime Lambda or `iam:PutRolePolicy` grant is used. Requires AWS credentials at synth time (same model as CDK context lookups), and `cdk synth`/`deploy` will reflect the account state at that moment. |
| `createExampleFunction`    | Deploys an insurance claim processing workflow (with retry policies and random transient failures) pre-configured with the Insight plugin pointing to all enabled destinations                                                                                                                                                                                                                                                                                                |
| `autoInvoke.enabled`       | Deploys a dispatcher Lambda + EventBridge rule that invokes the example function on a schedule with randomized input. **Default: `false`.** Enabling creates ongoing costs (Lambda invocations, Aurora ACU time, DynamoDB writes). Disable or destroy the stack when not actively testing.                                                                                                                                                                                    |
| `autoInvoke.rateMinutes`   | How often the dispatcher triggers (default: 5 minutes)                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### What Gets Deployed

When `createExampleFunction` and `autoInvoke` are both enabled, the stack creates:

1. **Destination resources** — tables, clusters, queues, etc. for each enabled destination
2. **IAM policy** — a single managed policy (`WorkflowInsightDestinations`) attached to all target roles
3. **Example function** (`insight-example-workflow`) — a 6-step insurance claim workflow with:
   - Retry policy (4 attempts, 1s initial backoff, coefficient 2, max 5s)
   - ~30% random transient failure rate per step (generates retry attempt data)
   - Three possible outcomes: APPROVED, REJECTED, or MORE_DOCUMENTS_REQUIRED
4. **Dispatcher** (`insight-example-dispatcher`) — generates random claims with: `customerName`, `insuranceClaimNumber`, `claimAmount`, `claimType`
5. **EventBridge rule** (`insight-example-dispatch`) — triggers the dispatcher every N minutes

After deployment, data starts flowing automatically to all enabled destinations.

#### Aurora Table Auto-Creation

When Aurora is enabled, the stack deploys a custom resource that creates the `workflow_insight` table automatically via the RDS Data API. No manual SQL needed.

#### Tear Down

```bash
npx cdk destroy
```

This removes all created resources (tables, clusters, functions, rules). Resources use `RemovalPolicy.DESTROY` by default for clean teardown.

---

### Exporter Usage & Examples

Detailed configuration, code examples, and use-case guidance for each exporter.

### LambdaLogExporter (default)

Writes records to stdout via `console.log`. Since Lambda captures stdout to the function's CloudWatch log group, this requires **zero IAM permissions** and **zero setup**.

```typescript
import {
  workflowInsight,
  LambdaLogExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [new LambdaLogExporter()],
});
```

**When to use:** Getting started, quick debugging, or when you already query CloudWatch Logs. This is the default if you don't specify `exporters`.

---

### CloudWatchLogsExporter

Writes records to a **specific** CloudWatch log group via `PutLogEvents`. Unlike `LambdaLogExporter`, you control the destination and can centralize records from multiple functions.

```typescript
import {
  workflowInsight,
  CloudWatchLogsExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new CloudWatchLogsExporter({
      logGroupName: "/custom/workflow-insight",
      logStreamPrefix: "workflow-insight/", // optional (default)
      region: "us-east-1", // optional
    }),
  ],
});
```

**Log stream pattern:** `{prefix}{YYYY}/{MM}/{DD}` (one per day, auto-created).

**IAM required:** `logs:CreateLogStream`, `logs:PutLogEvents` on the target log group.

**When to use:** Centralizing insight data from multiple functions into one queryable log group.

---

### S3Exporter

Writes records as JSON objects to Amazon S3 with Hive-style partitioning for Amazon Athena compatibility.

```typescript
import {
  workflowInsight,
  S3Exporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new S3Exporter({
      bucket: "my-insight-bucket",
      prefix: "workflow-insight/", // optional (default)
      partitioning: "date", // "date" | "function-name" | "none" (default: "date")
      region: "us-east-1", // optional
    }),
  ],
});
```

**S3 key pattern (date):** `workflow-insight/year=2026/month=06/day=16/{executionName}.json`

**Upsert behavior:** Uses `executionName` as the object key — subsequent updates to the same execution overwrite the same file.

**IAM required:** `s3:PutObject` on the bucket/prefix.

**When to use:** Long-term retention, Athena queries, or feeding data into a data lake.

---

### DynamoDBExporter

Writes records to DynamoDB via `PutItem`.

```typescript
import {
  workflowInsight,
  DynamoDBExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new DynamoDBExporter({
      tableName: "workflow-insight",
      partitionKey: "pk", // optional (default: "pk"), value = executionArn
      sortKey: "sk", // optional (default: "sk"), value = emittedAt
      region: "us-east-1", // optional
    }),
  ],
});
```

**Upsert behavior:**

- With sort key (default): each emission creates a new item → full history per execution
- Without sort key (`sortKey: undefined`): PutItem overwrites → only latest state kept

**IAM required:** `dynamodb:PutItem` on the table.

**When to use:** Fast lookups by execution ARN, or building real-time dashboards backed by DynamoDB.

---

### AuroraExporter

Writes records to Aurora MySQL or PostgreSQL via the **RDS Data API** (no VPC needed).

```typescript
import {
  workflowInsight,
  AuroraExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new AuroraExporter({
      resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:my-cluster",
      secretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:db-creds",
      database: "workflows",
      table: "workflow_insight", // optional (default)
      engine: "postgresql", // "postgresql" | "mysql"
      region: "us-east-1", // optional
    }),
  ],
});
```

**Upsert behavior:** `INSERT ... ON CONFLICT DO UPDATE` (PostgreSQL) or `INSERT ... ON DUPLICATE KEY UPDATE` (MySQL) by `execution_arn`.

**IAM required:** `rds-data:ExecuteStatement`, `secretsmanager:GetSecretValue`.

**Table schema:**

```sql
CREATE TABLE workflow_insight (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json TEXT,
  emitted_at VARCHAR(30)
);
```

**When to use:** Relational queries, joins with other business data, or teams already on Aurora.

---

### RedshiftExporter

Writes records to Amazon Redshift via the **Redshift Data API**.

```typescript
import {
  workflowInsight,
  RedshiftExporter,
} from "@aws/durable-execution-sdk-js-insight";

// Redshift Serverless
const insight = workflowInsight({
  exporters: [
    new RedshiftExporter({
      workgroupName: "my-workgroup",
      database: "workflows",
      table: "workflow_insight", // optional (default)
      schema: "public", // optional (default)
      region: "us-east-1", // optional
    }),
  ],
});

// Provisioned cluster
const insight2 = workflowInsight({
  exporters: [
    new RedshiftExporter({
      clusterIdentifier: "my-cluster",
      database: "workflows",
      secretArn: "arn:aws:secretsmanager:...:secret:redshift-creds",
    }),
  ],
});
```

**Upsert behavior:** Uses `MERGE` to insert or update by `execution_arn`.

**IAM required:** `redshift-data:ExecuteStatement` (+ `redshift-serverless:GetCredentials` or `redshift:GetClusterCredentialsWithIAM`).

**When to use:** Large-scale cross-function analytics, BI dashboards, data warehouse integration.

**Note:** The `record_json` column uses Redshift's SUPER type with `JSON_PARSE()` for navigable nested queries. SUPER values are limited to ~1 MB — executions with unusually large input/output payloads may fail the insert.

---

### OpenSearchExporter

Indexes records to Amazon OpenSearch Service for full-text search and dashboards.

```typescript
import {
  workflowInsight,
  OpenSearchExporter,
} from "@aws/durable-execution-sdk-js-insight";

// Amazon OpenSearch Service (IAM auth)
const insight = workflowInsight({
  exporters: [
    new OpenSearchExporter({
      endpoint: "https://my-domain.us-east-1.es.amazonaws.com",
      indexName: "workflow-insight", // optional (default)
      region: "us-east-1",
      auth: "sigv4", // optional (default)
    }),
  ],
});

// Basic auth (self-managed)
const insight2 = workflowInsight({
  exporters: [
    new OpenSearchExporter({
      endpoint: "https://opensearch.internal:9200",
      region: "us-east-1",
      auth: "basic",
      username: "admin",
      password: process.env.OS_PASSWORD!,
    }),
  ],
});
```

**Upsert behavior:** Document `_id` = `executionArn` — updates overwrite.

**IAM required (SigV4):** `es:ESHttpPut` on the domain.

**When to use:** Full-text search across executions, OpenSearch Dashboards/Kibana visualizations, complex filtering.

---

### FirehoseExporter

Sends records to Amazon Kinesis Data Firehose for delivery to S3, Redshift, Splunk, or any HTTP endpoint.

```typescript
import {
  workflowInsight,
  FirehoseExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new FirehoseExporter({
      deliveryStreamName: "workflow-insight-stream",
      region: "us-east-1", // optional
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});
```

**Format:** Newline-delimited JSON (NDJSON) — when Firehose batches records into S3 objects, they remain parseable.

**IAM required:** `firehose:PutRecord` on the delivery stream.

**When to use:** Fan-out to multiple destinations via one Firehose stream, buffered S3 delivery, or integration with Splunk/Datadog via Firehose HTTP endpoints.

---

### EventBridgeExporter

Publishes records to Amazon EventBridge for event-driven reactions.

```typescript
import {
  workflowInsight,
  EventBridgeExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new EventBridgeExporter({
      eventBusName: "default", // optional (default)
      source: "aws.durable-execution.insight", // optional (default)
      region: "us-east-1", // optional
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});
```

**Event structure:**

- Source: `aws.durable-execution.insight`
- DetailType: `SUCCEEDED` | `FAILED` | `RUNNING`
- Detail: full record JSON

**Example rule pattern:**

```json
{ "source": ["aws.durable-execution.insight"], "detail-type": ["FAILED"] }
```

**IAM required:** `events:PutEvents` on the event bus.

**When to use:** Triggering notifications on failure, starting remediation workflows, fan-out to multiple consumers without coupling.

---

### SQSExporter

Sends records to Amazon SQS (standard or FIFO).

```typescript
import {
  workflowInsight,
  SQSExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new SQSExporter({
      queueUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/insight-queue.fifo",
      messageGroupId: undefined, // optional (default: executionArn)
      region: "us-east-1", // optional
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});
```

**FIFO support:** Auto-detected from `.fifo` URL suffix. Dedup ID = `executionArn:emittedAt`. Message attributes include `status` and `functionName` for SQS message filtering.

**IAM required:** `sqs:SendMessage` on the queue.

**When to use:** Guaranteed single-consumer delivery, decoupling export processing from the Lambda invocation, ordered processing (FIFO).

---

### OTelExporter

Emits records as OpenTelemetry log records via OTLP HTTP/JSON. Compatible with any OTLP backend (Datadog, Grafana, Splunk, New Relic, Honeycomb, etc.).

```typescript
import {
  workflowInsight,
  OTelExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new OTelExporter({
      endpoint: "https://otlp.datadoghq.com/v1/logs",
      headers: { "DD-API-KEY": process.env.DD_API_KEY! },
      protocol: "http/json", // optional (default)
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});
```

**OTel mapping:**

- Resource: `service.name`, `cloud.region`, `cloud.account.id`, `faas.name`, `faas.version`
- Log attributes: `workflow.execution_arn`, `workflow.status`, `workflow.duration_ms`
- Log body: full record JSON. `operationsFormat` controls how operations appear
  in the body — the `operations` array (default), the `operationsByName` map, or
  both. (Operations are only in the body, never attributes, so this never affects
  attribute cardinality.)
- Severity: ERROR for FAILED, INFO otherwise

**No dependencies** — uses native `fetch`.

**When to use:** Sending data to third-party observability platforms that support OTLP, unified observability across services.

---

### HttpExporter

Generic HTTP/Webhook exporter. POSTs (or PUTs) the full record as JSON to any URL.

```typescript
import {
  workflowInsight,
  HttpExporter,
} from "@aws/durable-execution-sdk-js-insight";

const insight = workflowInsight({
  exporters: [
    new HttpExporter({
      url: "https://my-service.example.com/ingest",
      headers: { Authorization: "Bearer " + process.env.TOKEN },
      method: "POST", // optional (default)
      timeoutMs: 5000, // optional (default: 10000)
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});
```

**No dependencies** — uses native `fetch` with configurable timeout.

`operationsFormat` controls how operations are rendered in the posted body:
the canonical `operations` array (default), the name-keyed `operationsByName`
map, or both — pick what your endpoint consumes.

**When to use:** Custom backends, internal microservices, SaaS integrations without dedicated exporters, prototyping.

---

### FileExporter

Writes records to the filesystem — EFS mounts, S3 File Gateway, or any writable path.

```typescript
import {
  workflowInsight,
  FileExporter,
} from "@aws/durable-execution-sdk-js-insight";

// Append to daily NDJSON files on EFS
const insight = workflowInsight({
  exporters: [
    new FileExporter({
      directory: "/mnt/efs/workflow-insight",
      mode: "ndjson", // optional (default)
      operationsFormat: "array", // optional: "array" (default) | "by-name" | "both"
    }),
  ],
});

// One JSON file per execution (upsert)
const insight2 = workflowInsight({
  exporters: [
    new FileExporter({
      directory: "/mnt/efs/workflow-insight",
      mode: "json",
    }),
  ],
});
```

**Modes:**

- `"ndjson"` (default): appends to `{YYYY-MM-DD}.ndjson` — good for bulk processing
- `"json"`: one file per execution (`{executionName}.json`) — overwrites on update

**No AWS SDK dependencies** — uses `node:fs/promises`.

**When to use:** Lambda with EFS mount, local development/testing, S3 File Gateway integration.

---

## Multiple Exporters

You can use multiple exporters simultaneously. Records are sent to all of them in parallel:

```typescript
const insight = workflowInsight({
  exporters: [
    new S3Exporter({ bucket: "insight-archive" }), // Long-term storage
    new DynamoDBExporter({ tableName: "insight-live" }), // Fast lookups
    new EventBridgeExporter({}), // Trigger alerts
  ],
  emitMode: "on-change",
});
```

## Custom Exporters

Implement the `InsightExporter` interface to build your own:

```typescript
import {
  InsightExporter,
  WorkflowInsightRecord,
} from "@aws/durable-execution-sdk-js-insight";

class MyExporter implements InsightExporter {
  // Optional: opt into size-based truncation. When set, the plugin sends this
  // exporter a copy trimmed to fit (drops operation results, then whole
  // operations oldest-first, then execution input/output as a last resort) and
  // sets `truncated: true` on it. Omit to receive full records.
  readonly maxRecordSizeBytes = 256_000;

  async export(record: WorkflowInsightRecord): Promise<void> {
    // Send record wherever you want
  }

  async flush?(): Promise<void> {
    // Optional: flush any buffered data before the invocation returns
  }
}
```

## Handling Backend-Initiated Events (STOPPED, TIMED_OUT)

The Workflow Insight plugin runs **inside your Lambda function**. This means it can only emit records when the function is invoked. Events that originate from the backend — such as `STOPPED` (manual stop) or `TIMED_OUT` (execution timeout exceeded) — happen **without a Lambda invocation**, so the plugin cannot capture them.

To get complete lifecycle coverage, subscribe to Lambda's durable execution lifecycle events via **Amazon EventBridge** and update your destination accordingly.

### Step 1: Create a handler that updates your destination

```typescript
// lifecycle-handler.ts
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME!;

export const handler = async (event: {
  detail: {
    executionArn: string;
    status: string; // "STOPPED" | "TIMED_OUT"
    timestamp: string;
  };
}) => {
  const { executionArn, status, timestamp } = event.detail;

  // Update the existing insight record in DynamoDB with the terminal status
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { pk: { S: executionArn } },
      UpdateExpression: "SET #s = :status, end_time = :ts",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":status": { S: status },
        ":ts": { S: timestamp },
      },
    }),
  );
};
```

### Step 2: Create the EventBridge rule

Lambda emits durable execution lifecycle events to the **default** event bus:

```bash
aws events put-rule \
  --name durable-execution-terminal-events \
  --event-pattern '{
    "source": ["aws.lambda"],
    "detail-type": ["Lambda Durable Execution State Change"],
    "detail": {
      "status": ["STOPPED", "TIMED_OUT"]
    }
  }'
```

### Step 3: Point the rule at your handler

```bash
aws events put-targets \
  --rule durable-execution-terminal-events \
  --targets Id=1,Arn=arn:aws:lambda:us-east-1:123456789012:function:lifecycle-handler
```

Grant EventBridge permission to invoke it:

```bash
aws lambda add-permission \
  --function-name lifecycle-handler \
  --statement-id eventbridge-lifecycle \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:123456789012:rule/durable-execution-terminal-events
```

### Step 4: For S3 / Aurora / Redshift destinations

The same pattern applies — the lifecycle handler reads the event and writes to your destination. For S3 you'd overwrite the execution's JSON file; for Aurora/Redshift you'd run an UPDATE on the `status` and `end_time` columns.

### What each status means

| Status    | Origin                                                              | Captured by plugin? | Captured by EventBridge? |
| --------- | ------------------------------------------------------------------- | ------------------- | ------------------------ |
| RUNNING   | Lambda invocation (incl. wait/suspend for timers & external events) | ✅ (on-change mode) | ❌                       |
| SUCCEEDED | Lambda invocation                                                   | ✅                  | ✅                       |
| FAILED    | Lambda invocation                                                   | ✅                  | ✅                       |
| STOPPED   | Backend (manual stop API)                                           | ❌                  | ✅                       |
| TIMED_OUT | Backend (ExecutionTimeout exceeded)                                 | ❌                  | ✅                       |

> **Tip:** If you use the `EventBridgeExporter` alongside this pattern, your
> plugin-emitted events (SUCCEEDED/FAILED) and the backend-emitted events
> (STOPPED/TIMED_OUT) can share the same rule or feed the same consumer —
> just adjust the event pattern to include both sources.

## How It Works

The plugin hooks into the durable execution lifecycle:

1. **`onInvocationStart`** — records execution start time
2. **`onOperationChange`** — (on-change mode) schedules export of a RUNNING snapshot
3. **`onInvocationEnd`** — schedules export of the snapshot, gated by `emitMode`: on terminal SUCCEEDED/FAILED (`on-complete`), FAILED only (`on-failure`), or every update including in-flight RUNNING snapshots (`on-change`)
4. **`wrapInvocation`** — drains all pending exports before the Lambda returns

Exports are **coalesced**: if updates arrive faster than the exporter can handle, intermediate snapshots are dropped (each record is a complete snapshot, so the latest one supersedes all earlier ones). This prevents overlapping export calls and keeps overhead minimal.

Exporter errors **never fail the execution**. If an exporter throws, the error is swallowed and other exporters still receive the record.

## License

Apache-2.0
