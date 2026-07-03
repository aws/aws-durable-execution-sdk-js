/**
 * Prompt context for converting natural language into a query. The record schema
 * given to the model varies by destination, because the stored shape differs:
 * - "direct" (CloudWatchLogsExporter): raw JSON, fields at top level; includes an
 *   `operationsByName` map that is directly dot-path queryable.
 * - "nested" (LambdaLogExporter): record inside Lambda's JSON envelope (message
 *   field); `operationsByName` exists but isn't reliably queryable (stringified).
 * - "dynamodb": record attributes incl. an `operationsByName` map (PartiQL nav).
 * - "aurora": Postgres; only the canonical operations array (no operationsByName) —
 *   query operations by name via a JSONB/JSONPath predicate on the array.
 */

// ─── DIRECT (CloudWatchLogsExporter) ─────────────────────────────────────────

const RECORD_SCHEMA_DIRECT = `Each log event is a raw JSON WorkflowInsightRecord with fields at the top level:
- recordType: "WorkflowInsight" (fixed — use to identify insight records)
- schemaVersion: string
- emittedAt: string (ISO-8601)
- executionArn: string
- executionName: string (optional)
- functionName: string
- functionQualifier: string
- region: string
- accountId: string
- status: "RUNNING" | "SUCCEEDED" | "FAILED"
- startTime: string (ISO-8601)
- endTime: string (ISO-8601, optional)
- durationMs: number (optional)
- input: object (optional)
- output: object (optional)
- error.name: string (optional)
- error.message: string (optional)
- operationsByName: object keyed by operation name → per-name summary (this destination carries this INSTEAD OF a raw operations array):
    { type, subType, count, minDurationMs, maxDurationMs, totalDurationMs, failedCount, maxAttempt, status, result, error }
    Metric fields aggregate ALL occurrences of that name; type/subType/status reflect the most recent occurrence; result/error are present only when the name occurs exactly once.

Fields are directly queryable (no parsing needed). Nested object fields use dot notation (error.name, error.message).
For PER-OPERATION-NAME queries use operationsByName — it is directly dot-path queryable, e.g.
  filter operationsByName.convert_data.maxDurationMs < 5000
Operation names containing "." can't be used as dot-path keys.`;

const DIALECT_DIRECT = `Target query language: CloudWatch Logs Insights (NOT SQL).
Rules:
- Use Logs Insights commands separated by "|": fields, filter, stats, sort, limit, parse, dedup.
- ALWAYS start with: filter recordType = "WorkflowInsight"
  This isolates insight records from any other data in the log group.
- Reference fields directly: status, durationMs, functionName, executionArn, executionName, error.name, error.message.
- String comparisons use double quotes: filter status = "FAILED"
- Numeric comparisons are direct: filter durationMs > 5000
- Do NOT include a time range in the query; the time range is supplied separately.
- Always end a non-aggregating query with "| limit" (max 1000).
- Use "| sort @timestamp desc" for recent-first.
- For counts/aggregations use stats, e.g. stats count(*) by status.
- Return ONLY the query string via the tool call. No prose inside the query.`;

const FEWSHOTS_DIRECT = `Examples:
Q: show the most recent failed executions
A: filter recordType = "WorkflowInsight" and status = "FAILED" | fields @timestamp, executionArn, durationMs, error.name, error.message | sort @timestamp desc | limit 50

Q: average duration of successful executions
A: filter recordType = "WorkflowInsight" and status = "SUCCEEDED" | stats avg(durationMs) as avg_duration_ms

Q: count executions by status
A: filter recordType = "WorkflowInsight" | stats count(*) as ct by status | sort ct desc

Q: executions that took longer than 5 seconds
A: filter recordType = "WorkflowInsight" and status = "SUCCEEDED" and durationMs > 5000 | fields @timestamp, executionArn, durationMs | sort durationMs desc | limit 50

Q: failures with a timeout error
A: filter recordType = "WorkflowInsight" and status = "FAILED" and error.name like /Timeout/ | fields @timestamp, executionArn, error.name, error.message | sort @timestamp desc | limit 50

Q: executions where operation "convert_data" took less than 5 seconds
A: filter recordType = "WorkflowInsight" and operationsByName.convert_data.maxDurationMs < 5000 | fields @timestamp, executionArn, operationsByName.convert_data.maxDurationMs | sort @timestamp desc | limit 50

Q: executions where the "charge" operation failed
A: filter recordType = "WorkflowInsight" and operationsByName.charge.failedCount > 0 | fields @timestamp, executionArn, operationsByName.charge.error.message | sort @timestamp desc | limit 50

Q: show last 100 records
A: filter recordType = "WorkflowInsight" | fields @timestamp, status, functionName, executionArn, durationMs | sort @timestamp desc | limit 100`;

