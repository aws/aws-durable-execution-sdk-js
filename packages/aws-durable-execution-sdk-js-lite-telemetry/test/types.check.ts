// A compile-time check, not a test file. Run:
// npx tsc --noEmit --strict --ignoreConfig --module nodenext --target es2022 --skipLibCheck test/types.check.ts
// It imports the lite SDK by relative path, because that package is not installed in
// node_modules. It checks that the factory fits the lite SDK's plugins option.

import {
  type DurablePluginFactory,
  withDurableExecution,
} from "../../aws-durable-execution-sdk-js-lite/src/index.js";
import {
  type AwsClient,
  buildRecord,
  createTelemetryPlugin,
  type DurableExecutionTelemetryRecord,
  type OperationsFormat,
  type TelemetryExporter,
} from "../src/index.js";
import {
  createAuroraExporter,
  createTableSql,
} from "../src/exporters/aurora.js";
import { createCloudWatchLogsExporter } from "../src/exporters/cloudwatch-logs.js";
import { createDynamoDBExporter } from "../src/exporters/dynamodb.js";
import { createEventBridgeExporter } from "../src/exporters/eventbridge.js";
import { createFileExporter } from "../src/exporters/file.js";
import { createFirehoseExporter } from "../src/exporters/firehose.js";
import { createHttpExporter } from "../src/exporters/http.js";
import { createLambdaLogExporter } from "../src/exporters/lambda-log.js";
import { createOpenSearchExporter } from "../src/exporters/opensearch.js";
import { createOtelLogsExporter } from "../src/exporters/otel.js";
import {
  createRedshiftExporter,
  createTableSql as createRedshiftTableSql,
} from "../src/exporters/redshift.js";
import { createS3Exporter } from "../src/exporters/s3.js";
import { createSQSExporter } from "../src/exporters/sqs.js";

const custom: TelemetryExporter = {
  export: async (record: DurableExecutionTelemetryRecord) => {
    record.operations.map((op) => op.name);
  },
};

const client: AwsClient = {
  send: async ({ path, headers, body }) => ({ path, headers, body }),
};

const format: OperationsFormat = "both";

const plugin = createTelemetryPlugin({
  exporters: [
    custom,
    createCloudWatchLogsExporter({
      logGroupName: "g",
      client,
    }),
    createAuroraExporter({
      resourceArn: "r",
      secretArn: "s",
      database: "d",
      region: "us-east-1",
      endpoint: "https://rds-data.us-east-1.amazonaws.com",
    }),
    createDynamoDBExporter({ tableName: "t", sortKey: "", client }),
    createS3Exporter({ bucket: "b", partitioning: "function-name", client }),
    createSQSExporter({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/1/q.fifo",
      operationsFormat: "by-name",
    }),
    createFirehoseExporter({
      deliveryStreamName: "s",
      maxRecordBytes: 1000,
      operationsFormat: format,
    }),
    createEventBridgeExporter({ operationsFormat: "array" }),
    createRedshiftExporter({
      workgroupName: "w",
      database: "d",
      schema: "s",
      table: "t",
    }),
    createLambdaLogExporter(),
    createLambdaLogExporter({ maxRecordBytes: 1000 }),
    createAuroraExporter({
      resourceArn: "r",
      secretArn: "s",
      database: "d",
      engine: "mysql",
      client,
    }),
    createOpenSearchExporter({
      endpoint: "https://d.us-east-1.es.amazonaws.com",
      indexName: "i",
    }),
    createOpenSearchExporter({ client }),
    createOtelLogsExporter({
      endpoint: "http://localhost:4318/v1/logs",
      headers: { authorization: "Bearer t" },
      timeoutMs: 1000,
      operationsFormat: "by-name",
      fetch: globalThis.fetch,
    }),
    createHttpExporter({
      url: "https://example.com/telemetry",
      method: "PUT",
      headers: { Authorization: "Bearer t" },
      timeoutMs: 1000,
      operationsFormat: "both",
      maxRecordBytes: 1000,
      fetch: globalThis.fetch,
    }),
    createFileExporter({ directory: "/tmp/t", mode: "json" }),
    createFileExporter({ directory: "/tmp/t", operationsFormat: "array" }),
  ],
  emitMode: "on-change",
  operations: "all",
  samplingRate: 0.5,
  exportTimeoutMs: 1000,
});

const asLite: DurablePluginFactory<{ orderId: string }, number> = plugin;
withDurableExecution<{ orderId: string }, number>(async () => 1, {
  plugins: [plugin, asLite],
});

const record: DurableExecutionTelemetryRecord = buildRecord({
  arn: "arn",
  status: "PENDING",
  operations: [{ Id: "1", Type: "STEP", Status: "STARTED", StartTimestamp: 1 }],
});
const sql: string = createTableSql("t");
const mysqlSql: string = createTableSql(undefined, { engine: "mysql" });
const redshiftSql: string = createRedshiftTableSql({ schema: "s" });
// The HTTP and file exporters have no default size limit.
const httpLimit: number | undefined = createHttpExporter({
  url: "u",
}).maxRecordBytes;
const fileLimit: number | undefined = createFileExporter({
  directory: "d",
}).maxRecordBytes;
createAuroraExporter({
  resourceArn: "r",
  secretArn: "s",
  database: "d",
  // @ts-expect-error engine accepts only "postgresql" and "mysql".
  engine: "oracle",
});
// @ts-expect-error the HTTP method is "POST" or "PUT".
createHttpExporter({ url: "u", method: "GET" });
// @ts-expect-error the file mode is "ndjson" or "json".
createFileExporter({ directory: "d", mode: "csv" });
void record;
void sql;
void mysqlSql;
void redshiftSql;
void httpLimit;
void fileLimit;
