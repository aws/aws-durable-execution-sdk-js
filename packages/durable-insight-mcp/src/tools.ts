/**
 * The structured Insight tools: `describe_schema`, `get_execution`,
 * `list_executions`, plus the two tools' shared descriptions.
 *
 * DESIGN — every caller-supplied value reaches SQL through ONE path:
 *   `get_execution` and `list_executions` both BUILD a SELECT here and execute
 *   it through {@link runReadOnlyQuery} — the package's single query choke
 *   point — so they inherit `assertReadOnly` and the {@link MAX_ROWS} row cap
 *   for free. Neither imports a core runner (that is what
 *   `queryChokePoint.test.ts` enforces). We deliberately do NOT call core's
 *   `fetchAthenaRecord`/`fetchDynamoDBRecord` for `get_execution`: those escape
 *   internally, which would (a) route caller SQL AROUND the choke point /
 *   `assertReadOnly`, and (b) make the escaping in THIS package non-load-bearing
 *   (it lives in core, which we may not modify). Building the SELECT here keeps
 *   the sanitization — and the responsibility for it — in this package, and
 *   under the same read-only guard as every other query.
 *
 *   The values themselves are sanitized in `sqlSafe.ts` BEFORE the string is
 *   assembled: a closed enum (`status`) and partition digits are VALIDATED (and
 *   a bad value rejected), free-form text (`functionName`, the execution id) is
 *   quote-escaped exactly as core does. `assertReadOnly` is the backstop, never
 *   the sanitizer — an injected `' OR '1'='1` is a valid SELECT it would allow.
 *
 * DESCRIPTIONS — a tool description must stay small. Descriptions over ~10,000
 *   characters measurably degrade agent tool-selection, so the large,
 *   destination-specific schema guidance (from core's `buildSystemPrompt`) is
 *   returned by `describe_schema` in its RESULT, never embedded in a
 *   description. `toolDescriptions.test.ts` asserts every description here is
 *   non-empty and under the cap.
 */
import { buildSystemPrompt, type InsightConfig } from "durable-insight-core";
import { MAX_ROWS, runReadOnlyQuery } from "./readOnlyQuery";
import {
  coerceLimit,
  escapeSqlString,
  validatePartitionComponent,
  validateStatus,
  validateTimestamp,
} from "./sqlSafe";

/** Default number of rows `list_executions` returns when no `limit` is given. */
export const DEFAULT_LIST_LIMIT = 100;

// ── Tool descriptions (kept small; see the file header) ──────────────────────

/**
 * One or two sentences, well under the 10,000-char cap. Bulk detail lives in the
 * tool result (machine-readable JSON), not in this description.
 */
export const TEST_DESTINATION_DESCRIPTION =
  "Run read-only connectivity and completeness checks against the configured " +
  "Insight destination (configured via DURABLE_INSIGHT_* environment variables) " +
  "and return a machine-readable JSON report. If required environment variables " +
  "are unset it names them and returns without making any AWS calls.";

/**
 * Short by design (well under the 10,000-char cap). The security contract — the
 * query is validated read-only before any AWS call — is stated so the agent
 * knows a write will be refused rather than silently mutating data.
 */
export const QUERY_DESCRIPTION =
  "Execute a single READ-ONLY SQL/PartiQL query against the configured Insight " +
  "destination (set via DURABLE_INSIGHT_* environment variables) and return the " +
  "result as machine-readable JSON (columns, rows, count, truncated, engine, " +
  "destinationType). Only SELECT/WITH is permitted: any data-modifying or DDL " +
  "statement is rejected before any AWS call is made. Results are capped at " +
  `${MAX_ROWS} rows; "truncated" is true when the cap was hit. If required ` +
  "environment variables are unset it names them and returns without calling AWS.";

export const DESCRIBE_SCHEMA_DESCRIPTION =
  "Describe the configured Insight destination's record schema and query " +
  "idioms as machine-readable JSON: the destination type, the query engine/" +
  "dialect label, the table (or log group) in play, the row cap, and a large " +
  "guidance string (from the SDK) covering the record fields and dialect-" +
  "specific query patterns. Call this before writing a query so the query you " +
  "pass to the `query` tool uses the right field names and syntax.";

export const GET_EXECUTION_DESCRIPTION =
  "Fetch a single Workflow Insight execution record by its execution ARN and " +
  "return it as machine-readable JSON. A record that does not exist is a " +
  "success with found=false, not an error. For the Athena/S3 destination you " +
  "may also pass year/month/day to prune to one partition and avoid scanning " +
  "the whole table. Runs as a read-only query behind the same guard as `query`.";