// ─── NESTED (LambdaLogExporter) ──────────────────────────────────────────────

const RECORD_SCHEMA_NESTED = `Each log event from the function has a top-level JSON envelope with fields:
  timestamp, level, requestId, message

The "message" field contains a JSON-serialized WorkflowInsightRecord with these fields:
- recordType: "WorkflowInsight" (fixed — use to identify insight records)
- schemaVersion: string
- emittedAt: string (ISO-8601)
- executionArn: string
- executionName: string (optional)
- functionName: string
- functionQualifier: string
- region: string
- accountId: string
- status: "RUNNING" | "SUCCEEDED" | "FAILED"
- startTime: string (ISO-8601)
- endTime: string (ISO-8601, optional)
- durationMs: number (optional)
- input: object (optional)
- output: object (optional)
- error: { name: string, message: string } (optional)
- operationsByName: object keyed by operation name → per-name summary (type, subType, count, min/max/totalDurationMs, failedCount, maxAttempt, status, result, error). This destination carries this INSTEAD OF a raw operations array.

IMPORTANT: The "message" field is a flat JSON string, NOT a nested object.
To access sub-fields you MUST use: parse message "\\"fieldName\\":\\"*\\"" as alias
For numeric fields use: parse message "\\"fieldName\\":*," as alias
Per-operation-name numeric filtering (operationsByName) is unreliable here because the record is a
stringified message; for those queries prefer the CloudWatchLogsExporter (direct) destination, or do a
coarse text match like: filter message like /"convert_data"/`;

const DIALECT_NESTED = `Target query language: CloudWatch Logs Insights (NOT SQL).
Rules:
- Use Logs Insights commands separated by "|": fields, filter, stats, sort, limit, parse, dedup.
- ALWAYS start with: filter level = "INFO" and message like /WorkflowInsight/
  This isolates insight records from platform events and other application logs.
- To extract fields from the message JSON string, use glob-style parse:
    parse message "\\"status\\":\\"*\\"" as insight_status
    parse message "\\"functionName\\":\\"*\\"" as fn
    parse message "\\"durationMs\\":*," as duration_ms
    parse message "\\"executionArn\\":\\"*\\"" as exec_arn
    parse message "\\"executionName\\":\\"*\\"" as exec_name
    parse message "\\"error\\":{\\"name\\":\\"*\\"" as error_name
- Use underscored field aliases (insight_status, not insightStatus) to avoid conflicts with auto-discovered fields.
- NEVER define the same alias twice in a query — each "as <name>" must be unique.
- Do NOT include a time range in the query; the time range is supplied separately.
- Always end a non-aggregating query with "| limit" (max 1000).
- Use "| sort @timestamp desc" for recent-first.
- For counts/aggregations use stats, e.g. stats count(*) by insight_status.
- Return ONLY the query string via the tool call. No prose inside the query.`;

