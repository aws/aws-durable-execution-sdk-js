import { createAwsClient } from "../aws.js";

const DEFAULT_SCHEMA = "public";
const DEFAULT_TABLE = "durable_execution_telemetry";

// The schema and table names go into the SQL text. The Data API cannot bind an
// identifier as a parameter. So each name must be a plain identifier. A wrong name is a
// configuration error, so the check throws when the exporter is created.
function checkName(kind, name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid ${kind} name "${name}". Use only letters, digits and underscores, and do not start with a digit.`,
    );
  }
  return name;
}

const qualifiedName = (schema, table) =>
  `${checkName("schema", schema)}.${checkName("table", table)}`;

// The schema of the full SDK's CDK stack (cdk/stack.ts). Viewers of that package read
// this table. record_json is SUPER, so queries can read nested fields.
export function createTableSql({
  schema = DEFAULT_SCHEMA,
  table = DEFAULT_TABLE,
} = {}) {
  return `CREATE TABLE IF NOT EXISTS ${qualifiedName(schema, table)} (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json SUPER,
  emitted_at TIMESTAMPTZ
)`;
}

// The MERGE of the full SDK's RedshiftExporter, with a guard on emitted_at.
//
// 1. Redshift MERGE requires an equality join on a column of the source. So the record
//    is a one-row subquery, and ON compares its execution_arn column.
// 2. An export that timed out keeps running in the background. Lambda can freeze it and
//    thaw it in a later invocation. So an older record can arrive after a newer one.
// 3. Redshift MERGE has no condition on WHEN MATCHED. The source subquery cannot read
//    the target table. So each SET expression keeps the old value when the row has a
//    newer emitted_at. The full SDK's MERGE has no such guard.
function mergeSql(target, src) {
  const newer = `${target}.emitted_at <= src.emitted_at`;
  const set = (column) =>
    `${column} = CASE WHEN ${newer} THEN src.${column} ELSE ${target}.${column} END`;
  return `MERGE INTO ${target} USING (
  SELECT
    ${src.executionArn}::varchar AS execution_arn,
    ${src.executionName}::varchar AS execution_name,
    ${src.functionName}::varchar AS function_name,
    ${src.status}::varchar AS status,
    ${src.startTime}::timestamptz AS start_time,
    ${src.endTime}::timestamptz AS end_time,
    ${src.durationMs}::bigint AS duration_ms,
    JSON_PARSE(${src.recordJson}) AS record_json,
    ${src.emittedAt}::timestamptz AS emitted_at
) AS src
ON ${target}.execution_arn = src.execution_arn
WHEN MATCHED THEN UPDATE SET
  ${["status", "end_time", "duration_ms", "record_json", "emitted_at"].map(set).join(",\n  ")}
WHEN NOT MATCHED THEN INSERT
  (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
VALUES
  (src.execution_arn, src.execution_name, src.function_name, src.status, src.start_time, src.end_time, src.duration_ms, src.record_json, src.emitted_at)`;
}

export function createRedshiftExporter({
  workgroupName,
  clusterIdentifier,
  dbUser,
  secretArn,
  database,
  schema = DEFAULT_SCHEMA,
  table = DEFAULT_TABLE,
  region,
  endpoint,
  client = createAwsClient({ service: "redshift-data", region, endpoint }),
  // The full SDK's value: a practical limit for one Data API statement.
  maxRecordBytes = 1_000_000,
}) {
  const target = qualifiedName(schema, table);
  return {
    maxRecordBytes,
    async export(record) {
      // A Redshift Data API parameter value is a non-empty string. It cannot be null.
      // So an absent field is the SQL literal NULL instead of a parameter, as in the full
      // SDK. A durationMs of 0 is present, so the check is for undefined.
      const parameters = [];
      const bind = (name, value) => {
        if (value === undefined) return "NULL";
        parameters.push({ name, value: String(value) });
        return `:${name}`;
      };
      const sql = mergeSql(target, {
        executionArn: bind("execution_arn", record.executionArn),
        executionName: bind("execution_name", record.executionName),
        functionName: bind("function_name", record.functionName),
        status: bind("status", record.status),
        startTime: bind("start_time", record.startTime),
        endTime: bind("end_time", record.endTime),
        durationMs: bind("duration_ms", record.durationMs),
        recordJson: bind("record_json", JSON.stringify(record)),
        emittedAt: bind("emitted_at", record.emittedAt),
      });
      // The Data API uses the AWS JSON 1.1 protocol: POST / with the action in
      // x-amz-target. JSON.stringify leaves out the undefined target fields.
      //
      // ExecuteStatement only queues the statement and returns its Id. The statement
      // runs later and can still fail. The exporter does not wait for it, as in the
      // full SDK. So a failed statement is not reported.
      await client.send({
        path: "/",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "RedshiftData.ExecuteStatement",
        },
        body: JSON.stringify({
          WorkgroupName: workgroupName,
          ClusterIdentifier: clusterIdentifier,
          DbUser: dbUser,
          SecretArn: secretArn,
          Database: database,
          Sql: sql,
          Parameters: parameters,
        }),
      });
    },
  };
}