export const LIST_EXECUTIONS_DESCRIPTION =
  "List Workflow Insight execution records as machine-readable JSON, filtered " +
  "by any of status, functionName, since, until, with a bounded limit — no SQL " +
  "required from the caller for the common case. The query is built and " +
  "executed read-only behind the same guard as `query`; results are capped at " +
  `${MAX_ROWS} rows.`;

/**
 * Every tool this server registers, paired with its description. The single
 * source of truth for `toolDescriptions.test.ts`, which asserts each is
 * non-empty and under the 10,000-char cap — the guard that keeps the large
 * `buildSystemPrompt` guidance in `describe_schema`'s RESULT and out of any
 * description.
 */
export const TOOL_DESCRIPTIONS: ReadonlyArray<{
  name: string;
  description: string;
}> = [
  { name: "test_destination", description: TEST_DESTINATION_DESCRIPTION },
  { name: "query", description: QUERY_DESCRIPTION },
  { name: "describe_schema", description: DESCRIBE_SCHEMA_DESCRIPTION },
  { name: "get_execution", description: GET_EXECUTION_DESCRIPTION },
  { name: "list_executions", description: LIST_EXECUTIONS_DESCRIPTION },
];

// ── describe_schema ──────────────────────────────────────────────────────────

/** Engine label + table name for a destination, matching `readOnlyQuery.ts`. */
function engineAndTable(cfg: InsightConfig): { engine: string; table: string } {
  switch (cfg.destinationType) {
    case "dynamodb":
      return { engine: "PartiQL", table: cfg.dynamodbTableName };
    case "s3":
      return { engine: "Trino/Presto SQL", table: cfg.athenaTable };
    default:
      throw new Error(
        `describe_schema is not supported for destination type ` +
          `"${cfg.destinationType}" in this version. Supported destinations: ` +
          `"dynamodb", "s3".`,
      );
  }
}

export interface DescribeSchemaResult {
  destinationType: string;
  engine: string;
  table: string;
  maxRows: number;
  guidance: string;
  guidanceLength: number;
}

/**
 * Build the `describe_schema` result. The heavy `guidance` string comes
 * verbatim from core's `buildSystemPrompt` (do not paraphrase it — it already
 * encodes each destination's record schema and query idioms). Its length is
 * reported so the agent knows why it is large and that it belongs in the result
 * rather than a description.
 */
export function buildDescribeSchemaResult(
  cfg: InsightConfig,
): DescribeSchemaResult {
  const { engine, table } = engineAndTable(cfg);
  const guidance = buildSystemPrompt(cfg.destinationType, {
    tableName: table || undefined,
  });
  return {
    destinationType: cfg.destinationType,
    engine,
    table,
    maxRows: MAX_ROWS,
    guidance,
    guidanceLength: guidance.length,
  };
}

// ── get_execution ────────────────────────────────────────────────────────────

export interface GetExecutionParams {
  executionArn: string;
  year?: string;
  month?: string;
  day?: string;
}

/**
 * Build the single-record lookup SELECT for `executionArn`.
 *
 * The id is quote-escaped (never interpolated raw), so the predicate is always
 * a single equality against the id as a LITERAL — an injected `' OR '1'='1`
 * becomes the escaped literal `'x'' OR ''1''=''1'`, not a tautology. For Athena,
 * validated year/month/day (digits only) add an equality predicate on the
 * partition columns so Athena prunes instead of scanning the whole table.
 */
export function buildGetExecutionSql(
  cfg: InsightConfig,
  params: GetExecutionParams,
): string {
  const id = escapeSqlString(params.executionArn);
  if (cfg.destinationType === "s3") {
    const parts: string[] = [];
    if (params.year !== undefined) {
      parts.push(`year = '${validatePartitionComponent("year", params.year)}'`);
    }
    if (params.month !== undefined) {
      parts.push(
        `month = '${validatePartitionComponent("month", params.month)}'`,
      );
    }
    if (params.day !== undefined) {
      parts.push(`day = '${validatePartitionComponent("day", params.day)}'`);
    }
    const partitionPredicate = parts.map((p) => `${p} AND `).join("");
    return (
      `SELECT * FROM ${cfg.athenaTable} ` +
      `WHERE ${partitionPredicate}executionarn = '${id}' LIMIT 1`
    );
  }
  // dynamodb (PartiQL): no LIMIT clause (unsupported); the row cap in
  // runReadOnlyQuery bounds it. Table name is double-quoted per the dialect.
  return `SELECT * FROM "${cfg.dynamodbTableName}" WHERE pk = '${id}'`;
}

