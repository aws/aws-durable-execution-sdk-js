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
  type TelemetryExporter,
} from "../src/index.js";
import {
  createAuroraExporter,
  createTableSql,
} from "../src/exporters/aurora.js";
import { createCloudWatchLogsExporter } from "../src/exporters/cloudwatch-logs.js";
import { createDynamoDBExporter } from "../src/exporters/dynamodb.js";
import { createEventBridgeExporter } from "../src/exporters/eventbridge.js";
import { createFirehoseExporter } from "../src/exporters/firehose.js";
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
    }),
    createFirehoseExporter({ deliveryStreamName: "s", maxRecordBytes: 1000 }),
    createEventBridgeExporter(),
    createRedshiftExporter({
      workgroupName: "w",
      database: "d",
      schema: "s",
      table: "t",
    }),
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
const redshiftSql: string = createRedshiftTableSql({ schema: "s" });
void record;
void sql;
void redshiftSql;
