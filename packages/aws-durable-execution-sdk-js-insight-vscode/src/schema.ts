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
 * - "redshift": Redshift SQL; record_json is a SUPER column — navigate/unnest it
 *   with PartiQL (dot/bracket paths, `FROM tbl t, t.record_json.operations o`).
 * - "opensearch": Amazon OpenSearch; queried via the SQL plugin (_plugins/_sql).
 *   String fields are text+keyword, but the SQL plugin can't resolve the
 *   `.keyword` subfield — filter/group on the plain field name.
 */

/**
 * The record destination a query targets. This is the single source of truth
 * for the union (schema.ts is vscode-free, so config/llm/agentLoop can all
 * import it without pulling in the VS Code API). "sqs" isn't independently
 * queryable — it falls through to the logs-insights prompt like the log
 * exporters — but it's included so callers can pass InsightConfig's value
 * without a cast.
 */
export type DestinationType =
  | "cloudwatch-logs-exporter"
  | "lambda-log-exporter"
  | "dynamodb"
  | "aurora"
  | "redshift"
  | "opensearch"
  | "sqs"
  | "s3";

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

// ─── REDSHIFT (Redshift SQL over the Data API; JSON via SUPER/PartiQL) ────────

const RECORD_SCHEMA_REDSHIFT = `Records are stored in an Amazon Redshift table "TABLE_NAME" with columns:
- execution_arn: VARCHAR(512) PRIMARY KEY
- execution_name: VARCHAR(256)
- function_name: VARCHAR(128)
- status: VARCHAR(20) — values: RUNNING, SUCCEEDED, FAILED
- start_time: TIMESTAMPTZ (native timestamp)
- end_time: TIMESTAMPTZ (NULL if still running)
- duration_ms: BIGINT (NULL if still running)
- record_json: SUPER — full WorkflowInsightRecord as semi-structured JSON
- emitted_at: TIMESTAMPTZ

The record_json SUPER column contains the full record. The workgroup has
enable_case_sensitive_identifier=true, and the stored JSON keys are camelCase,
so SUPER attribute names MUST be double-quoted to preserve case — an unquoted
path like record_json.functionName is folded to lowercase and resolves to NULL.
Navigate with PartiQL dot/bracket paths (no JSON functions needed):
- record_json."input" — execution input (structure varies per function)
- record_json."output" — execution output (structure varies per function)
- record_json."error" — error details ("name", "message")
- record_json."operations" — array of operations

Note: Redshift stores only the canonical operations array (there is no
operationsByName index here). To filter/aggregate by operation name or fields,
UNNEST the SUPER array by joining it as a table alias, e.g.
  SELECT e.execution_arn FROM TABLE_NAME e, e.record_json."operations" o
  WHERE o."name" = 'convert_data' AND o."durationMs"::bigint < 5000

To read a SUPER value as a normal scalar, cast it (e.g. o."durationMs"::bigint,
record_json."input"."fieldName"::varchar). Prefer the top-level snake_case
columns above (execution_arn, function_name, status, duration_ms, ...) when the
data you need is there — they need no quoting. The user will specify which
fields they want — do not assume the structure.`;

const DIALECT_REDSHIFT = `Target query language: Amazon Redshift SQL (with PartiQL for SUPER navigation).
- Table name is TABLE_NAME.
- Time columns (start_time, end_time, emitted_at) are native TIMESTAMPTZ — use
  directly with NOW(), INTERVAL, DATE_TRUNC, and comparisons for date math.
- record_json is SUPER — navigate with dot/bracket paths and UNNEST arrays by
  joining them as a table alias (FROM tbl t, t.record_json."operations" o). The
  JSON keys are camelCase and case-sensitive identifiers are ON, so ALWAYS
  double-quote SUPER attribute names (record_json."functionName", o."durationMs")
  — unquoted names resolve to NULL. Cast extracted SUPER values to a concrete
  type (::bigint, ::varchar) before arithmetic or comparisons.
- Always include LIMIT (default 100) unless aggregating.
- Return ONLY the SQL query. No prose.`;