const FEWSHOTS_NESTED = `Examples:
Q: show the most recent failed executions
A: filter level = "INFO" and message like /WorkflowInsight/ | filter message like /FAILED/ | parse message "\\"executionArn\\":\\"*\\"" as exec_arn | parse message "\\"durationMs\\":*," as duration_ms | parse message "\\"error\\":{\\"name\\":\\"*\\"" as error_name | fields @timestamp, exec_arn, duration_ms, error_name | sort @timestamp desc | limit 50

Q: average duration of successful executions
A: filter level = "INFO" and message like /WorkflowInsight/ | filter message like /"status":"SUCCEEDED"/ | parse message "\\"durationMs\\":*," as duration_ms | stats avg(duration_ms) as avg_duration_ms

Q: count executions by status
A: filter level = "INFO" and message like /WorkflowInsight/ | parse message "\\"status\\":\\"*\\"" as insight_status | stats count(*) as ct by insight_status | sort ct desc

Q: executions that took longer than 5 seconds
A: filter level = "INFO" and message like /WorkflowInsight/ | filter message like /"status":"SUCCEEDED"/ | parse message "\\"durationMs\\":*," as duration_ms | parse message "\\"executionArn\\":\\"*\\"" as exec_arn | filter duration_ms > 5000 | fields @timestamp, exec_arn, duration_ms | sort duration_ms desc | limit 50

Q: failures with a timeout error
A: filter level = "INFO" and message like /WorkflowInsight/ | filter message like /FAILED/ and message like /Timeout/ | parse message "\\"executionArn\\":\\"*\\"" as exec_arn | parse message "\\"error\\":{\\"name\\":\\"*\\",\\"message\\":\\"*\\"" as error_name, error_msg | fields @timestamp, exec_arn, error_name, error_msg | sort @timestamp desc | limit 50

Q: show last 100 records
A: filter level = "INFO" and message like /WorkflowInsight/ | fields @timestamp, message | sort @timestamp desc | limit 100`;

// ─── Public API ──────────────────────────────────────────────────────────────

const RECORD_SCHEMA_DYNAMODB = `Records are stored in a DynamoDB table with each item representing one execution.
The partition key is "pk" (the executionArn). All record fields are stored as top-level attributes:
- pk: string (executionArn — partition key)
- recordType: "WorkflowInsight"
- schemaVersion: string
- emittedAt: string (ISO-8601)
- executionArn: string
- executionName: string (optional)
- functionName: string
- functionQualifier: string
- region: string
- accountId: string
- status: "RUNNING" | "SUCCEEDED" | "FAILED"
- startTime: string (ISO-8601)
- endTime: string (ISO-8601, optional)
- durationMs: number (optional)
- input: map (optional)
- output: map (optional)
- error: map with name and message (optional)
- operationsByName: map keyed by operation name → per-name summary map (stored INSTEAD OF a raw operations list)
    { type, subType, count, minDurationMs, maxDurationMs, totalDurationMs, failedCount, maxAttempt, status, result, error }
    Metrics aggregate all occurrences; status is the most recent; result/error are present only when the name occurs exactly once.
    Navigate it for per-operation-name filters, e.g. WHERE "operationsByName"."convert_data"."maxDurationMs" < 5000`;

const DIALECT_DYNAMODB = `Target query language: PartiQL for DynamoDB (NOT standard SQL).
Rules:
- Use SELECT statements: SELECT field1, field2 FROM "TABLE_NAME" WHERE condition
- Table name MUST be in double quotes: "TABLE_NAME"
- String values use single quotes: WHERE status = 'SUCCEEDED'
- Comparison operators: =, <>, <, >, <=, >=, BETWEEN, IN, BEGINS_WITH
- Logical: AND, OR, NOT
- Functions: contains(), attribute_exists(), attribute_type(), size()
- ALWAYS include: WHERE recordType = 'WorkflowInsight'
- LIMIT is not supported in PartiQL for DynamoDB Scan — omit it
- ORDER BY is not supported — results come in undefined order
- For full table queries (no key condition), this becomes a Scan (expensive for large tables)
- For single execution lookup, use: WHERE pk = 'arn:...'
- Return ONLY the PartiQL statement via the tool call. No prose.`;

const FEWSHOTS_DYNAMODB = `Examples:
Q: show all failed executions
A: SELECT pk, status, functionName, durationMs, error FROM "TABLE_NAME" WHERE recordType = 'WorkflowInsight' AND status = 'FAILED'

Q: find a specific execution
A: SELECT * FROM "TABLE_NAME" WHERE pk = 'EXECUTION_ARN'

Q: show all succeeded executions for a function
A: SELECT pk, status, durationMs, startTime, endTime FROM "TABLE_NAME" WHERE recordType = 'WorkflowInsight' AND status = 'SUCCEEDED' AND functionName = 'my-function'

Q: show all executions
A: SELECT pk, status, functionName, durationMs, emittedAt FROM "TABLE_NAME" WHERE recordType = 'WorkflowInsight'

Q: show executions with errors
A: SELECT pk, status, functionName, error FROM "TABLE_NAME" WHERE recordType = 'WorkflowInsight' AND attribute_exists(error)

Q: executions where operation "convert_data" took less than 5 seconds
A: SELECT pk, "operationsByName"."convert_data"."maxDurationMs" FROM "TABLE_NAME" WHERE recordType = 'WorkflowInsight' AND "operationsByName"."convert_data"."maxDurationMs" < 5000`;