export interface GetExecutionResult {
  destinationType: string;
  engine: string;
  found: boolean;
  executionArn: string;
  record?: Record<string, string>;
}

/**
 * Execute `get_execution`: build the lookup SELECT and run it through the
 * choke point. Zero rows is a successful `found: false`, not an error.
 */
export async function runGetExecution(
  cfg: InsightConfig,
  params: GetExecutionParams,
): Promise<GetExecutionResult> {
  const sql = buildGetExecutionSql(cfg, params);
  const result = await runReadOnlyQuery(cfg, sql);
  if (result.rows.length === 0) {
    return {
      destinationType: cfg.destinationType,
      engine: result.engine,
      found: false,
      executionArn: params.executionArn,
    };
  }
  const row = result.rows[0];
  const record: Record<string, string> = {};
  result.columns.forEach((col, i) => {
    record[col] = row[i] ?? "";
  });
  return {
    destinationType: cfg.destinationType,
    engine: result.engine,
    found: true,
    executionArn: params.executionArn,
    record,
  };
}

// ── list_executions ──────────────────────────────────────────────────────────

export interface ListExecutionsParams {
  status?: string;
  since?: string;
  until?: string;
  functionName?: string;
  limit?: number;
}

/**
 * Build the filtered list SELECT.
 *
 * `status` is validated against the known set (rejected if unknown);
 * `since`/`until` are validated as ISO timestamps (rejected if malformed) —
 * both are then safe to interpolate because their validated shapes cannot
 * contain a quote. `functionName` is free-form text, so it is quote-escaped.
 * Column names differ per engine (lowercase for Athena, camelCase for
 * DynamoDB); the `recordType`/`recordtype` guard isolates insight records.
 */
export function buildListExecutionsSql(
  cfg: InsightConfig,
  params: ListExecutionsParams,
): string {
  const isS3 = cfg.destinationType === "s3";
  const col = {
    recordType: isS3 ? "recordtype" : "recordType",
    status: "status",
    functionName: isS3 ? "functionname" : "functionName",
    startTime: isS3 ? "starttime" : "startTime",
  };
  const select = isS3
    ? "executionarn, status, functionname, starttime, endtime, durationms"
    : "pk, status, functionName, startTime, endTime, durationMs";
  const from = isS3 ? cfg.athenaTable : `"${cfg.dynamodbTableName}"`;

  const where: string[] = [`${col.recordType} = 'WorkflowInsight'`];
  if (params.status !== undefined) {
    where.push(`${col.status} = '${validateStatus(params.status)}'`);
  }
  if (params.functionName !== undefined) {
    where.push(
      `${col.functionName} = '${escapeSqlString(params.functionName)}'`,
    );
  }
  if (params.since !== undefined) {
    where.push(
      `${col.startTime} >= '${validateTimestamp("since", params.since)}'`,
    );
  }
  if (params.until !== undefined) {
    where.push(
      `${col.startTime} <= '${validateTimestamp("until", params.until)}'`,
    );
  }

  const limit = coerceLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_ROWS);
  const whereClause = where.join(" AND ");

  if (isS3) {
    // Trino supports ORDER BY + LIMIT; most-recent-first is the useful default.
    return (
      `SELECT ${select} FROM ${from} WHERE ${whereClause} ` +
      `ORDER BY ${col.startTime} DESC LIMIT ${limit}`
    );
  }
  // dynamodb (PartiQL): ORDER BY and LIMIT are unsupported; the row cap in
  // runReadOnlyQuery bounds the result to MAX_ROWS.
  return `SELECT ${select} FROM ${from} WHERE ${whereClause}`;
}

export interface ListExecutionsResult {
  destinationType: string;
  engine: string;
  columns: string[];
  rows: string[][];
  count: number;
  truncated: boolean;
}

/**
 * Execute `list_executions`: build the filtered SELECT and run it through the
 * choke point (which applies `assertReadOnly` and the row cap).
 */
export async function runListExecutions(
  cfg: InsightConfig,
  params: ListExecutionsParams,
): Promise<ListExecutionsResult> {
  const sql = buildListExecutionsSql(cfg, params);
  const result = await runReadOnlyQuery(cfg, sql);
  return {
    destinationType: cfg.destinationType,
    engine: result.engine,
    columns: result.columns,
    rows: result.rows,
    count: result.count,
    truncated: result.truncated,
  };
}