const FEWSHOTS_REDSHIFT = `Examples:
Q: show the most recent failed executions
A: SELECT execution_arn, function_name, duration_ms, emitted_at FROM TABLE_NAME WHERE status = 'FAILED' ORDER BY emitted_at DESC LIMIT 50

Q: average duration of successful executions
A: SELECT AVG(duration_ms) AS avg_duration_ms FROM TABLE_NAME WHERE status = 'SUCCEEDED'

Q: count executions by status
A: SELECT status, COUNT(*) AS ct FROM TABLE_NAME GROUP BY status ORDER BY ct DESC

Q: executions longer than 5 seconds
A: SELECT execution_arn, function_name, duration_ms FROM TABLE_NAME WHERE status = 'SUCCEEDED' AND duration_ms > 5000 ORDER BY duration_ms DESC LIMIT 50

Q: failure rate percentage
A: SELECT COUNT(CASE WHEN status = 'FAILED' THEN 1 END) * 100.0 / COUNT(*) AS failure_pct FROM TABLE_NAME

Q: show last 100 records
A: SELECT execution_arn, status, function_name, duration_ms, emitted_at FROM TABLE_NAME ORDER BY emitted_at DESC LIMIT 100

Q: average duration grouped by function
A: SELECT function_name, AVG(duration_ms) AS avg_ms, COUNT(*) AS ct FROM TABLE_NAME WHERE status = 'SUCCEEDED' GROUP BY function_name ORDER BY avg_ms DESC

Q: executions where operation "convert_data" took less than 5 seconds
A: SELECT DISTINCT e.execution_arn, e.function_name FROM TABLE_NAME e, e.record_json."operations" o WHERE o."name" = 'convert_data' AND o."durationMs"::bigint < 5000 LIMIT 50`;

// ─── OPENSEARCH (Amazon OpenSearch SQL plugin: POST _plugins/_sql) ────────────

const RECORD_SCHEMA_OPENSEARCH = `Each record is one OpenSearch document (doc _id = executionArn) in the index
\`TABLE_NAME\`. The index name contains a hyphen, so it MUST be wrapped in
backticks in the FROM clause. Documents are the raw WorkflowInsightRecord with
camelCase fields:
- recordType: keyword ("WorkflowInsight")
- schemaVersion, executionArn, executionName, functionName, functionQualifier,
  region, accountId, status (RUNNING|SUCCEEDED|FAILED): string fields
- emittedAt, startTime, endTime: ISO-8601 date strings
- durationMs: numeric (long), null while running
- input, output: nested objects (structure varies per function)
- error: object {name, message}
- operations: array of operation objects (see limitation below)

CRITICAL — query STRING fields by their plain names (status, functionName,
input.claimType). Although the mapping has a .keyword subfield, the OpenSearch
SQL plugin does NOT expose it as a column — writing status.keyword fails with
"can't resolve status.keyword". The plugin filters/groups on the text field
directly (WHERE status = 'FAILED', GROUP BY status both work). Numeric
(durationMs) and date (emittedAt/startTime/endTime) fields are used directly.
Do NOT use ORDER BY on a raw text field (text isn't sortable); order by a
numeric/date field or an aggregate alias instead.

Limitation: operations is an array of objects. The OpenSearch SQL plugin cannot
reliably unnest or aggregate array-of-object subfields — do NOT try to query
individual operations by name/duration here. Answer operation-level questions
from the top-level fields (status, durationMs, functionName) instead.`;

const DIALECT_OPENSEARCH = `Target query language: Amazon OpenSearch SQL (the _plugins/_sql dialect, a
subset of standard SQL).
- FROM \`TABLE_NAME\` (index name — always backtick-quoted).
- Query string fields by plain name (status, functionName, input.claimType).
  Do NOT append .keyword — the SQL plugin can't resolve the keyword subfield.
- durationMs is numeric; emittedAt/startTime/endTime are dates (comparable, orderable).
- ORDER BY only on numeric/date fields or aggregate aliases, never a raw text field.
- Supported: SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, and aggregates
  (COUNT, AVG, SUM, MIN, MAX). No JOINs, no CTEs, no window functions.
- The SQL plugin returns at most ~200 rows by default (plugins.query.size_limit),
  even without a LIMIT — prefer aggregation (COUNT/AVG/GROUP BY) for whole-dataset
  questions rather than listing rows, so results aren't silently truncated.
- Always include LIMIT (default 100) unless aggregating.
- Return ONLY the SQL query. No prose.`;

