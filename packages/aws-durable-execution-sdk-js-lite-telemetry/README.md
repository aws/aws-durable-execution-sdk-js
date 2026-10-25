# @aws/durable-execution-sdk-js-lite-telemetry

A telemetry plugin for [`@aws/durable-execution-sdk-js-lite`](../aws-durable-execution-sdk-js-lite/README.md).
It builds one record per execution: the status, the times, the input, the output, the
error and the operations. It sends the record to Amazon CloudWatch Logs, to Amazon Aurora
PostgreSQL, or to your own exporter.

The record has the JSON shape of the records of
[`@aws/durable-execution-sdk-js-telemetry-exporter`](https://github.com/aws/aws-durable-execution-sdk-js/tree/main/packages/aws-durable-execution-sdk-js-telemetry-exporter).
The Aurora table has the same columns. So viewers of that package read these records too.

To change this package, read [Contributing](#contributing) first.

## Status

This package is an alpha. It is private and not published to npm. Its API can change.

## Requirements

- Node.js 22.12 or later.
- `@aws/durable-execution-sdk-js-lite`.

The package has no dependencies. The exporters do not use the AWS SDK. They sign and
send their own requests. See [AWS requests](#aws-requests).

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

## Configuration

`createTelemetryPlugin(config)` takes these options:

| Option | Default | Meaning |
|---|---|---|
| `exporters` | required | An array of exporters. Each one receives every record. |
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

In `"on-change"` mode, the plugin starts each export at once. The exports of one
invocation run one after the other, in the order the records were built. So an exporter
that replaces the row of an execution never replaces a newer record of the same
invocation with an older one. The end of the invocation waits for all of them.

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

### Aurora PostgreSQL

`createAuroraExporter({ resourceArn, secretArn, database, table, region, endpoint, client, maxRecordBytes })`
keeps one row per execution. It uses the RDS Data API, so the function needs no VPC
access and no database driver.

- `resourceArn`: the Aurora PostgreSQL cluster. The cluster must have the Data API
  enabled.
- `secretArn`: the Secrets Manager secret with the database credentials.
- `database`: the database name.
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
existing row. The update has the condition
`WHERE <table>.emitted_at <= EXCLUDED.emitted_at`:

1. An export that times out keeps running in the background.
2. Lambda can freeze it and continue it in a later invocation.
3. So an older record can arrive after a newer one.
4. So the condition keeps the row with the newer record.

`createTableSql(table)` returns the statement that creates the table. The schema is the
full SDK's:

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

Run it once, for example with `aws rds-data execute-statement`.

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

### AWS requests

The exporters do not use the AWS SDK. A built-in client in `src/aws.js` sends each
request:

1. It signs the request with Signature Version 4, for the service `logs` or `rds-data`.
2. It reads the credentials of the Lambda function from `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`.
3. With SnapStart, Lambda sets no credential variables. It serves the credentials from
   `AWS_CONTAINER_CREDENTIALS_FULL_URI` instead. The client then fetches them from that
   endpoint. It keeps them until 5 minutes before they expire.
4. Each attempt has a timeout of 10 seconds.
5. The client retries a response with status 429 or 5xx, a network error and a timeout.
   It makes at most 3 attempts. It waits a random time before each retry: up to 100 ms
   before the second attempt and up to 200 ms before the third.
6. Any other error response rejects at once. The error has `name`, `status`, `message`
   and `requestId`. `name` comes from the `x-amzn-errortype` header, or the `__type` or
   `code` field of the body, for example `ResourceNotFoundException`.

The IAM permissions of each exporter are the same as with the AWS SDK. The sections above
list them.

The `client` option replaces the built-in client. Its `send({ path, headers, body })`
receives the path, the headers and the JSON body as a string. It returns a promise of
the parsed response. Tests use it to check the requests without a network.

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

## Record size

When a record's JSON is larger than an exporter's `maxRecordBytes`, the plugin drops data
from a copy for that exporter. It drops in this order:

1. `input`. It sets `droppedInput: true`.
2. `output`. It sets `droppedOutput: true`.
3. Operations from the end of `operations`, the newest first. `droppedOperations` counts
   them.

Any drop sets `truncated: true`. If the record is still too large, the plugin does not
export it to that exporter and logs one warning.

The plugin measures the record with the `operations` array. The CloudWatch Logs event
holds `operationsByName` instead. A summary has no `id` and no timestamps. So for the
same operations, the event is smaller than the measured record.

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
   Lambda can freeze it and continue it in a later invocation. The Aurora upsert keeps
   the newer record in that case.

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
- Aurora PostgreSQL only. No MySQL.
- With `operations: "all"`, a record holds the children of a finished child context only
  in the invocation that ran it. The service does not send the children of a finished
  context to later invocations. So `"all"` can list fewer operations at the end than
  during the run. `"top-level"` lists the same operations at every point.

## Differences from @aws/durable-execution-sdk-js-telemetry-exporter

- Two exporters: CloudWatch Logs and Aurora PostgreSQL. No default exporter.
- No AWS SDK dependency. The exporters sign their own requests. The `client` option is an
  object with `send({ path, headers, body })`, not an AWS SDK client.
- No export scheduler. The lite SDK creates one plugin per invocation, calls
  `onOperationChange` synchronously from `flush`, and calls `onInvocationEnd` once,
  after the last checkpoint response. So no hook can arrive after the end. The plugin
  only chains the exports of one invocation.
- No `flush` on exporters, and no `render`. The plugin measures the record with the
  `operations` array.
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
- The Aurora upsert has the `emitted_at` condition.
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
   module-level per-invocation state (rule 1.5). Return to the design phase when a
   review round finds new blocking problems after the previous findings were addressed
   (rule 1.9). Prefer simplifying existing logic to adding logic (rule 1.10). Reviewers
   push back on a change that breaks a rule instead of asking for code changes
   (rule 1.11).
2. The package has no dependencies of any kind: no `dependencies`, no
   `devDependencies`, no `peerDependencies` and no `optionalDependencies`.
3. `src` imports only relative paths and `node:` built-ins. It does not import
   `@aws-sdk/*`. The exporters send their requests with `src/aws.js`.
4. `src` never imports the lite SDK. Tests import it by relative path,
   `../../aws-durable-execution-sdk-js-lite/src/...`, because it is not installed in
   `node_modules`.
5. Telemetry never fails the workflow. Catch every error of an exporter and of record
   building. Log one `console.warn` line.
6. Keep the record compatible with the full SDK's `DurableExecutionTelemetryRecord`, and
   the table with its schema. A new field must exist there first.
7. Before a commit, run `npm test` in this folder and
   `npx biome check packages/aws-durable-execution-sdk-js-lite-telemetry` from the
   repository root. Check the types with
   `npx tsc --noEmit --strict --ignoreConfig --module nodenext --target es2022 --skipLibCheck test/types.check.ts`.
8. Commit titles use the scope `sdk-lite-telemetry`.

### Files

```
src/index.js                    createTelemetryPlugin, sampling, export chain, timeout
src/record.js                   buildRecord: wire records to the record format
src/truncate.js                 fitRecord: the drop order of Record size
src/operations-by-name.js       the operationsByName form for CloudWatch Logs
src/aws.js                      signRequest and createAwsClient: SigV4, credentials, retries
src/exporters/cloudwatch-logs.js
src/exporters/aurora.js
src/*.d.ts, src/exporters/*.d.ts  hand-written types
test/*.test.js                  tests
test/types.check.ts             compile-time check against the lite SDK's plugin types
```

### Design

1. The factory closure holds the exporters and the options. Each factory call holds the
   state of one invocation in local variables: the start time, the last `emittedAt` and
   the export chain.
2. `onOperationChange` exists only in `"on-change"` mode. So the other modes add no work
   to checkpoint responses.
3. `onOperationChange` is synchronous, and the SDK does not await it. So it builds the
   record and appends the export to the chain. `onInvocationEnd` appends its own export
   and waits for the chain, bounded by `exportTimeoutMs`.
4. The chain never rejects: each export catches its own errors. So a failed export does
   not stop the next one.
5. `src/aws.js` is a copy of the lite SDK's transport, adapted for generic POST calls.
   The lite SDK does not export its transport. So this package keeps its own copy. A fix
   to the signing or the retries in one copy applies to the other too.
6. The types in `src/index.d.ts` are structural. They do not import the lite SDK, so the
   package's types resolve without it. `test/types.check.ts` checks that the factory is
   assignable to the lite SDK's `DurablePluginFactory`.