/** Build the system prompt handed to the model. */
// ─── AURORA (PostgreSQL via RDS Data API) ────────────────────────────────────

const RECORD_SCHEMA_AURORA = `Records are stored in a PostgreSQL table "TABLE_NAME" with columns:
- execution_arn: VARCHAR(512) PRIMARY KEY
- execution_name: VARCHAR(256)
- function_name: VARCHAR(128)
- status: VARCHAR(20) — values: RUNNING, SUCCEEDED, FAILED
- start_time: TIMESTAMPTZ
- end_time: TIMESTAMPTZ (NULL if still running)
- duration_ms: BIGINT (NULL if still running)
- record_json: JSONB — full WorkflowInsightRecord as JSON
- emitted_at: TIMESTAMPTZ

The record_json JSONB column contains the full record including:
- record_json->'input' — execution input (structure varies per function)
- record_json->'output' — execution output (structure varies per function)
- record_json->'error' — error details ({name, message})
- record_json->'operations' — array of operations

Note: Aurora stores only the canonical operations array (there is no
operationsByName index here). Query operations by name with a JSONPath predicate
against the array, e.g.
  record_json @? '$.operations[*] ? (@.name == "convert_data" && @.durationMs < 5000)'

To access fields inside input/output, use JSONB operators:
  record_json->'input'->>'fieldName' (extracts as text)
  record_json->'output'->>'fieldName'
The user will specify which fields they want — do not assume the structure.`;

const DIALECT_AURORA = `Target query language: PostgreSQL.
- Table name is TABLE_NAME.
- Time columns (start_time, end_time, emitted_at) are native TIMESTAMPTZ — use directly with NOW(), INTERVAL, comparisons.
- record_json is JSONB — use ->> for text extraction, -> for nested objects.
- Always include LIMIT (default 100) unless aggregating.
- Return ONLY the SQL query. No prose.`;

const FEWSHOTS_AURORA = `Examples:
Q: show the most recent failed executions
A: SELECT execution_arn, function_name, duration_ms, emitted_at FROM TABLE_NAME WHERE status = 'FAILED' ORDER BY emitted_at DESC LIMIT 50

Q: average duration of successful executions
A: SELECT AVG(duration_ms) AS avg_duration_ms FROM TABLE_NAME WHERE status = 'SUCCEEDED'

Q: count executions by status
A: SELECT status, COUNT(*) AS ct FROM TABLE_NAME GROUP BY status ORDER BY ct DESC

Q: executions longer than 5 seconds
A: SELECT execution_arn, function_name, duration_ms FROM TABLE_NAME WHERE status = 'SUCCEEDED' AND duration_ms > 5000 ORDER BY duration_ms DESC LIMIT 50

Q: failure rate percentage
A: SELECT COUNT(*) FILTER (WHERE status = 'FAILED') * 100.0 / COUNT(*) AS failure_pct FROM TABLE_NAME

Q: show last 100 records
A: SELECT execution_arn, status, function_name, duration_ms, emitted_at FROM TABLE_NAME ORDER BY emitted_at DESC LIMIT 100

Q: average duration grouped by function
A: SELECT function_name, AVG(duration_ms) AS avg_ms, COUNT(*) AS ct FROM TABLE_NAME WHERE status = 'SUCCEEDED' GROUP BY function_name ORDER BY avg_ms DESC

Q: executions where operation "convert_data" took less than 5 seconds
A: SELECT execution_arn, function_name FROM TABLE_NAME WHERE record_json @? '$.operations[*] ? (@.name == "convert_data" && @.durationMs < 5000)' LIMIT 50`;

// ─── ATHENA (Trino/Presto SQL over S3 via S3Exporter) ────────────────────────