const FEWSHOTS_OPENSEARCH = `Examples:
Q: show the most recent failed executions
A: SELECT executionArn, functionName, durationMs, emittedAt FROM \`TABLE_NAME\` WHERE status = 'FAILED' ORDER BY emittedAt DESC LIMIT 50

Q: average duration of successful executions
A: SELECT AVG(durationMs) AS avg_duration_ms FROM \`TABLE_NAME\` WHERE status = 'SUCCEEDED'

Q: count executions by status
A: SELECT status, COUNT(*) AS ct FROM \`TABLE_NAME\` GROUP BY status ORDER BY ct DESC

Q: executions longer than 5 seconds
A: SELECT executionArn, functionName, durationMs FROM \`TABLE_NAME\` WHERE status = 'SUCCEEDED' AND durationMs > 5000 ORDER BY durationMs DESC LIMIT 50

Q: average duration grouped by function
A: SELECT functionName, AVG(durationMs) AS avg_ms, COUNT(*) AS ct FROM \`TABLE_NAME\` GROUP BY functionName ORDER BY avg_ms DESC

Q: break down executions by claim type
A: SELECT input.claimType AS claim_type, COUNT(*) AS ct FROM \`TABLE_NAME\` GROUP BY input.claimType ORDER BY ct DESC

Q: show last 100 records
A: SELECT executionArn, status, functionName, durationMs, emittedAt FROM \`TABLE_NAME\` ORDER BY emittedAt DESC LIMIT 100`;

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
- input: string (JSON-serialized; use json_extract_scalar/json_extract to read fields — see lowercasing note below)
- output: string (JSON-serialized; use json_extract_scalar/json_extract to read fields — see lowercasing note below)
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
user-defined) — use json_extract_scalar(input, '$.fieldname') for scalars or
json_extract(input, '$.fieldname') for nested values. The user will specify which
fields they want — do not assume the structure.

IMPORTANT — key casing: the table's JSON SerDe lowercases ALL object keys when
parsing input/output (this does NOT affect top-level columns like executionArn,
functionName, etc. — only keys inside the input/output JSON blobs). A field named
"claimType" or "customerName" in the original payload must be looked up as
json_extract_scalar(output, '$.claimtype') / '$.customername' — camelCase or
mixed-case JSON path segments will silently return NULL. Always lowercase every
path segment when building a json_extract_scalar/json_extract path into input or
output.`;

const DIALECT_ATHENA = `Target query language: Trino/Presto SQL (Amazon Athena) — NOT standard ANSI SQL in all respects.
Rules:
- Table name is TABLE_NAME (already database-qualified by the connection — do not prefix it).
- To inspect operations, UNNEST the array and give the element its own alias, then reference THAT alias directly — NOT prefixed by the table alias. Correct: FROM TABLE_NAME t CROSS JOIN UNNEST(t.operations) AS u(op) ... then use op.name, op.type, op.status, op.durationMs, op.error, etc. WRONG: t.op.name (the unnested element op is its own alias, not a column of the table alias t; writing t.op.name fails with COLUMN_NOT_FOUND). Use a distinct alias for the unnest table (e.g. u) so it does not collide with the table alias.
- json_extract_scalar(col, '$.path') returns a scalar string; json_extract(col, '$.path') returns JSON — cast as needed, e.g. CAST(json_extract_scalar(...) AS double).
- Every path segment passed to json_extract_scalar/json_extract on input or output MUST be lowercase (the SerDe lowercases JSON keys on read) — e.g. '$.claimtype' not '$.claimType'.
- A field that lives inside input/output (e.g. claimType, decision, amount) is NEVER a bare column — it does not exist as a plain identifier anywhere in this table, including in GROUP BY, ORDER BY, and WHERE. Referencing it bare (e.g. "GROUP BY claimType" or "GROUP BY claim_type") fails with COLUMN_NOT_FOUND. Always wrap it in json_extract_scalar(input, '$.path') / json_extract_scalar(output, '$.path') — and repeat that full expression everywhere it's used (SELECT, GROUP BY, ORDER BY, WHERE), not just an alias, since GROUP BY/ORDER BY must reference the actual computed expression.
- COST — Athena bills by BYTES SCANNED and this table is partitioned by year/month/day. Do NOT let exploration scans hit the whole bucket: constrain EXPLORATION / sampling queries (shape discovery, key enumeration, quick LIMIT peeks) to a recent partition — add WHERE year = '<latest>' AND month = '<latest>' [AND day = '<latest>'] — so they scan one small slice. If you don't know the latest partition, find it first with a cheap query on the partition columns only (e.g. SELECT year, month, day FROM TABLE_NAME GROUP BY year, month, day ORDER BY year DESC, month DESC, day DESC LIMIT 1 — partition columns are metadata, so this scans almost nothing), then filter subsequent exploration to it. A shape sample does not need all-time data. Reserve an unpartitioned / all-time scan for the FINAL answer query, and only when the question genuinely needs full coverage. When the question implies a specific time range, filter year/month/day to match it.
- There is NO json_keys function in Athena/Trino. To list/enumerate the top-level KEYS of an input or output JSON object, parse it to a map and take its keys: map_keys(CAST(json_parse(input) AS MAP(VARCHAR, JSON))). This returns an array<varchar>; UNNEST it to get one key per row. Enumerated keys come back lowercased (same SerDe behavior as values).
- SELECT DISTINCT has a Trino constraint: every ORDER BY expression MUST also appear in the SELECT list (otherwise EXPRESSION_NOT_IN_DISTINCT). For a "distinct values" question, either drop the ORDER BY, or order by a column you're already selecting. To apply a row limit BEFORE de-duplicating (e.g. "distinct keys across the last 10 executions"), put the LIMIT/ORDER BY in a subquery and de-duplicate in the outer query.
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

