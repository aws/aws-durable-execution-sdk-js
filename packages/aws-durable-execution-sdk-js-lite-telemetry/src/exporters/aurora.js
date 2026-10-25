import {
  ExecuteStatementCommand,
  RDSDataClient,
} from "@aws-sdk/client-rds-data";

const DEFAULT_TABLE = "durable_execution_telemetry";

// The table name goes into the SQL text. The Data API cannot bind an identifier as a
// parameter. So the name must be a plain identifier. A wrong name is a configuration
// error, so the check throws when the exporter is created.
function checkTable(table) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(
      `Invalid table name "${table}". Use only letters, digits and underscores, and do not start with a digit.`,
    );
  }
  return table;
}

// The schema of the full SDK's CDK stack (cdk/stack.ts). Viewers of that package read
// this table.
export function createTableSql(table = DEFAULT_TABLE) {
  return `CREATE TABLE IF NOT EXISTS ${checkTable(table)} (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json JSONB,
  emitted_at TIMESTAMPTZ
)`;
}

// One row per execution. Each record replaces the row of its execution.
//
// An export that timed out keeps running in the background. Lambda can freeze it and
// thaw it in a later invocation. So an older record can arrive after a newer one. The
// WHERE clause keeps the row with the larger emitted_at. The full SDK's upsert has no
// such clause.
function upsertSql(table) {
  return `INSERT INTO ${table}
  (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
VALUES
  (:execution_arn, :execution_name, :function_name, :status, :start_time::timestamptz, :end_time::timestamptz, :duration_ms, :record_json::jsonb, :emitted_at::timestamptz)
ON CONFLICT (execution_arn) DO UPDATE SET
  status = EXCLUDED.status,
  end_time = EXCLUDED.end_time,
  duration_ms = EXCLUDED.duration_ms,
  record_json = EXCLUDED.record_json,
  emitted_at = EXCLUDED.emitted_at
WHERE ${table}.emitted_at <= EXCLUDED.emitted_at`;
}

const text = (value) => (value ? { stringValue: value } : { isNull: true });

export function createAuroraExporter({
  resourceArn,
  secretArn,
  database,
  table = DEFAULT_TABLE,
  client = new RDSDataClient({}),
  // The full SDK's value: a practical limit for one Data API statement.
  maxRecordBytes = 1_000_000,
}) {
  const sql = upsertSql(checkTable(table));
  return {
    maxRecordBytes,
    async export(record) {
      await client.send(
        new ExecuteStatementCommand({
          resourceArn,
          secretArn,
          database,
          sql,
          parameters: [
            { name: "execution_arn", value: text(record.executionArn) },
            { name: "execution_name", value: text(record.executionName) },
            { name: "function_name", value: text(record.functionName) },
            { name: "status", value: text(record.status) },
            { name: "start_time", value: text(record.startTime) },
            { name: "end_time", value: text(record.endTime) },
            {
              name: "duration_ms",
              value:
                record.durationMs === undefined
                  ? { isNull: true }
                  : { longValue: record.durationMs },
            },
            { name: "record_json", value: text(JSON.stringify(record)) },
            { name: "emitted_at", value: text(record.emittedAt) },
          ],
        }),
      );
    },
  };
}