const RECORD_SCHEMA_ATHENA = `Records are stored as one JSON object per file in S3 (via S3Exporter), registered as
a Glue table "TABLE_NAME" and Hive-partitioned by year/month/day (partition columns
below). Columns:
- recordType: string ("WorkflowInsight")
- schemaVersion: string
- emittedAt: string (ISO-8601)
- executionArn: string
- executionName: string (nullable)
- functionName: string
- functionQualifier: string
- region: string
- accountId: string
- status: string — RUNNING | SUCCEEDED | FAILED
- startTime: string (ISO-8601)
- endTime: string (ISO-8601, nullable)
- durationMs: bigint (nullable)
- input: string (JSON-serialized; use json_extract_scalar/json_extract to read fields)
- output: string (JSON-serialized; use json_extract_scalar/json_extract to read fields)
- error: struct<name:string,message:string> (nullable)
- operations: array<struct<id,name,type,subType,parentId,status,startTime,endTime,durationMs,attempt,error,result,truncated>>
    This is the canonical per-operation array (NOT operationsByName — S3Exporter
    keeps the raw array). To filter/aggregate by operation name or fields, UNNEST it.
- year, month, day: string — Hive partition columns (from the S3 key
    year=YYYY/month=MM/day=DD/), zero-padded 2-digit strings for month/day. Filter
    on these instead of parsing startTime/emittedAt for partition pruning.
- truncated: boolean (nullable)
- droppedOperations: int (nullable)
- droppedInput / droppedOutput: boolean (nullable)

input/output are stored as JSON strings (not native structs, since their shape is
user-defined) — use json_extract_scalar(input, '$.fieldName') for scalars or
json_extract(input, '$.fieldName') for nested values. The user will specify which
fields they want — do not assume the structure.`;

const DIALECT_ATHENA = `Target query language: Trino/Presto SQL (Amazon Athena) — NOT standard ANSI SQL in all respects.
Rules:
- Table name is TABLE_NAME (already database-qualified by the connection — do not prefix it).
- To inspect operations, UNNEST the array: CROSS JOIN UNNEST(operations) AS t(op), then reference op.name, op.type, op.status, op.durationMs, etc.
- json_extract_scalar(col, '$.path') returns a scalar string; json_extract(col, '$.path') returns JSON — cast as needed, e.g. CAST(json_extract_scalar(...) AS double).
- Prefer filtering on the year/month/day partition columns when the question implies a time range, to avoid scanning the whole bucket (cost + speed).
- String comparisons use single quotes: WHERE status = 'SUCCEEDED'
- Always include LIMIT (default 100) unless aggregating (GROUP BY / COUNT / AVG etc).
- Use double quotes only for identifiers that need escaping; prefer unquoted lowercase identifiers.
- Return ONLY the SQL query via the tool call. No prose, no trailing semicolon required but harmless.`;