Q: count executions grouped by claimType in the input
A: SELECT json_extract_scalar(input, '$.claimtype') AS claim_type, COUNT(*) AS ct FROM TABLE_NAME GROUP BY json_extract_scalar(input, '$.claimtype') ORDER BY ct DESC
-- NOTE: claimType is a field INSIDE the input JSON, not a table column — it
-- does not exist as a bare identifier. Never write "GROUP BY claimType" or
-- "GROUP BY claim_type" directly; always wrap it in
-- json_extract_scalar(input, '$.claimtype') (lowercased path), in BOTH the
-- SELECT list and the GROUP BY clause (repeat the full expression, not an
-- alias, since GROUP BY must match what was actually computed per row).
-- The same applies to output fields and to ORDER BY/WHERE on such a field.

Q: count executions grouped by the decision field in the output
A: SELECT json_extract_scalar(output, '$.decision') AS decision, COUNT(*) AS ct FROM TABLE_NAME GROUP BY json_extract_scalar(output, '$.decision') ORDER BY ct DESC

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

Q: executions where the output field "approvedAmount" was over 1000
A: SELECT executionArn, CAST(json_extract_scalar(output, '$.approvedamount') AS double) AS approved_amount FROM TABLE_NAME WHERE CAST(json_extract_scalar(output, '$.approvedamount') AS double) > 1000 LIMIT 50

Q: list all the keys present in the execution input for the last 10 executions
A: SELECT DISTINCT k FROM (SELECT input FROM TABLE_NAME ORDER BY emittedAt DESC LIMIT 10) t CROSS JOIN UNNEST(map_keys(CAST(json_parse(t.input) AS MAP(VARCHAR, JSON)))) AS u(k)
-- NOTE: there is no json_keys function — parse the JSON string to a map and
-- take map_keys, then UNNEST to one key per row. The inner subquery applies
-- "last 10 executions" (ORDER BY + LIMIT) BEFORE de-duplicating, because
-- SELECT DISTINCT can't ORDER BY a column that isn't in its select list.

