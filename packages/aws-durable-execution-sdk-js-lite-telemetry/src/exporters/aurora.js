import { createAwsClient } from "../aws.js";

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

// PostgreSQL: the schema of the full SDK's CDK stack (cdk/stack.ts). Viewers of that
// package read this table.
//
// MySQL: the schema of the full SDK's README. The full SDK has no CDK stack for MySQL.
// The time columns are VARCHAR(30), not DATETIME:
// 1. Every record time has the fixed format YYYY-MM-DDTHH:MM:SS.sssZ.
// 2. So text order equals time order, and the emitted_at guard can compare text.
// 3. The exporter sends the strings unchanged, as the full SDK does.
// 4. So a table created from the full SDK's README works with both exporters.
// Any engine other than "mysql" gets the PostgreSQL schema.
export function createTableSql(table = DEFAULT_TABLE, { engine } = {}) {
  if (engine === "mysql") {
    return `CREATE TABLE IF NOT EXISTS ${checkTable(table)} (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time VARCHAR(30),
  end_time VARCHAR(30),
  duration_ms BIGINT,
  record_json LONGTEXT,
  emitted_at VARCHAR(30)
)`;
  }
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

// The MySQL version of the same upsert.
// 1. ON DUPLICATE KEY UPDATE has no WHERE clause. So each assignment keeps the old value
//    when the stored row is newer: col = IF(<stored> <= <new>, <new>, <stored>).
// 2. MySQL evaluates the assignments from left to right. An assignment to emitted_at
//    changes the value that the IF conditions after it read.
// 3. So emitted_at is assigned last.
// The row alias "excluded" names the new row, as EXCLUDED does in PostgreSQL. The full
// SDK uses VALUES(col) instead. MySQL 8.0.20 deprecates VALUES(col). The row alias
// exists since MySQL 8.0.19, and the Data API supports Aurora MySQL 3.07 and later
// (MySQL 8.0 compatible).
function mysqlUpsertSql(table) {
  const keepNewer = (column) =>
    `${column} = IF(${table}.emitted_at <= excluded.emitted_at, excluded.${column}, ${table}.${column})`;
  return `INSERT INTO ${table}
  (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
VALUES
  (:execution_arn, :execution_name, :function_name, :status, :start_time, :end_time, :duration_ms, :record_json, :emitted_at)
AS excluded
ON DUPLICATE KEY UPDATE
  ${["status", "end_time", "duration_ms", "record_json", "emitted_at"].map(keepNewer).join(",\n  ")}`;
}

const text = (value) => (value ? { stringValue: value } : { isNull: true });

export function createAuroraExporter({
  resourceArn,
  secretArn,
  database,
  table = DEFAULT_TABLE,
  // "mysql" or "postgresql". Any other value, and no value, means PostgreSQL. The full
  // SDK requires the option. The default keeps the callers from before the option
  // working.
  engine,
  region,
  endpoint,
  client = createAwsClient({ service: "rds-data", region, endpoint }),
  // The full SDK's value: a practical limit for one Data API statement.
  maxRecordBytes = 1_000_000,
}) {
  const sql = (engine === "mysql" ? mysqlUpsertSql : upsertSql)(
    checkTable(table),
  );
  return {
    maxRecordBytes,
    async export(record) {
      // The Data API uses the REST-JSON protocol: ExecuteStatement is POST /Execute.
      await client.send({
        path: "/Execute",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
      });
    },
  };
}