const FEWSHOTS_ATHENA = `Examples:
Q: show the most recent failed executions
A: SELECT executionArn, functionName, durationMs, emittedAt FROM TABLE_NAME WHERE status = 'FAILED' ORDER BY emittedAt DESC LIMIT 50

Q: average duration of successful executions
A: SELECT AVG(durationMs) AS avg_duration_ms FROM TABLE_NAME WHERE status = 'SUCCEEDED'

Q: count executions by status
A: SELECT status, COUNT(*) AS ct FROM TABLE_NAME GROUP BY status ORDER BY ct DESC

Q: executions longer than 5 seconds
A: SELECT executionArn, functionName, durationMs FROM TABLE_NAME WHERE status = 'SUCCEEDED' AND durationMs > 5000 ORDER BY durationMs DESC LIMIT 50

Q: show last 100 records from today
A: SELECT executionArn, status, functionName, durationMs, emittedAt FROM TABLE_NAME WHERE year = date_format(current_date, '%Y') AND month = date_format(current_date, '%m') AND day = date_format(current_date, '%d') ORDER BY emittedAt DESC LIMIT 100

Q: executions where operation "convert_data" took less than 5 seconds
A: SELECT DISTINCT t.executionArn, t.functionName FROM TABLE_NAME t CROSS JOIN UNNEST(t.operations) AS u(op) WHERE op.name = 'convert_data' AND op.durationMs < 5000 LIMIT 50

Q: which operations fail most often
A: SELECT op.name, COUNT(*) AS failures FROM TABLE_NAME t CROSS JOIN UNNEST(t.operations) AS u(op) WHERE op.status = 'FAILED' GROUP BY op.name ORDER BY failures DESC LIMIT 20

Q: average duration per operation name
A: SELECT op.name, AVG(op.durationMs) AS avg_ms, COUNT(*) AS ct FROM TABLE_NAME t CROSS JOIN UNNEST(t.operations) AS u(op) WHERE op.durationMs IS NOT NULL GROUP BY op.name ORDER BY avg_ms DESC

Q: executions where the output field "amount" was over 1000
A: SELECT executionArn, CAST(json_extract_scalar(output, '$.amount') AS double) AS amount FROM TABLE_NAME WHERE CAST(json_extract_scalar(output, '$.amount') AS double) > 1000 LIMIT 50`;

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  destinationType:
    | "cloudwatch-logs-exporter"
    | "lambda-log-exporter"
    | "dynamodb"
    | "aurora"
    | "s3",
  options?: { tableName?: string },
): string {
  if (destinationType === "s3") {
    const table = options?.tableName || "workflow_insight";
    return [
      "You convert a user's plain-English question into a single Trino/Presto SQL query",
      "for querying AWS Durable Execution Workflow Insight records via Amazon Athena.",
      "",
      RECORD_SCHEMA_ATHENA.replace(/TABLE_NAME/g, table),
      "",
      DIALECT_ATHENA.replace(/TABLE_NAME/g, table),
      "",
      FEWSHOTS_ATHENA.replace(/TABLE_NAME/g, table),
      "",
      'Call the "emit_query" tool with the query, a one-sentence explanation, and suggestedCharts (2-4 chart types from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot).',
    ].join("\n");
  }

  if (destinationType === "aurora") {
    const table = options?.tableName || "workflow_insight";
    return [
      "You convert a user's plain-English question into a single PostgreSQL query",
      "for querying AWS Durable Execution Workflow Insight records in Aurora PostgreSQL.",
      "",
      RECORD_SCHEMA_AURORA.replace(/TABLE_NAME/g, table),
      "",
      DIALECT_AURORA.replace(/TABLE_NAME/g, table),
      "",
      FEWSHOTS_AURORA.replace(/TABLE_NAME/g, table),
      "",
      'Call the "emit_query" tool with the query, a one-sentence explanation, and suggestedCharts (2-4 chart types from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot).',
    ].join("\n");
  }

  if (destinationType === "dynamodb") {
    const table = options?.tableName || "TABLE_NAME";
    const schema = RECORD_SCHEMA_DYNAMODB;
    const dialect = DIALECT_DYNAMODB.replace(/TABLE_NAME/g, table);
    const fewshots = FEWSHOTS_DYNAMODB.replace(/TABLE_NAME/g, table);
    return [
      "You convert a user's plain-English question into a single PartiQL query",
      "for querying AWS Durable Execution Workflow Insight records in DynamoDB.",
      "",
      schema,
      "",
      dialect,
      "",
      fewshots,
      "",
      'Call the "emit_query" tool with the query, a one-sentence explanation, and suggestedCharts (2-4 chart types from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot).',
    ].join("\n");
  }

  const schema =
    destinationType === "cloudwatch-logs-exporter"
      ? RECORD_SCHEMA_DIRECT
      : RECORD_SCHEMA_NESTED;
  const dialect =
    destinationType === "cloudwatch-logs-exporter"
      ? DIALECT_DIRECT
      : DIALECT_NESTED;
  const fewshots =
    destinationType === "cloudwatch-logs-exporter"
      ? FEWSHOTS_DIRECT
      : FEWSHOTS_NESTED;

  return [
    "You convert a user's plain-English question into a single CloudWatch Logs Insights query",
    "over AWS Durable Execution Workflow Insight records.",
    "",
    schema,
    "",
    dialect,
    "",
    fewshots,
    "",
    'Call the "emit_query" tool with the query, a one-sentence explanation, and suggestedCharts (2-4 chart types from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot).',
  ].join("\n");
}

/**
 * Ensure a non-aggregating query has a limit clause so we never pull unbounded
 * result sets. Aggregations (stats) don't need one.
 */
export function ensureLimit(query: string, max = 1000): string {
  const q = query.trim();
  if (/\blimit\b/i.test(q) || /\bstats\b/i.test(q)) {
    return q;
  }
  return `${q} | limit ${max}`;
}