Q: what output fields do successful executions produce
A: SELECT DISTINCT k FROM TABLE_NAME CROSS JOIN UNNEST(map_keys(CAST(json_parse(output) AS MAP(VARCHAR, JSON)))) AS u(k) WHERE status = 'SUCCEEDED'`;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extra guidance appended to the system prompt in advanced (agentic) mode
 * only. Gives the model an escape hatch: rather than forcing an awkward
 * answer into one query, it can fetch the raw relevant data and defer the
 * final derivation to a post-processing step.
 */
const AGENTIC_NOTE = [
  "You are in agentic mode with a follow-up post-processing step available.",
  "If a question is genuinely awkward to express in this query language (for",
  "example enumerating or deriving something across nested/JSON values that",
  "the engine can't easily compute), you may instead return a query that just",
  "fetches the raw relevant column(s) for the relevant rows and set",
  "postProcess=true, with postProcessGoal describing what to extract. A",
  "follow-up step will read those rows and produce the final answer. Prefer a",
  "normal, complete query whenever the query language CAN express the answer",
  "directly — only use postProcess when it genuinely can't.",
].join("\n");

/**
 * Closing instruction for the multi-turn agent tool-loop (advanced mode,
 * Bedrock). Replaces the single-shot "call emit_query" instruction: the model
 * drives, using run_query to explore/compute and finish to deliver the answer.
 */
const AGENT_INSTRUCTION = [
  "You work iteratively with two tools — do NOT try to answer in one shot:",
  "- run_query: run a read-only query to EXPLORE the data or compute a",
  "  candidate answer. You get back the columns, the row count, and a sample",
  "  of rows. Use this FIRST to discover anything you're unsure about —",
  "  especially which fields/keys actually exist, including inside nested or",
  "  JSON-valued fields like input/output — using the techniques for THIS",
  "  query language described above. NEVER guess a field/key name; verify it",
  "  exists first, then build the query that uses it.",
  "  Keep exploration cheap: when the data source is partitioned or",
  "  time-windowed, constrain sampling / shape-discovery queries to a recent",
  "  slice (e.g. the latest partition or a short lookback) instead of scanning",
  "  everything — a shape sample doesn't need all-time data. Reserve a full /",
  "  all-time scan for the final query, and only when the question truly needs",
  "  complete coverage.",
  "- finish: call this once you can answer the user. ALWAYS include `answer`: a",
  "  conversational, natural-language reply that directly addresses the question.",
  "  When you also return a `query`, its result rows are shown to the user in a",
  "  TABLE right below your reply — so do NOT restate or re-list those rows in",
  "  `answer`. Instead summarize them: how many, notable ranges/patterns, or the",
  "  specific insight asked for. For a plain 'show/list records' request, one or",
  "  two sentences is enough (the table shows the detail). Only when there is NO",
  "  supporting table (conceptual/metadata questions, e.g. 'which field holds the",
  "  amount?') should `answer` spell out the fields/values itself. Include `query`",
  "  when a result table supports the answer, plus explanation and",
  "  suggestedCharts. This is a CONVERSATION: you may reference earlier turns, and if",
  "  a follow-up can be answered from what you already know without a new query,",
  "  call finish with just an `answer` (no query).",
  "- run_javascript: after a run_query, transform or compute over its rows in",
  "  JavaScript when it's awkward in the query language (reshaping, custom",
  "  aggregation, deriving values). It has `rows` (row objects) and `columns`",
  "  in scope and must return the result. It's sandboxed — no file/network/host",
  "  access, pure computation over those rows. Prefer the query engine when it",
  "  can do the work; use run_javascript for the parts it can't.",
  "For log-based sources, set lookbackHours on run_query/finish to control the",
  "search time window (default 24); widen it if recent data is sparse. It is",
  "ignored for table/SQL sources, which aren't time-windowed.",
  "Keep it to a few focused queries: explore what you need, then finish.",
].join("\n");

export function buildSystemPrompt(
  destinationType: DestinationType,
  options?: {
    tableName?: string;
    agentic?: boolean;
    toolMode?: "emit" | "agent";
  },
): string {
  // The post-process affordance: tells the model it may defer awkward
  // computations to a follow-up step by returning raw data. Appended to every
  // destination's prompt when the caller enables it (the assistant always does
  // today); omitted otherwise.
  const agenticNote = options?.agentic ? ["", AGENTIC_NOTE] : [];
  // The closing instruction depends on how the model returns its work: the
  // single-shot emit_query tool (default) or the multi-turn run_query/finish
  // agent loop. Shared by every destination branch below.
  const closing =
    options?.toolMode === "agent"
      ? [AGENT_INSTRUCTION]
      : [
          'Call the "emit_query" tool with the query, a one-sentence explanation, and suggestedCharts (2-4 chart types from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot).',
          ...agenticNote,
        ];
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
      ...closing,
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
      ...closing,
    ].join("\n");
  }

  if (destinationType === "redshift") {
    const table = options?.tableName || "workflow_insight";
    return [
      "You convert a user's plain-English question into a single Amazon Redshift SQL query",
      "for querying AWS Durable Execution Workflow Insight records in Amazon Redshift.",
      "",
      RECORD_SCHEMA_REDSHIFT.replace(/TABLE_NAME/g, table),
      "",
      DIALECT_REDSHIFT.replace(/TABLE_NAME/g, table),
      "",
      FEWSHOTS_REDSHIFT.replace(/TABLE_NAME/g, table),
      "",
      ...closing,
    ].join("\n");
  }

  if (destinationType === "opensearch") {
    const table = options?.tableName || "workflow-insight";
    return [
      "You convert a user's plain-English question into a single OpenSearch SQL query",
      "for querying AWS Durable Execution Workflow Insight records in Amazon OpenSearch.",
      "",
      RECORD_SCHEMA_OPENSEARCH.replace(/TABLE_NAME/g, table),
      "",
      DIALECT_OPENSEARCH.replace(/TABLE_NAME/g, table),
      "",
      FEWSHOTS_OPENSEARCH.replace(/TABLE_NAME/g, table),
      "",
      ...closing,
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
      ...closing,
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
    ...closing,
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
