# @aws/durable-execution-sdk-js-lite-telemetry

A telemetry plugin for [`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
It builds one record per execution: the status, the times, the input, the output, the
error and the operations. It sends the record to your own exporter or to one of 13
built-in exporters:

- Amazon CloudWatch Logs
- the Lambda function's own log
- Amazon Aurora, PostgreSQL and MySQL
- Amazon DynamoDB
- Amazon S3
- Amazon SQS
- Amazon Data Firehose
- Amazon EventBridge
- Amazon Redshift
- Amazon OpenSearch Service
- OpenTelemetry logs
- HTTP
- a file

The record has the JSON shape of the records of
[`@aws/durable-execution-sdk-js-telemetry-exporter`](https://github.com/aws/aws-durable-execution-sdk-js/tree/main/packages/aws-durable-execution-sdk-js-telemetry-exporter).
The Aurora and Redshift tables have the same columns. So viewers of that package read
these records too.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## Requirements

- Node.js 22.12 or later.
- `@aws/durable-execution-sdk-js-lite`.

The package has no dependencies. The exporters for AWS services do not use the AWS SDK.
They sign and send their own requests. See [AWS requests](#aws-requests).

## Usage

```js
import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";
import { createTelemetryPlugin } from "@aws/durable-execution-sdk-js-lite-telemetry";
import { createAuroraExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/aurora";
import { createCloudWatchLogsExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/cloudwatch-logs";

// Created once per Lambda sandbox. Every invocation shares the exporters.
const telemetry = createTelemetryPlugin({
  exporters: [
    createCloudWatchLogsExporter({ logGroupName: "/durable/telemetry" }),
    createAuroraExporter({
      resourceArn: process.env.TELEMETRY_CLUSTER_ARN,
      secretArn: process.env.TELEMETRY_SECRET_ARN,
      database: "telemetry",
    }),
  ],
});

export const handler = withDurableExecution(workflow, { plugins: [telemetry] });
```

`createTelemetryPlugin` returns a plugin factory. The lite SDK calls the factory once per
invocation. Create the plugin at module level, so the exporters live for the life of the
sandbox.

Each exporter has its own import path:

```js
import { createAuroraExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/aurora";
import { createCloudWatchLogsExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/cloudwatch-logs";
import { createDynamoDBExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/dynamodb";
import { createEventBridgeExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/eventbridge";
import { createFileExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/file";
import { createFirehoseExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/firehose";
import { createHttpExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/http";
import { createLambdaLogExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/lambda-log";
import { createOpenSearchExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/opensearch";
import { createOtelLogsExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/otel-logs";
import { createRedshiftExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/redshift";
import { createS3Exporter } from "@aws/durable-execution-sdk-js-lite-telemetry/s3";
import { createSQSExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/sqs";
```

## Configuration

`createTelemetryPlugin(config)` takes these options:

| Option | Default | Meaning |
|---|---|---|
| `exporters` | required | An array of exporters. Each one receives every record. For the function's own log, pass `createLambdaLogExporter()`. See [Lambda log](#lambda-log). |
| `emitMode` | `"on-complete"` | When records are sent. See [Emit modes](#emit-modes). |
| `operations` | `"top-level"` | `"top-level"`: operations without a parent. `"all"`: every operation. `"none"`: no operations. |
| `includeInput` | `true` | Put the execution input in the record. |
| `includeOutput` | `true` | Put the workflow result in a SUCCEEDED record. |
| `samplingRate` | `1` | The fraction of executions that send records, from 0 to 1. |
| `exportTimeoutMs` | `3000` | The longest time the end of an invocation waits for the exports. |

## Emit modes

1. `"on-complete"`: one record when the execution ends with SUCCEEDED or FAILED. An
   invocation that suspends sends nothing.
2. `"on-failure"`: one record when the execution ends with FAILED. A successful
   execution sends nothing.
3. `"on-change"`: records while the execution runs. Each invocation sends:
   - one RUNNING record when it starts;
   - one RUNNING record after each checkpoint response that changed an operation;
   - one record when it ends. Its status is RUNNING when the invocation suspends or
     retries.

In `"on-change"` mode, the plugin starts each export at once. Each exporter receives the
records of one invocation one after the other, in the order the records were built. So an
exporter that replaces the row of an execution never replaces a newer record of the same
invocation with an older one. The exporters do not wait for each other. So a slow
exporter does not delay the records of another exporter. The end of the invocation waits
for all of them.

## Record format

The record follows `DurableExecutionTelemetryRecord` of the full SDK's exporter. The
[record schema](https://github.com/aws/aws-durable-execution-sdk-js/tree/main/packages/aws-durable-execution-sdk-js-telemetry-exporter#record-schema-durableexecutiontelemetryrecord)
describes each field. This package fills the fields as follows:

- `recordType`: `"DurableExecutionTelemetry"`. `schemaVersion`: `"1.0"`.
- `emittedAt`: when the record was built. It strictly increases within one invocation.
- `executionArn`: the `DurableExecutionArn`. `executionName`, `functionName`,
  `functionQualifier`, `region` and `accountId` come from the ARN. Its format is
  `arn:aws:lambda:REGION:ACCOUNT:function:NAME:QUALIFIER/durable-execution/EXECUTION_NAME/ID`.
- `status`: `"SUCCEEDED"`, `"FAILED"` or `"RUNNING"`. A suspended or retrying
  execution has not ended, so it is RUNNING.
- `startTime`: the start of the execution: the `StartTimestamp` of the `EXECUTION`
  record. It is not the start of the invocation.
- `endTime` and `durationMs`: only in a SUCCEEDED or FAILED record. `endTime` equals
  `emittedAt`.
- `input`: the execution input. `output`: the workflow result, in a SUCCEEDED record.
- `error`: in a FAILED record, `{ name, message }` from the execution's `ErrorType` and
  `ErrorMessage`.
- `operations`: one entry per operation, in start order, with `id`, `name`, `type`,
  `subType`, `parentId`, `status`, `startTime`, `endTime`, `durationMs`, `attempt` and
  `error`. `attempt` is `StepDetails.Attempt`, the number of finished attempts.
  `error` is `{ name, message }` from the operation's `Error`.
- `truncated`, `droppedInput`, `droppedOutput`, `droppedOperations`: present only when
  the plugin dropped data. See [Record size](#record-size).

Three kinds of operation never appear, as in the full SDK:

1. The `EXECUTION` record. The top level of the record already holds its status and
   times.
2. Operations without a name. No viewer can find them by name. So name every operation.
3. With `operations: "top-level"`, operations inside a child context, map or parallel.

An operation never has a `result`. The full SDK includes a result only when you opt in
for one operation name. This package has no such option.

Every timestamp in a lite SDK record is epoch seconds. The plugin writes every time in
the record as an ISO 8601 string in UTC with milliseconds, for example
`2026-10-23T18:42:40.243Z`.

`buildRecord(args)` builds a record from wire records. The plugin uses it. It is
exported for tests and custom exporters.

## Operations format

The SQS, Firehose, EventBridge, OpenTelemetry logs, HTTP and file exporters have the
option `operationsFormat`. It sets how the sent JSON holds the operations, as in the
full SDK:

- `"array"` (default): the record unchanged, with the `operations` array.
- `"by-name"`: `operationsByName` instead of `operations`. `operationsByName` maps each
  operation name to a summary. [CloudWatch Logs](#cloudwatch-logs) describes the summary.
- `"both"`: the `operations` array, and `operationsByName` added as the last field.

Any other value sends the record unchanged. The CloudWatch Logs, Lambda log and DynamoDB
exporters always send the `"by-name"` form. The other exporters always send the
`"array"` form.

The plugin measures the record with the `operations` array, before the exporter adds
`operationsByName`. With `"both"`, the sent JSON is larger than the measured record. So
with `"both"`, set `maxRecordBytes` below the destination's limit, with room for one
summary per operation name. See [Record size](#record-size).

## Exporters

### CloudWatch Logs

`createCloudWatchLogsExporter({ logGroupName, logStreamPrefix, region, endpoint, client, maxRecordBytes })`
writes each record as one log event.

- `logGroupName`: the log group. It must exist.
- `logStreamPrefix` (default `"durable-execution-telemetry/"`): the stream name is the
  prefix and the UTC date, for example `durable-execution-telemetry/2026/10/25`. So each
  day has a new stream.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://logs.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `256_000`): CloudWatch Logs limits an event to 256 KiB minus
  26 bytes.

The exporter calls the CloudWatch Logs API with the AWS JSON 1.1 protocol. Each call is
`POST /` with the header `x-amz-target`, for example `Logs_20140328.PutLogEvents`.

The exporter calls `CreateLogStream` once per stream. It ignores
`ResourceAlreadyExistsException`, because another sandbox can create the stream first.
It then calls `PutLogEvents` with one event per record.

The event message holds `operationsByName` instead of `operations`, as in the full SDK.
Logs Insights cannot select the array element with a given name. It can read a field
path. So `operationsByName` maps each operation name to a summary: `type`, `subType`,
`status`, `count`, `failedCount`, `minDurationMs`, `maxDurationMs`, `totalDurationMs`,
`maxAttempt` and `error`. `error` appears only for a name that occurs once.

```
fields executionArn, status, operationsByName.charge.status
| filter recordType = "DurableExecutionTelemetry" and status = "FAILED"
```

The function's execution role needs `logs:CreateLogStream` and `logs:PutLogEvents` on the
log group:

```json
{
  "Effect": "Allow",
  "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
  "Resource": "arn:aws:logs:REGION:ACCOUNT:log-group:/durable/telemetry:*"
}
```

### Lambda log

`createLambdaLogExporter({ maxRecordBytes })` writes each record with `console.log`.
Lambda sends the function's stdout to the function's own log group. So the exporter
needs no IAM permission, no client and no setup.

- `maxRecordBytes` (default `256_000`): CloudWatch Logs limits an event to 256 KiB.
  Lambda adds a prefix to each line. The default leaves room for it.

Each export writes one line: the record as JSON, with `operationsByName` instead of
`operations`, as the [CloudWatch Logs](#cloudwatch-logs) exporter writes it. The line has
no newline inside. So it is one log event. Logs Insights can then read fields such as
`operationsByName.charge.status`.

The export rejects only when `JSON.stringify` throws, for example for a `BigInt`, as in
the other exporters.

The line goes to the log group of the function, together with the function's other log
lines. To select the records, filter on `recordType = "DurableExecutionTelemetry"`. To
send the records to a separate log group, use [CloudWatch Logs](#cloudwatch-logs).

The full SDK uses this exporter when `exporters` is empty or absent. In this package,
`exporters` is required. So pass the exporter explicitly:

```js
import { createTelemetryPlugin } from "@aws/durable-execution-sdk-js-lite-telemetry";
import { createLambdaLogExporter } from "@aws/durable-execution-sdk-js-lite-telemetry/lambda-log";

const telemetry = createTelemetryPlugin({ exporters: [createLambdaLogExporter()] });
```

### Aurora

`createAuroraExporter({ resourceArn, secretArn, database, engine, table, region, endpoint, client, maxRecordBytes })`
keeps one row per execution in Aurora PostgreSQL or Aurora MySQL. It uses the RDS Data
API, so the function needs no VPC access and no database driver.

- `resourceArn`: the Aurora cluster. The cluster must have the Data API enabled. The Data
  API supports Aurora PostgreSQL 13.11, 14.8, 15.3 and later, and Aurora MySQL 3.07 and
  later.
- `secretArn`: the Secrets Manager secret with the database credentials.
- `database`: the database name.
- `engine` (default `"postgresql"`): `"postgresql"` or `"mysql"`. It selects the SQL of
  the upsert. Any other value means PostgreSQL.
- `table` (default `"durable_execution_telemetry"`): letters, digits and underscores,
  not starting with a digit. The name goes into the SQL text, because the Data API
  cannot bind a table name as a parameter. So the exporter throws at creation for any
  other name.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://rds-data.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `1_000_000`): the full SDK's limit for one statement.

Each export runs one `ExecuteStatement` with named parameters. The Data API uses the
REST-JSON protocol. So the call is `POST /Execute` with a JSON body. It inserts the row, or
updates `status`, `end_time`, `duration_ms`, `record_json` and `emitted_at` of the
existing row. The update keeps the row with the newer record:

1. An export that times out keeps running in the background.
2. Lambda can freeze it and continue it in a later invocation.
3. So an older record can arrive after a newer one.
4. So the update changes the row only when the stored `emitted_at` is not later than the
   record's `emitted_at`.

PostgreSQL has the condition `WHERE <table>.emitted_at <= EXCLUDED.emitted_at` on
`ON CONFLICT ... DO UPDATE`.

MySQL has no `WHERE` on `ON DUPLICATE KEY UPDATE`. So the statement names the new row
`excluded` (`INSERT ... VALUES (...) AS excluded`), and each assignment has the condition:

```sql
status = IF(<table>.emitted_at <= excluded.emitted_at, excluded.status, <table>.status)
```

MySQL runs the assignments from left to right. An assignment to `emitted_at` changes the
value that the later conditions read. So `emitted_at` is assigned last.

`createTableSql(table, { engine })` returns the statement that creates the table.
`engine` has the same default as the exporter's. The PostgreSQL schema is the schema of
the full SDK's CDK stack:

```sql
CREATE TABLE IF NOT EXISTS durable_execution_telemetry (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json JSONB,
  emitted_at TIMESTAMPTZ
)
```

The MySQL schema is the one in the full SDK's README:

```sql
CREATE TABLE IF NOT EXISTS durable_execution_telemetry (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json LONGTEXT,
  emitted_at VARCHAR(30)
)
```

The MySQL time columns hold text:

1. The exporter sends every time as `YYYY-MM-DDTHH:MM:SS.sssZ`, for both engines.
2. Every value has the same width and the same zone.
3. So text order equals time order, and the `emitted_at` condition compares text.
4. So a table created from the full SDK's README works with this exporter too.

To query a time as a MySQL `DATETIME(3)`, convert it:
`STR_TO_DATE(emitted_at, '%Y-%m-%dT%H:%i:%s.%fZ')`. `record_json` is text. MySQL JSON
functions such as `JSON_EXTRACT(record_json, '$.status')` accept it.

Run the statement once, for example with `aws rds-data execute-statement`.

The function's execution role needs `rds-data:ExecuteStatement` on the cluster and
`secretsmanager:GetSecretValue` on the secret:

```json
[
  {
    "Effect": "Allow",
    "Action": "rds-data:ExecuteStatement",
    "Resource": "arn:aws:rds:REGION:ACCOUNT:cluster:CLUSTER"
  },
  {
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:SECRET"
  }
]
```

An Aurora Serverless v2 cluster with a minimum of 0 ACUs pauses when idle. The Data API
then rejects requests with `DatabaseResumingException` until the cluster resumes. So the
records sent during that time are lost. The full SDK's CDK stack sets a minimum of 0.5
ACUs, so its cluster never pauses.

### DynamoDB

`createDynamoDBExporter({ tableName, partitionKey, sortKey, region, endpoint, client, maxRecordBytes })`
writes each record as one item.

- `tableName`: the table. It must exist.
- `partitionKey` (default `"pk"`): the partition key attribute. Its value is the
  `executionArn`.
- `sortKey` (default `"sk"`): the sort key attribute. Its value is `emittedAt`. `""`
  means no sort key.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://dynamodb.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `400_000`): DynamoDB limits an item to 400 KB.

Each export runs one `PutItem`. DynamoDB uses the AWS JSON 1.0 protocol. So the call is
`POST /` with the header `x-amz-target: DynamoDB_20120810.PutItem`.

The item holds the fields of the record as top-level attributes, as in the full SDK:

1. It holds `operationsByName` instead of `operations`, as the CloudWatch Logs event
   does. See [CloudWatch Logs](#cloudwatch-logs).
2. It also holds the partition key and the sort key. A record field with the same name
   as a key is replaced by the key.
3. Strings are `S`, numbers are `N`, booleans are `BOOL`, `null` is `NULL`, arrays are
   `L` and objects are `M`. An empty string stays `S`.
4. The values are the JSON values of the record, as in the other exporters. So an
   undefined field is absent. `NaN` and `Infinity` are `NULL`. A `Date` is its ISO
   string.

The sort key decides what the table keeps:

1. With a sort key, each record is a new item. So the table keeps every record of an
   execution. A query on the partition key returns them in `emittedAt` order.
2. With `sortKey: ""`, each record replaces the item of its execution. So the table
   keeps the last record that arrived. An older record can arrive after a newer one.
   See [Aurora](#aurora). PutItem has no condition, so that older record then replaces
   the newer one.

The table's key schema must match the options. Both keys are strings (`S`):

```bash
aws dynamodb create-table \
  --table-name durable-execution-telemetry \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

Without a sort key, leave out `sk` in both lists.

The function's execution role needs `dynamodb:PutItem` on the table:

```json
{
  "Effect": "Allow",
  "Action": "dynamodb:PutItem",
  "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/durable-execution-telemetry"
}
```

### S3

`createS3Exporter({ bucket, keyPrefix, partitioning, region, endpoint, client, maxRecordBytes })`
writes each record as one JSON object to a bucket.

- `bucket`: the bucket. It must exist. The exporter uses it only for the default
  endpoint.
- `keyPrefix` (default `"durable-execution-telemetry/"`): the start of every key. End it
  with `/`. Do not start it with `/`.
- `partitioning` (default `"date"`): `"date"`, `"function-name"` or `"none"`. See the key
  layout below.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://BUCKET.s3.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with
  `send({ method, path, headers, body })`. See [AWS requests](#aws-requests). With
  `client`, the exporter ignores `bucket`, `region` and `endpoint`.
- `maxRecordBytes` (default `5_000_000`): the full SDK's value. S3 accepts up to 5 GB in
  one PUT. So the limit only bounds the time and memory of one export.

The key is `keyPrefix`, then the partition, then the file name:

| `partitioning` | Partition | Example key |
|---|---|---|
| `"date"` | `year=YYYY/month=MM/day=DD/` | `durable-execution-telemetry/year=2026/month=03/day=04/order-42.json` |
| `"function-name"` | `function=NAME/` | `durable-execution-telemetry/function=checkout/order-42.json` |
| `"none"` | nothing | `durable-execution-telemetry/order-42.json` |

1. The date is the UTC date of `startTime`, the start of the execution. The month and the
   day have two digits.
2. The file name is `executionName` and `.json`. A record without `executionName` uses
   `executionArn` instead.
3. In the function name and the file name, every character other than letters, digits,
   `.`, `_` and `-` becomes `_`. So the `:` and `/` of an ARN never appear in the key.
4. `startTime` and `executionName` are the same in every record of one execution. So each
   record replaces the same object, and the object holds the newest record.

Each export makes one `PutObject` call: `PUT /KEY`, with the header
`content-type: application/json`. The exporter encodes each segment of the key with
RFC 3986, so `=` is sent as `%3D`. The body is the record as JSON on one line, with the
`operations` array, and without a trailing newline.

The full SDK's CDK stack creates a Glue table for Athena. The table's partition
projection reads `durable-execution-telemetry/year=${year}/month=${month}/day=${day}`.
The default `keyPrefix` and `partitioning` write that layout. So Athena queries the
objects of this exporter with that table. With another `keyPrefix` or `partitioning`,
the table needs another location.

The function's execution role needs `s3:PutObject` on the prefix:

```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::BUCKET/PREFIX*"
}
```

Limits:

1. A failed request rejects with `status`, the status text as `message`, and the name
   `UnknownError`. See [AWS requests](#aws-requests).
2. An older record can arrive after a newer one, for example after a timed-out export
   continues in a later invocation. The PUT then replaces the newer object.
3. A bucket name with dots does not match the TLS certificate of the virtual-hosted
   endpoint `BUCKET.s3.REGION.amazonaws.com`. So requests to the default endpoint fail.
   Use the path-style endpoint instead: set `endpoint` to
   `https://s3.REGION.amazonaws.com`, and start `keyPrefix` with the bucket name and `/`.
   The client appends the path to the endpoint's origin. So the bucket must be in the
   path that the exporter sends, not in `endpoint`.

### SQS

`createSQSExporter({ queueUrl, messageGroupId, region, endpoint, client, maxRecordBytes, operationsFormat })`
sends each record as one message to a queue.

- `queueUrl`: the queue. It must exist. A URL that ends with `.fifo` is a FIFO queue.
- `messageGroupId` (default: the `executionArn`): the message group of a FIFO queue. An
  empty string counts as omitted. A message to a standard queue has no group.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://sqs.REGION.amazonaws.com`): where the built-in client sends requests. The
  exporter does not read the region from `queueUrl`. So the region must be the queue's.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `256_000`): SQS limits a message to 256 KiB.
- `operationsFormat` (default `"array"`): how the message body holds the operations.
  See [Operations format](#operations-format).

Each export runs one `SendMessage`. SQS uses the AWS JSON 1.0 protocol. So the call is
`POST /` with the header `x-amz-target: AmazonSQS.SendMessage`.

The message body is the record as JSON, in the `operationsFormat`. Each message has two
string attributes, `status` and `functionName`. A consumer can select messages by them without reading the body.

A FIFO queue needs a group id and a deduplication id on each message:

1. The group id is `messageGroupId`, or the `executionArn`. So by default the messages of
   one execution arrive in order.
2. The deduplication id is `executionArn:emittedAt`. `emittedAt` strictly increases within
   one invocation. So each record of an execution has its own id, and SQS drops a resend
   of the same record within 5 minutes.
3. SQS limits both ids to 128 characters. Most execution ARNs are longer. So an id longer
   than 128 characters is replaced by the lowercase hex SHA-256 digest of its UTF-8
   bytes, 64 characters. The full SDK uses the same rule.
4. The message body always holds the full `executionArn`.

Create the FIFO queue with `ContentBasedDeduplication=false`, because the exporter sends
its own deduplication ids.

The function's execution role needs `sqs:SendMessage` on the queue:

```json
{
  "Effect": "Allow",
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:REGION:ACCOUNT:QUEUE"
}
```

A queue encrypted with a customer managed KMS key also needs `kms:GenerateDataKey` and
`kms:Decrypt` on the key.

### Firehose

`createFirehoseExporter({ deliveryStreamName, region, endpoint, client, maxRecordBytes, operationsFormat })`
sends each record to an Amazon Data Firehose delivery stream. Firehose buffers the
records and delivers them to the destination of the stream, for example Amazon S3.

- `deliveryStreamName`: the delivery stream. It must exist. Its source must be Direct
  PUT. Firehose rejects `PutRecord` on a stream that reads from a Kinesis data stream.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://firehose.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `1_000_000`): the size of the record JSON in bytes, without
  the newline. Firehose limits the data of one record to 1,000 KiB before base64. The
  data is the JSON and one newline, so it is one byte larger than the measured record.
  So set `maxRecordBytes` to at most 1,023,999.
- `operationsFormat` (default `"array"`): how the data holds the operations. See
  [Operations format](#operations-format).

Each export runs one `PutRecord`. Firehose uses the AWS JSON 1.1 protocol. So the call
is `POST /` with the header `x-amz-target: Firehose_20150804.PutRecord`. The body is
`{ DeliveryStreamName, Record: { Data } }`.

`Data` is the record as JSON in the `operationsFormat`, followed by one newline, as UTF-8
bytes in base64.
Firehose concatenates the records of one buffer into one S3 object without a separator.
The newline keeps the object readable as newline-delimited JSON. So Athena and other
JSON Lines readers can query the object.

The function's execution role needs `firehose:PutRecord` on the delivery stream:

```json
{
  "Effect": "Allow",
  "Action": "firehose:PutRecord",
  "Resource": "arn:aws:firehose:REGION:ACCOUNT:deliverystream/STREAM"
}
```

### EventBridge

`createEventBridgeExporter({ eventBusName, source, region, endpoint, client, maxRecordBytes, operationsFormat })`
publishes each record as one event. Rules on the bus then route the events, for example
to SNS, SQS or Step Functions.

- `eventBusName` (default `"default"`): the event bus name or ARN. The bus must exist.
  The `default` bus always exists.
- `source` (default `"software.amazon.lambda.durable.telemetry"`): the event source.
  EventBridge reserves the prefix `aws.` for AWS services.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://events.REGION.amazonaws.com`): where the built-in client sends requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `256_000`): EventBridge limits a PutEvents entry to 256 KB.
- `operationsFormat` (default `"array"`): how the detail holds the operations. See
  [Operations format](#operations-format).

Each export runs one `PutEvents` with one entry. EventBridge uses the AWS JSON 1.1
protocol. So the call is `POST /` with the header `x-amz-target: AWSEvents.PutEvents`.
The entry has these fields:

- `Source`: the `source` option.
- `DetailType`: the record status: `"SUCCEEDED"`, `"FAILED"` or `"RUNNING"`.
- `Detail`: the record as JSON, in the `operationsFormat`.
- `Time`: the record's `emittedAt`.
- `EventBusName`: the `eventBusName` option.

PutEvents returns HTTP 200 also when the entry fails. The response then has a
`FailedEntryCount` of 1 and the entry's `ErrorCode` and `ErrorMessage`. So the exporter
throws in that case, as in the full SDK. The plugin then logs one warning, and the record
is lost.

A rule matches the event on its source and detail-type. This pattern matches every FAILED
execution:

```json
{
  "source": ["software.amazon.lambda.durable.telemetry"],
  "detail-type": ["FAILED"]
}
```

A pattern can also match fields of the record, for example
`"detail": { "functionName": ["checkout"] }`.

The function's execution role needs `events:PutEvents` on the bus:

```json
{
  "Effect": "Allow",
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:REGION:ACCOUNT:event-bus/default"
}
```

### Redshift

`createRedshiftExporter({ workgroupName, clusterIdentifier, dbUser, secretArn, database, schema, table, region, endpoint, client, maxRecordBytes })`
keeps one row per execution in Amazon Redshift. It uses the Redshift Data API, so the
function needs no VPC access and no database driver.

- `workgroupName`: the Redshift Serverless workgroup. Set this or `clusterIdentifier`.
- `clusterIdentifier`: the provisioned cluster. Set this or `workgroupName`.
- `dbUser` (optional): the database user of a provisioned cluster. Redshift then
  issues temporary credentials for that user.
- `secretArn` (optional): a Secrets Manager secret with the database credentials.
- `database`: the database name.
- `schema` (default `"public"`) and `table` (default `"durable_execution_telemetry"`):
  letters, digits and underscores, not starting with a digit. The names go into the SQL
  text, because the Data API cannot bind a name as a parameter. So the exporter throws
  at creation for any other name.
- `region` (default `process.env.AWS_REGION`) and `endpoint` (default
  `https://redshift-data.REGION.amazonaws.com`): where the built-in client sends
  requests.
- `client` (default: the built-in client): an object with `send({ path, headers, body })`.
  See [AWS requests](#aws-requests). With `client`, the exporter ignores `region` and
  `endpoint`.
- `maxRecordBytes` (default `1_000_000`): the full SDK's limit for one statement.

The options decide the authentication:

| Options | Authentication |
|---|---|
| `workgroupName` | the function's IAM identity |
| `clusterIdentifier` | the function's IAM identity |
| `clusterIdentifier`, `dbUser` | temporary credentials of the user |
| `workgroupName` or `clusterIdentifier`, `secretArn` | the user and password of the secret |

Each export runs one `ExecuteStatement`. The Data API uses the AWS JSON 1.1 protocol. So
the call is `POST /` with the header `x-amz-target: RedshiftData.ExecuteStatement`. The
body holds the target, `Database`, `Sql` and `Parameters`.

The statement is a `MERGE` by `execution_arn`:

1. The source is a one-row subquery that holds the record. Redshift `MERGE` requires
   the `ON` condition to compare a column of the source.
2. A new execution gets a new row.
3. For an existing row, the exporter updates `status`, `end_time`, `duration_ms`,
   `record_json` and `emitted_at`.
4. `record_json` is `JSON_PARSE(:record_json)`, so it is a `SUPER` value.

A Data API parameter is a non-empty string. It cannot be null. So an absent
`executionName`, `endTime` or `durationMs` is the SQL literal `NULL` in the statement,
not a parameter.

The update keeps the newer record. Each `SET` expression has the form
`status = CASE WHEN <table>.emitted_at <= src.emitted_at THEN src.status ELSE <table>.status END`:

1. An older record can arrive after a newer one. See [Aurora](#aurora).
2. Redshift `MERGE` has no condition on `WHEN MATCHED`. Its source cannot read the
   target table.
3. So the condition is in each `SET` expression. An older record leaves every value of
   the row unchanged.

`ExecuteStatement` is asynchronous:

1. Redshift queues the statement and returns its `Id`. The export then resolves.
2. The statement runs later. It can still fail, for example for a missing table or a
   missing permission.
3. The exporter does not call `DescribeStatement`, as in the full SDK. So a failed
   statement is not reported. Find it with `aws redshift-data list-statements --status FAILED`
   or in `SYS_QUERY_HISTORY`.
4. Two exports run as two statements. Their order in Redshift is not the order of the
   exports. The `emitted_at` condition keeps the newer record in that case.

`createTableSql({ schema, table })` returns the statement that creates the table. The
schema is the one of the full SDK's CDK stack:

```sql
CREATE TABLE IF NOT EXISTS public.durable_execution_telemetry (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json SUPER,
  emitted_at TIMESTAMPTZ
)
```

Run it once, for example with `aws redshift-data execute-statement`. Then grant the
database user of the function `SELECT`, `INSERT` and `UPDATE` on the table. With IAM
authentication, that user is `IAM:<role name>` or `IAMR:<role name>`.

The record uses camelCase keys, for example `functionName`. Redshift folds identifiers
in a `SUPER` path to lowercase by default. So set `enable_case_sensitive_identifier` to
`true`, as the full SDK's CDK stack does, and quote the keys:
`record_json."functionName"`.

The function's execution role needs `redshift-data:ExecuteStatement` on the workgroup or
the cluster, and one more permission for the authentication:

| Authentication | Permission |
|---|---|
| `workgroupName` with IAM | `redshift-serverless:GetCredentials` |
| `clusterIdentifier` with IAM | `redshift:GetClusterCredentialsWithIAM` |
| `clusterIdentifier` with `dbUser` | `redshift:GetClusterCredentials` |
| `secretArn` | `secretsmanager:GetSecretValue` |

For a Serverless workgroup with IAM:

```json
{
  "Effect": "Allow",
  "Action": ["redshift-data:ExecuteStatement", "redshift-serverless:GetCredentials"],
  "Resource": "arn:aws:redshift-serverless:REGION:ACCOUNT:workgroup/WORKGROUP_ID"
}
```

Limits:

1. The Data API limits a statement to 200 KB. The full SDK's `maxRecordBytes` of
   1,000,000 is larger. It is unverified whether the parameters count toward that limit.
   A record that is too large fails in the statement, so it is not reported.
2. A provisioned cluster accepts at most 500 active statements.
3. Redshift does not enforce `PRIMARY KEY`. Two statements for a new execution can run at
   the same time. Both then find no row, and both insert one. This can happen in
   `"on-change"` mode. Later statements update both rows.

### OpenSearch

`createOpenSearchExporter({ endpoint, indexName, region, client, maxRecordBytes })`
keeps one document per execution in an Amazon OpenSearch Service domain.

- `endpoint`: the domain endpoint, for example
  `https://my-domain.us-east-1.es.amazonaws.com`. Required without `client`. Without
  it, the built-in client sends to `https://es.REGION.amazonaws.com`. That is the
  configuration API, not a domain. So every export fails.
- `indexName` (default `"durable-execution-telemetry"`): the index. OpenSearch creates it
  on the first write, with a dynamic mapping.
- `region` (default `process.env.AWS_REGION`): the region of the domain. The client
  signs for it.
- `client` (default: the built-in client): an object with
  `send({ method, path, headers, body })`. See [AWS requests](#aws-requests). With
  `client`, the exporter ignores `endpoint` and `region`.
- `maxRecordBytes` (default `10_000_000`): the full SDK's value. The HTTP request
  limit of OpenSearch Service depends on the instance type. Set `maxRecordBytes` below
  the limit of your domain.

Each export makes one index call: `PUT /INDEX/_doc/ID`, with the header
`content-type: application/json`. The body is the record as JSON, with the `operations`
array.

1. The document id is the `executionArn`, encoded with RFC 3986. So `:` is `%3A` and `/`
   is `%2F`.
2. The id is the same in every record of one execution. So each record replaces the
   document, and the index holds one document per execution.
3. The index name is sent as it is. Index names cannot hold `/`, `:`, `#`, `?` or
   spaces.
4. The client signs the request for the service `es`. Like every service other than
   S3, it signs the path encoded once more. So `%3A` is signed as `%253A`.

The function's execution role needs `es:ESHttpPut` on the index:

```json
{
  "Effect": "Allow",
  "Action": "es:ESHttpPut",
  "Resource": "arn:aws:es:REGION:ACCOUNT:domain/DOMAIN/durable-execution-telemetry/*"
}
```

A domain with fine-grained access control also needs the role mapped to an OpenSearch
role that can write the index.

A domain in a VPC is reachable only from that VPC. So the function must run in the VPC,
with a security group that allows HTTPS to the domain.

Limits:

1. A failed request rejects with `status` and the name `UnknownError`. An OpenSearch
   error body has `error.type` and `error.reason`, but no `message`. So the `message` is
   the status text, for example `Bad Request`. The reason is not in the warning. An IAM
   denial has a `message`, so its text is in the warning.
2. An older record can arrive after a newer one. See [Aurora](#aurora). The index call
   has no version condition. So that older record then replaces the document.
3. The dynamic mapping takes the type of each field from the first document. A later
   `input` or `output` of another JSON type, for example a string after an object, fails
   with `mapper_parsing_exception`. That record is lost. To avoid it, create the index
   first with `"enabled": false` for `input` and `output`.
4. OpenSearch Serverless signs for the service `aoss`. The exporter always signs for
   `es`, as in the full SDK. So it does not support OpenSearch Serverless.
5. No basic authentication. Only IAM. The full SDK also supports a user name and a
   password.

### OpenTelemetry logs

`createOtelLogsExporter({ endpoint, headers, timeoutMs, operationsFormat, maxRecordBytes, fetch })`
sends each record as one OpenTelemetry log record. It POSTs an OTLP/HTTP request with
JSON encoding. So any OTLP receiver accepts it: an OpenTelemetry Collector, the AWS
Distro for OpenTelemetry (ADOT) collector, or a vendor endpoint.

- `endpoint`: the OTLP/HTTP logs URL, with the path `/v1/logs`, for example
  `http://localhost:4318/v1/logs`. The exporter adds no path.
- `headers` (default `{}`): added to every request, for example the authorization
  header of a vendor. A `content-type` key replaces the exporter's. `fetch` joins header
  names that differ only in case. So a `Content-Type` key adds a second value instead.
- `timeoutMs` (default `5_000`): the timeout of one request. See the limits below.
- `operationsFormat` (default `"array"`): how the log body holds the operations. See
  [Operations format](#operations-format).
- `maxRecordBytes` (default `1_000_000`): the full SDK's value, a conservative limit for
  one OTLP/HTTP request.
- `fetch` (default: `globalThis.fetch` when the exporter is created): the function that
  sends the request. Tests use it to check the requests without a network.

Each export makes one `POST` to `endpoint` with the header
`content-type: application/json`. The body is one `ExportLogsServiceRequest` with one
resource, one scope and one log record:

| OTLP field | Value |
|---|---|
| resource attribute `service.name` | `functionName` |
| resource attribute `cloud.region` | `region` |
| resource attribute `cloud.account.id` | `accountId` |
| resource attribute `faas.name` | `functionName` |
| resource attribute `faas.version` | `functionQualifier` |
| `scope.name` | `"@aws/durable-execution-sdk-js-telemetry-exporter"` |
| `scope.version` | `schemaVersion`, `"1.0"` |
| `timeUnixNano` | `emittedAt` in nanoseconds, as a string |
| `severityNumber` | `17` (ERROR) for FAILED, `9` (INFO) for SUCCEEDED and RUNNING |
| `severityText` | `status` |
| `body.stringValue` | the record as JSON, in the `operationsFormat` |
| attribute `workflow.execution_arn` | `executionArn` |
| attribute `workflow.execution_name` | `executionName`, or `""` |
| attribute `workflow.status` | `status` |
| attribute `workflow.duration_ms` | `durationMs`, or `0` in a RUNNING record, as `intValue` |

OTLP/JSON encodes a 64-bit integer as a string. So `timeUnixNano` is a string, and
`workflow.duration_ms` is `{ "intValue": "1234" }`. The scope name is the full SDK's. So
a backend query on the scope finds the records of both packages.

The attributes hold a few fields of the record. So a backend can filter on them
without parsing the body. The full record is only in the body.

Pass the credentials of a vendor in `headers`. Read the token from an environment
variable or from Secrets Manager. Never write the token in the code:

```js
const telemetry = createTelemetryPlugin({
  exporters: [
    createOtelLogsExporter({
      endpoint: process.env.OTLP_LOGS_ENDPOINT,
      headers: { authorization: `Bearer ${process.env.OTLP_TOKEN}` },
    }),
  ],
});
```

An environment variable of a Lambda function is visible to everyone who can read the
function's configuration. So for a production token, store it in Secrets Manager. Read it
once at module level, for example with the AWS Parameters and Secrets Lambda Extension,
and pass it to `headers`. The execution role then needs `secretsmanager:GetSecretValue`
on the secret. The exporter itself needs no IAM permission.

To send the records to a collector:

1. With an OpenTelemetry Collector or the ADOT collector as a Lambda layer, the collector
   runs in the sandbox. Set `endpoint` to `http://localhost:4318/v1/logs`. The
   collector's configuration needs an `otlp` receiver with the `http` protocol and a logs
   pipeline.
2. With a collector on another host, or a vendor endpoint, use `https`. A function in a
   VPC then needs a route to the endpoint, for example a NAT gateway.

Limits:

1. A response that is not 2xx rejects. The error has `status`, and its message holds the
   status, the status text and the first 200 characters of the response body.
2. A 2xx response can hold `partialSuccess.rejectedLogRecords`. The exporter does not
   read the response body of a 2xx response, as in the full SDK. So a log record that
   the receiver rejects in a partial success is lost and not reported.
3. The full SDK's request has no timeout. Without one, a slow request keeps running after
   the plugin stops waiting at `exportTimeoutMs`. So each request has a timeout of
   `timeoutMs`. A timeout rejects with a `TimeoutError`.
4. The exporter does not retry, as in the full SDK. The plugin logs one warning for a
   failed export, and the record is lost.
5. Only JSON encoding. No protobuf and no gRPC.
6. The plugin measures the record, not the request. The body is the record JSON as one
   string, so each `"` and `\` of the record JSON is escaped once more. Then the
   envelope adds about 1 KB. So the request is larger than `maxRecordBytes`. Set
   `maxRecordBytes` below the receiver's request limit, with room for the escaping.

### HTTP

`createHttpExporter({ url, method, headers, timeoutMs, operationsFormat, maxRecordBytes, fetch })`
sends each record as one JSON request to any URL, for example a webhook or an internal
service.

- `url`: the URL that receives each record.
- `method` (default `"POST"`): `"POST"` or `"PUT"`. Use `"PUT"` for an endpoint that
  replaces the resource at the URL.
- `headers` (default: none): added to the request, for example
  ``{ Authorization: `Bearer ${token}` }``. A `Content-Type` key replaces the default
  `application/json`. `fetch` joins header names that differ only in case. So a
  `content-type` key adds a second value instead.
- `timeoutMs` (default `10_000`): the longest time one request may take, including the
  response body.
- `operationsFormat` (default `"array"`): how the body holds the operations. See
  [Operations format](#operations-format).
- `maxRecordBytes` (default: no limit): set it if the endpoint limits the request size.
- `fetch` (default `globalThis.fetch`, read when the exporter is created): the function
  that sends the request. Tests pass a fake.

Each export sends one request with the record as JSON, in the `operationsFormat`. The
request has the header `Content-Type: application/json`. The exporter reads the body of
every response, so Node returns the connection to its pool.

A response that is not 2xx rejects the export. The error has `status`. Its message
holds the status, the status text and the first 200 characters of the body. A request
that takes longer than `timeoutMs` rejects with a `TimeoutError`. A network error
rejects with the error of `fetch`. The exporter does not retry, as in the full SDK. The
plugin logs the rejection as one warning, and the record is lost.

The exporter needs no IAM permission. Authenticate with `headers`. To call an endpoint
inside a VPC, the function needs a VPC configuration with a route to the endpoint.

Keep `timeoutMs` below `exportTimeoutMs`. Otherwise the request can keep running after
the plugin stops waiting. Lambda can then freeze it with the sandbox. In `"on-change"`
mode, the requests of one invocation add up. See
[Keep exportTimeoutMs short](#keep-exporttimeoutms-short).

### File

`createFileExporter({ directory, mode, operationsFormat, maxRecordBytes })` writes each
record to a file in a directory.

- `directory`: the directory of the files. The exporter creates it, with its parents.
- `mode` (default `"ndjson"`):
  1. `"ndjson"`: appends the record as one JSON line to `DIRECTORY/YYYY-MM-DD.ndjson`.
     The date is the UTC date of `emittedAt`. So the records of one execution can be in
     several files.
  2. `"json"`: writes the record, pretty-printed, to `DIRECTORY/EXECUTION_NAME.json`.
     A newer record of the same execution replaces the file. Without an execution name
     in the ARN, the file is named by the `executionArn`.
- `operationsFormat` (default `"array"`): how the file holds the operations. See
  [Operations format](#operations-format).
- `maxRecordBytes` (default: no limit).

In a file name, every character other than a letter, a digit, `.`, `_` and `-` becomes
`_`, as in the full SDK. So a name cannot point outside the directory. Two execution
names that differ only in other characters write the same file.

Each export first creates the directory, if it does not exist. A write error, for
example `EACCES` or `ENOSPC`, rejects the export. The plugin logs it as one warning, and
the record is lost.

The `"json"` mode replaces the file with `writeFile`. A reader can see a partly written
file during the write.

On Lambda, only `/tmp` and mounted file systems are writable:

1. `/tmp` belongs to one sandbox. It is lost when Lambda ends the sandbox. Each sandbox
   has its own `/tmp`. So use `/tmp` only for tests and debugging.
2. An Amazon EFS file system keeps the files. The function needs a VPC configuration in
   the VPC of the file system, a file system configuration with a local mount path under
   `/mnt`, and `elasticfilesystem:ClientMount` and `elasticfilesystem:ClientWrite` on the
   access point. Concurrent sandboxes then append to the same `"ndjson"` file.

```json
{
  "Effect": "Allow",
  "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
  "Resource": "arn:aws:elasticfilesystem:REGION:ACCOUNT:access-point/ACCESS_POINT_ID"
}
```

### AWS requests

The exporters for AWS services do not use the AWS SDK. A built-in client in `src/aws.js`
sends each request:

1. It signs the request with Signature Version 4, for the service of the exporter:
   `logs`, `rds-data`, `dynamodb`, `s3`, `sqs`, `firehose`, `events`, `redshift-data`
   or `es`.
2. The method is `POST`. The S3 and OpenSearch exporters send `PUT`.
3. The other services sign the path encoded once more. S3 signs the path as it is sent.
   So for `s3`, the caller encodes the path once, and the client signs it unchanged. For
   `s3`, the client also sends and signs the header `x-amz-content-sha256`, the hex
   SHA-256 of the body.
4. It reads the credentials of the Lambda function from `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`.
5. With SnapStart, Lambda sets no credential variables. It serves the credentials from
   `AWS_CONTAINER_CREDENTIALS_FULL_URI` instead. The client then fetches them from that
   endpoint. It keeps them until 5 minutes before they expire.
6. Each attempt has a timeout of 10 seconds.
7. The client retries a response with status 429 or 5xx, a network error and a timeout.
   It makes at most 3 attempts. It waits a random time before each retry: up to 100 ms
   before the second attempt and up to 200 ms before the third.
8. Any other error response rejects at once. The error has `name`, `status`, `message`
   and `requestId`. `name` comes from the `x-amzn-errortype` header, or the `__type` or
   `code` field of the body, for example `ResourceNotFoundException`. Without them,
   `name` is `UnknownError`.
9. The client parses only JSON. S3 sends errors as XML. So an S3 error has the name
   `UnknownError` and the status text as `message`, for example for `AccessDenied`.
   An OpenSearch error is JSON without a `message`. See [OpenSearch](#opensearch).

The IAM permissions of each exporter are the same as with the AWS SDK. The sections above
show them as policy statements:

| Exporter | Actions | Resource |
|---|---|---|
| CloudWatch Logs | `logs:CreateLogStream`, `logs:PutLogEvents` | the log group |
| Lambda log | none | none |
| Aurora | `rds-data:ExecuteStatement`; `secretsmanager:GetSecretValue` | the cluster; the secret |
| DynamoDB | `dynamodb:PutItem` | the table |
| S3 | `s3:PutObject` | the key prefix |
| SQS | `sqs:SendMessage` | the queue |
| Firehose | `firehose:PutRecord` | the delivery stream |
| EventBridge | `events:PutEvents` | the event bus |
| Redshift | `redshift-data:ExecuteStatement` and one credentials action | the workgroup or the cluster |
| OpenSearch | `es:ESHttpPut` | the index |
| OpenTelemetry logs | none | none |
| HTTP | none | none |
| File | none; on EFS, the actions of [File](#file) | none; on EFS, the access point |

A queue encrypted with a customer managed KMS key also needs the KMS actions of
[SQS](#sqs). The credentials action of Redshift depends on the authentication. See
[Redshift](#redshift). A vendor token in Secrets Manager needs
`secretsmanager:GetSecretValue`. See [OpenTelemetry logs](#opentelemetry-logs).

The `client` option replaces the built-in client. Its `send({ method, path, headers, body })`
receives the method (default `"POST"`), the path, the headers and the JSON body as a
string. It returns a promise of the parsed response. Tests use it to check the requests
without a network.

### Write an exporter

An exporter is an object with two members:

- `export(record)`: sends one record and returns a promise. A rejection loses the record.
- `maxRecordBytes` (optional): the largest record, as UTF-8 JSON, that `export`
  receives. Without it, the plugin sends every record unchanged.

```js
const stdout = {
  maxRecordBytes: 200_000,
  async export(record) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
};
```

The plugin passes the same record object to every exporter. So `export` must not change
it.

### Other destinations

Any object with an `export(record)` method that returns a promise is an exporter. The
plugin waits for that promise up to `exportTimeoutMs` and logs a rejection as one
warning (see [Write an exporter](#write-an-exporter)).

For an HTTP endpoint, use [HTTP](#http). For a file, use [File](#file). For an
OpenTelemetry receiver, use [OpenTelemetry logs](#opentelemetry-logs). For any other
destination, write an exporter.

## Record size

When a record's JSON is larger than an exporter's `maxRecordBytes`, the plugin drops data
from a copy for that exporter. It drops in this order:

1. `input`. It sets `droppedInput: true`.
2. `output`. It sets `droppedOutput: true`.
3. Operations from the end of `operations`, the newest first. `droppedOperations` counts
   them.

Any drop sets `truncated: true`. If the record is still too large, the plugin does not
export it to that exporter and logs one warning.

The plugin measures the record with the `operations` array. The CloudWatch Logs event,
the Lambda log line and the DynamoDB item hold `operationsByName` instead. A summary has
no `id` and no timestamps. So for the same operations, they are smaller than the
measured record. With `operationsFormat: "both"`, the sent JSON holds both forms. So it
is larger than the measured record. [Operations format](#operations-format) gives the
setting for that case. The OpenTelemetry logs request is also larger than the measured
record. See [OpenTelemetry logs](#opentelemetry-logs).

## Failures

Telemetry must not change what the workflow does. So:

1. The plugin catches every error of an exporter. It logs one line with `console.warn`,
   prefixed with `[durable-execution-telemetry]`. The record is lost.
2. The end of an invocation waits at most `exportTimeoutMs` for all exports of the
   invocation together. After that, it logs one warning, and the handler returns.
3. An export that is still running then continues in the background. Lambda can freeze
   it with the sandbox. It can fail or arrive later.

## Best practices

### Keep exportTimeoutMs short

The handler returns only after the end of the invocation. Lambda bills that time. So a
slow destination costs time in every invocation.

1. Keep `exportTimeoutMs` well below the function timeout.
2. The built-in client has its own timeout: 10 seconds per attempt, and 3 attempts.
   So an export can keep running in the background after the plugin stopped waiting.
   Lambda can freeze it and continue it in a later invocation. The Aurora and Redshift
   upserts keep the newer record in that case.
3. The HTTP and OpenTelemetry logs exporters do not use the built-in client. Their
   requests have the timeout `timeoutMs`. Keep it below `exportTimeoutMs`.
4. Each exporter receives the records of one invocation one after the other. So a slow
   exporter does not delay the other exporters. Its own records still wait for each
   other. In `"on-change"` mode, an invocation can send several records. Their export
   times add up. If the sum exceeds `exportTimeoutMs`, the plugin stops waiting before
   that exporter received the last record of the invocation. Lambda can then freeze the
   rest. So for a slow exporter, keep `timeoutMs` times the records per invocation below
   `exportTimeoutMs`, or use `"on-complete"`.

### Use on-change only when you watch running executions

`"on-change"` sends a record after each checkpoint response that changed an operation.
A workflow with 100 steps can send about 100 records. Each record holds every top-level
operation so far. So the bytes sent grow with the square of the number of operations.
Use `"on-complete"` unless a viewer shows running executions.

### Sample busy functions

`samplingRate` keeps or drops whole executions. The decision is the first 8 hex digits of
the SHA-256 hash of the execution ARN, as a fraction, compared with the rate. The ARN
does not change between invocations. So every invocation of one execution makes the same
decision, and an execution has all of its records or none. For a sampled-out execution,
the factory computes the hash and returns `undefined`. So the lite SDK calls no hook of
this plugin in that invocation.

### Leave out sensitive data

`includeInput: false` and `includeOutput: false` keep the input and the result out of
every record. Operation results are never in a record. Error messages are always in a
record. So do not put secrets in error messages.

## Limitations

- The plugin sends the record of an invocation at its end. If the sandbox crashes or
  times out before the end of the invocation, that record is lost. With `"on-change"`,
  the records sent before the crash remain.
- The plugin does not retry a failed export. The built-in client retries only the
  failures listed in [AWS requests](#aws-requests).
- No operation results. No transforms of the input or output.
- With `operations: "all"`, a record holds the children of a finished child context only
  in the invocation that ran it. The service does not send the children of a finished
  context to later invocations. So `"all"` can list fewer operations at the end than
  during the run. `"top-level"` lists the same operations at every point.

## Differences from @aws/durable-execution-sdk-js-telemetry-exporter

- All 13 exporters of the full SDK: CloudWatch Logs, Lambda log, Aurora (PostgreSQL and
  MySQL), DynamoDB, S3, SQS, Firehose, EventBridge, Redshift, OpenSearch, OpenTelemetry
  logs, HTTP and file.
- `exporters` is required. The full SDK uses its `LambdaLogExporter` when `exporters` is
  empty or absent. Pass `createLambdaLogExporter()` for the same result. See
  [Lambda log](#lambda-log).
- No AWS SDK dependency. The exporters for AWS services sign their own requests. The
  `client` option is an object with `send({ method, path, headers, body })`, not an AWS
  SDK client.
- Every exporter names its size limit `maxRecordBytes`. The full SDK names it
  `maxRecordSizeBytes`. The S3 exporter names the key prefix `keyPrefix`. The full SDK
  names it `prefix`.
- No export scheduler. The lite SDK creates one plugin per invocation, calls
  `onOperationChange` synchronously from `flush`, and calls `onInvocationEnd` once,
  after the last checkpoint response. The SDK calls no hook after the outcome is
  decided. Within one invocation, the plugin chains the exports of each exporter.
- No `flush` on exporters, and no `render`. The plugin measures the record with the
  `operations` array. The full SDK measures the rendered record. So with
  `operationsFormat: "both"`, set `maxRecordBytes` with room for `operationsByName`.
- No `content` option: no input or output transforms, no operation overrides, no
  operation results. `includeInput` and `includeOutput` replace the input and output
  settings.
- `operations` replaces `operationDetail`. `"all"` is `"full-tree"`. `"none"` is new.
- Truncation drops input and output first, then operations from the end. The full SDK
  drops error causes, results and the oldest operations first, and input and output
  last. A lite error has no cause.
- `endTime` and `durationMs` appear only in SUCCEEDED and FAILED records. The full SDK
  also sets them in the RUNNING record at the end of a suspended invocation.
- Sampling hashes the ARN with SHA-256. The full SDK uses FNV-1a. So the two packages
  sample different executions at the same rate.
- The Aurora upsert, for both engines, and the Redshift `MERGE` have the `emitted_at`
  condition. So an older record never replaces a newer one. The full SDK has no such
  condition.
- The Aurora `engine` option defaults to `"postgresql"`. The full SDK requires it.
- The MySQL upsert names the new row with a row alias (`AS excluded`). The full SDK uses
  `VALUES(col)`, which MySQL 8.0.20 deprecates.
- The full SDK's Redshift exporter throws when neither `workgroupName` nor
  `clusterIdentifier` is set. This exporter does not check it (rule 1.2). The Data API
  then rejects each statement with `ValidationException`, and the plugin logs it.
- The OpenSearch exporter signs with IAM only. The full SDK also has `auth: "basic"`
  with `username` and `password`. Nobody asked for basic authentication (rule 1.1).
- The OpenSearch exporter's `region` defaults to `AWS_REGION`. The full SDK requires it.
- An OpenSearch error rejects with the status and the status text. The full SDK's error
  message also holds the first 500 characters of the response body.
- The OpenSearch document id is encoded with RFC 3986. The full SDK uses
  `encodeURIComponent`. The two differ only for `!'()*`. An execution ARN holds none of
  them.
- The OpenTelemetry logs exporter is `createOtelLogsExporter`, at the subpath
  `./otel-logs`. The full SDK names it `OTelExporter`.
- The OpenTelemetry logs exporter has no `protocol` option. The full SDK's
  `protocol: "http/protobuf"` only throws at creation. So JSON is the only encoding in
  both packages.
- The OpenTelemetry logs exporter has `timeoutMs` (default 5,000 ms) and `fetch`. The
  full SDK's request has no timeout and uses the global `fetch`.
- The OpenTelemetry logs `severityNumber` is 9 for every status other than FAILED. The
  full SDK maps an unknown status to 0. A record of this package has no other status. So
  the result is the same.
- The plugin measures the record, not the OpenTelemetry logs request. The full SDK
  measures the rendered request. See [OpenTelemetry logs](#opentelemetry-logs).
- The HTTP exporter has the option `fetch`. The full SDK always calls the global `fetch`.
- The HTTP and OpenTelemetry logs exporters reject a non-2xx response with an error that
  holds `status` and the first 200 characters of the body. The full SDK's error message
  holds only the status and the status text.
- The file exporter creates the directory on every export. The full SDK creates it once
  per exporter.
- The DynamoDB item holds the JSON values of the record. The full SDK marshals the
  record with `@aws-sdk/util-dynamodb`:
  1. That marshaller throws for `NaN`, `Infinity`, integers above
     `Number.MAX_SAFE_INTEGER` and class instances such as a `Date`. So the full SDK
     loses the record. This package writes `NULL`, the number and the JSON form.
  2. For an undefined array element, this package writes `NULL`. The full SDK removes
     the element.
  3. A `Map` or a `Set` becomes an empty `M`, as in JSON. The full SDK writes `M` or a
     set type.
  4. A `BigInt` rejects the export, as in the other exporters. The full SDK writes `N`.
- Error names and messages are not capped at 8,192 code points.

## Contributing

This section is for people and AI agents who change this package. Read it before you
change any file here.

### Rules

1. The rules of the lite SDK's
   [Contributing](../aws-durable-execution-sdk-js-lite/README.md#contributing) section
   apply. The rules below add to them or replace them for this package. Keep the logic
   simple (rule 1.1). Write best practices instead of runtime checks (rule 1.2). Plain ES
   modules, hand-written types, no build step (rule 1.4). No `node:async_hooks` and no
   module-level per-invocation state (rule 1.5). The repository's
   [rules for every change](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/CONTRIBUTING.md#rules-for-every-change) apply too.
2. The package has no dependencies of any kind: no `dependencies`, no
   `devDependencies`, no `peerDependencies` and no `optionalDependencies`.
3. `src` imports only relative paths and `node:` built-ins. It does not import
   `@aws-sdk/*`. The exporters for AWS services send their requests with `src/aws.js`.
4. `src` never imports the lite SDK. Tests import it by relative path,
   `../../aws-durable-execution-sdk-js-lite/src/...`, because it is not installed in
   `node_modules`.
5. Telemetry never fails the workflow. Catch every error of an exporter and of record
   building. Log one `console.warn` line.
6. A callback that arrives after `onInvocationEnd` started changes nothing and is never
   exported (see
   [A plugin ignores work that settles after onInvocationEnd](../aws-durable-execution-sdk-js-lite/README.md#a-plugin-ignores-work-that-settles-after-oninvocationend)).
   A record built then would be newer than the final record, and an upserting exporter
   would keep it. `test/invocation-end.test.js` checks that a step that settles after
   the end produces no record. It also checks that two plugin objects of concurrent
   invocations never mix records.
7. Keep the record compatible with the full SDK's `DurableExecutionTelemetryRecord`, and
   the table with its schema. A new field must exist there first.
8. Before a commit, run `npm test` in this folder and
   `npx biome check packages/aws-durable-execution-sdk-js-lite-telemetry` from the
   repository root. Check the types with
   `npx tsc --noEmit --strict --ignoreConfig --module nodenext --target es2022 --skipLibCheck test/types.check.ts`.
9. Commit titles use the scope `sdk-lite-telemetry`.

### Files

```
src/index.js                    createTelemetryPlugin, sampling, export chains, timeout
src/record.js                   buildRecord: wire records to the record format
src/truncate.js                 fitRecord: the drop order of Record size
src/operations-by-name.js       the operationsByName form and applyOperationsFormat
src/aws.js                      signRequest and createAwsClient: SigV4, S3 signing, credentials, retries
src/exporters/cloudwatch-logs.js
src/exporters/lambda-log.js
src/exporters/aurora.js         PostgreSQL and MySQL
src/exporters/dynamodb.js
src/exporters/s3.js
src/exporters/sqs.js
src/exporters/firehose.js
src/exporters/eventbridge.js
src/exporters/redshift.js
src/exporters/opensearch.js
src/exporters/otel.js           OpenTelemetry logs, exported as ./otel-logs
src/exporters/http.js
src/exporters/file.js
src/*.d.ts, src/exporters/*.d.ts  hand-written types
test/*.test.js                  tests
test/types.check.ts             compile-time check against the lite SDK's plugin types
```

### Design

1. The factory closure holds the exporters and the options. Each factory call holds the
   state of one invocation in local variables: the start time, the last `emittedAt` and
   one export chain per exporter.
2. `onOperationChange` exists only in `"on-change"` mode. So the other modes add no work
   to checkpoint responses.
3. `onOperationChange` is synchronous, and the SDK does not await it. So it builds the
   record and appends one export to each exporter's chain. `onInvocationEnd` appends its
   own export to each chain and waits for all chains together, bounded by
   `exportTimeoutMs`.
4. An upserting exporter must not receive an older record after a newer one. That order
   matters only within one exporter. So each exporter has its own chain, and a slow
   exporter delays only its own records.
5. A chain never rejects: each export catches its own errors. So a failed export does
   not stop the next one.
6. `src/aws.js` is a copy of the lite SDK's transport, adapted for generic POST and PUT
   calls and for S3 signing. The lite SDK does not export its transport. So this package
   keeps its own copy. A fix to the signing or the retries in one copy applies to the
   other too.
7. The types in `src/index.d.ts` are structural. They do not import the lite SDK, so the
   package's types resolve without it. `test/types.check.ts` checks that the factory is
   assignable to the lite SDK's `DurablePluginFactory`.
8. `onInvocationEnd` sets the flag `ended` first. `onOperationChange` emits nothing
   once `ended` is set. The lite SDK calls no `onOperationChange` after the outcome is
   decided. The flag keeps rule 6 for any caller that does. Each record gets a larger
   `emittedAt` than the previous one. So without the flag, a RUNNING record would follow
   the final record, and the Aurora and Redshift upserts would keep the RUNNING record.
