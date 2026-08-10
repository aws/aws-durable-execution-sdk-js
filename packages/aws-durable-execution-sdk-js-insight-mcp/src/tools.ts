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
import {
  buildSystemPrompt,
  escapeQuotedString,
  fetchLogsInsightsRecord,
  resolveCredentials,
  type InsightConfig,
} from "@aws/durable-execution-sdk-js-insight-core";
import {
  DEFAULT_LOG_TIME_RANGE_MS,
  LOGS_INSIGHTS_ENGINE,
  MAX_ROWS,
  runReadOnlyQuery,
} from "./readOnlyQuery";
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
  "Execute a single READ-ONLY query against the configured Insight " +
  "destination (set via DURABLE_INSIGHT_* environment variables) and return the " +
  "result as machine-readable JSON (columns, rows, count, truncated, engine, " +
  "destinationType). For the SQL destinations (dynamodb, s3, aurora, redshift, " +
  "opensearch) only SELECT/WITH is permitted: any data-modifying or DDL " +
  "statement is rejected before any AWS call is made. For the CloudWatch Logs " +
  "destinations (cloudwatch-logs-exporter, lambda-log-exporter) pass a CloudWatch " +
  "Logs Insights pipe query (e.g. `filter ... | stats ...`), NOT SQL; use " +
  "`lookbackHours` to set the time window. Results are capped at " +
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

/** True for the two CloudWatch Logs Insights destinations (NOT SQL). */
function isLogDestination(cfg: InsightConfig): boolean {
  return (
    cfg.destinationType === "cloudwatch-logs-exporter" ||
    cfg.destinationType === "lambda-log-exporter"
  );
}

/** Engine label + table name for a destination, matching `readOnlyQuery.ts`. */
/**
 * The Redshift query target, schema-qualified.
 *
 * `redshiftSchema` is a documented setting that defaults to `public`, and core
 * qualifies with it everywhere it builds Redshift SQL (`explorerSession.ts` in three
 * places, `destinationTest.ts` in one). This package used the bare table name, which
 * survived every test for a reason worth knowing: with the default `public` the
 * unqualified name resolves through `search_path` and behaves identically. Set
 * DURABLE_INSIGHT_REDSHIFT_SCHEMA to anything else and the same SQL silently reads a
 * DIFFERENT table, or fails.
 *
 * Both the generated SQL and the guidance `describe_schema` hands the agent go
 * through here, because a target the agent is TAUGHT that differs from the target
 * queried is its own bug: the agent would write correct-looking SQL against a table
 * that is not the one being read.
 *
 * Only Redshift is qualified this way, matching core exactly: Aurora has no schema
 * setting, Athena's database is passed to the runner as a separate parameter, and
 * DynamoDB and OpenSearch have no schema concept.
 */
function redshiftTarget(cfg: InsightConfig): string {
  return `${cfg.redshiftSchema}.${cfg.redshiftTable}`;
}

function engineAndTable(cfg: InsightConfig): { engine: string; table: string } {
  switch (cfg.destinationType) {
    case "dynamodb":
      return { engine: "PartiQL", table: cfg.dynamodbTableName };
    case "s3":
      return { engine: "Trino/Presto SQL", table: cfg.athenaTable };
    case "aurora":
      return { engine: "PostgreSQL", table: cfg.auroraTable };
    case "redshift":
      return { engine: "Redshift SQL", table: redshiftTarget(cfg) };
    case "opensearch":
      // The OpenSearch "table" is the index; buildSystemPrompt wraps it in
      // backticks in the FROM clause it generates.
      return { engine: "OpenSearch SQL", table: cfg.opensearchIndex };
    case "cloudwatch-logs-exporter":
    case "lambda-log-exporter":
      // Logs Insights is not SQL and has no "table" — the query runs over one
      // or more LOG GROUPS. Report them (comma-joined) so the agent sees what
      // it is querying; buildSystemPrompt ignores tableName for these types.
      return {
        engine: LOGS_INSIGHTS_ENGINE,
        table: cfg.logGroupNames.join(", "),
      };
    default:
      throw new Error(
        `describe_schema is not supported for destination type ` +
          `"${cfg.destinationType}" in this version. Supported destinations: ` +
          `"dynamodb", "s3", "aurora", "redshift", "opensearch", ` +
          `"cloudwatch-logs-exporter", "lambda-log-exporter".`,
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
  /**
   * How to actually run the SQL that `guidance` teaches you to write. Present
   * because `guidance` comes from a function shared with the VS Code extension,
   * whose closing instruction names tools that do not exist in this host -- see
   * `stripForeignToolInstruction`.
   */
  howToRun: string;
}

/**
 * Tools that exist in the VS Code extension's own LLM loop but NOT in this MCP
 * host. `buildSystemPrompt` ends with an instruction to call one of them, which
 * is wrong here: an agent that followed it would call an unknown tool and stall.
 *
 * Found by running `describe_schema` against a real Aurora destination -- the
 * unit tests asserted the guidance was long and self-consistent, which it was;
 * they could not know that its closing sentence addressed a different host.
 */
const FOREIGN_TOOL_MARKER = 'Call the "emit_query" tool';

/**
 * Remove the trailing "call <extension tool>" instruction from shared guidance,
 * keeping the part that is actually valuable here: the record schema and the
 * per-destination query idioms.
 *
 * Deliberately conservative. If the marker is absent (because core reworded it)
 * the guidance is returned untouched rather than being cut at a guess, and
 * `howToRun` still tells the agent what to do. `describeSchema.test.ts` asserts
 * the returned guidance never mentions any foreign tool -- it keeps its own,
 * broader list for that -- so a reword that breaks this is caught rather than
 * silently shipped. There is deliberately ONE marker here: a second entry existed
 * briefly and was never read, which read as a guard while guarding nothing.
 */
function stripForeignToolInstruction(guidance: string): string {
  const idx = guidance.indexOf(FOREIGN_TOOL_MARKER);
  if (idx === -1) return guidance.trim();
  return guidance.slice(0, idx).trim();
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
  const guidance = stripForeignToolInstruction(
    buildSystemPrompt(cfg.destinationType, {
      tableName: table || undefined,
    }),
  );
  return {
    destinationType: cfg.destinationType,
    engine,
    table,
    maxRows: MAX_ROWS,
    guidance,
    guidanceLength: guidance.length,
    howToRun:
      `Run the SQL you write with the "query" tool. Prefer "list_executions" ` +
      `for simple filtered listings and "get_execution" to fetch one record by ` +
      `ARN. Results are capped at ${MAX_ROWS} rows. Only read queries are ` +
      `permitted; anything that is not SELECT/WITH is refused.`,
  };
}

// ── get_execution ────────────────────────────────────────────────────────────

/**
 * Default window for a log-destination point lookup, in hours.
 *
 * Mirrors core's `fetchLogsInsightsRecord` default (7 days) so that omitting
 * `lookbackHours` behaves identically to before this parameter existed -- but now
 * the value is reported back, so `found: false` says which window was searched.
 */
export const DEFAULT_RECORD_LOOKBACK_HOURS = 7 * 24;

export interface GetExecutionParams {
  executionArn: string;
  year?: string;
  month?: string;
  day?: string;
  /**
   * Log destinations only: how many hours back to search. Logs Insights requires an
   * explicit window, so without this the search is bounded by core's 7-day default
   * and an older execution reports `found: false` -- indistinguishable from one that
   * never existed.
   */
  lookbackHours?: number;
}

/**
 * Per-destination SQL idioms for the structured tools.
 *
 * The dialects genuinely DIVERGE — table quoting, column casing, whether a
 * `recordType` discriminator column even exists, and whether ORDER BY/LIMIT are
 * usable all differ — so each field is sourced from core's `buildSystemPrompt`
 * guidance for that destination (schema.ts), never assumed portable:
 *   - Table quoting: bare for Athena/Aurora/Redshift, double-quoted for DynamoDB
 *     PartiQL, backtick-quoted for OpenSearch (its index name has a hyphen).
 *   - Column casing: lowercase (Athena), snake_case (Aurora/Redshift),
 *     camelCase (DynamoDB/OpenSearch).
 *   - `recordType` guard: Athena/DynamoDB/OpenSearch store a recordType field
 *     and filter on it; Aurora/Redshift store insight records in a DEDICATED
 *     table with NO such column, so the guard is omitted (emitting it would be
 *     a "column does not exist" error).
 *   - ORDER BY/LIMIT: the four SQL engines support it; PartiQL for DynamoDB
 *     supports neither (the runReadOnlyQuery cap bounds it instead).
 */
interface Dialect {
  /** Engine label, matching runReadOnlyQuery / assertReadOnly. */
  engine: string;
  /** FROM-clause target, quoted the way THIS engine requires. */
  from: string;
  /** Column holding the execution id (get_execution equality predicate). */
  idColumn: string;
  /** Projection for list_executions. */
  listSelect: string;
  /** status column name (list_executions filter). */
  statusColumn: string;
  /** functionName column name (list_executions filter). */
  functionNameColumn: string;
  /** start-time column name (list_executions since/until filter + ordering). */
  startTimeColumn: string;
  /**
   * The `recordType = 'WorkflowInsight'` discriminator column, or undefined when
   * the destination has no such column (Aurora/Redshift dedicated table).
   */
  recordTypeColumn?: string;
  /**
   * Whether ORDER BY <startTime> DESC LIMIT n is appended in list_executions.
   * For OpenSearch this is safe only because startTime is a DATE field — its SQL
   * plugin forbids ORDER BY on a raw text field.
   */
  orderByAndLimit: boolean;
}

/** Resolve the {@link Dialect} for the configured destination. */
function dialectFor(cfg: InsightConfig): Dialect {
  switch (cfg.destinationType) {
    case "s3":
      return {
        engine: "Trino/Presto SQL",
        from: cfg.athenaTable,
        idColumn: "executionarn",
        listSelect:
          "executionarn, status, functionname, starttime, endtime, durationms",
        statusColumn: "status",
        functionNameColumn: "functionname",
        startTimeColumn: "starttime",
        recordTypeColumn: "recordtype",
        orderByAndLimit: true,
      };
    case "dynamodb":
      return {
        engine: "PartiQL",
        from: `"${cfg.dynamodbTableName}"`,
        idColumn: "pk",
        listSelect: "pk, status, functionName, startTime, endTime, durationMs",
        statusColumn: "status",
        functionNameColumn: "functionName",
        startTimeColumn: "startTime",
        recordTypeColumn: "recordType",
        orderByAndLimit: false,
      };
    case "aurora":
      return {
        engine: "PostgreSQL",
        from: cfg.auroraTable,
        idColumn: "execution_arn",
        listSelect:
          "execution_arn, status, function_name, start_time, end_time, duration_ms",
        statusColumn: "status",
        functionNameColumn: "function_name",
        startTimeColumn: "start_time",
        recordTypeColumn: undefined,
        orderByAndLimit: true,
      };
    case "redshift":
      return {
        engine: "Redshift SQL",
        from: redshiftTarget(cfg),
        idColumn: "execution_arn",
        listSelect:
          "execution_arn, status, function_name, start_time, end_time, duration_ms",
        statusColumn: "status",
        functionNameColumn: "function_name",
        startTimeColumn: "start_time",
        recordTypeColumn: undefined,
        orderByAndLimit: true,
      };
    case "opensearch":
      return {
        engine: "OpenSearch SQL",
        // Index name contains a hyphen -> MUST be backtick-quoted in FROM.
        from: `\`${cfg.opensearchIndex}\``,
        idColumn: "executionArn",
        listSelect:
          "executionArn, status, functionName, startTime, endTime, durationMs",
        statusColumn: "status",
        functionNameColumn: "functionName",
        startTimeColumn: "startTime",
        recordTypeColumn: "recordType",
        orderByAndLimit: true,
      };
    default:
      throw new Error(
        `The structured tools are not supported for destination type ` +
          `"${cfg.destinationType}" in this version. Supported destinations: ` +
          `"dynamodb", "s3", "aurora", "redshift", "opensearch".`,
      );
  }
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
  const d = dialectFor(cfg);

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
      `SELECT * FROM ${d.from} ` +
      `WHERE ${partitionPredicate}${d.idColumn} = '${id}' LIMIT 1`
    );
  }

  if (cfg.destinationType === "dynamodb") {
    // PartiQL: no LIMIT clause (unsupported); the row cap in runReadOnlyQuery
    // bounds it. Table name is double-quoted per the dialect.
    return `SELECT * FROM ${d.from} WHERE ${d.idColumn} = '${id}'`;
  }

  // aurora / redshift / opensearch: a standard single-row lookup. All three
  // support LIMIT 1; identifier quoting and the id column name come from the
  // dialect (execution_arn for Aurora/Redshift, executionArn for OpenSearch).
  return `SELECT * FROM ${d.from} WHERE ${d.idColumn} = '${id}' LIMIT 1`;
}

export interface GetExecutionResult {
  destinationType: string;
  engine: string;
  found: boolean;
  executionArn: string;
  record?: Record<string, string>;
  /**
   * The window actually searched, for log destinations. Present so that
   * `found: false` is interpretable: "not in the last 168 hours" is a different
   * statement from "does not exist", and an agent cannot tell them apart without
   * being told which one it got.
   */
  searchedLookbackHours?: number;
  /**
   * Parameters that were supplied and had no effect on this destination. Silently
   * ignoring an argument teaches an agent that it worked.
   */
  ignoredParams?: string[];
}

/**
 * Execute `get_execution`: build the lookup SELECT and run it through the
 * choke point. Zero rows is a successful `found: false`, not an error.
 */
export async function runGetExecution(
  cfg: InsightConfig,
  params: GetExecutionParams,
): Promise<GetExecutionResult> {
  // CloudWatch Logs Insights: there is no SQL to build and no point-lookup API.
  // We deliberately route this ONE case around the SQL choke point and call
  // core's `fetchLogsInsightsRecord` instead, for reasons that are all
  // load-bearing:
  //   - It correctly handles BOTH log record shapes — "direct"
  //     (cloudwatch-logs-exporter, raw JSON fields) and "nested"
  //     (lambda-log-exporter, a JSON string inside a `message` field) — trying a
  //     field match then a message-substring match. Rebuilding that
  //     two-shape fallback here would duplicate core logic we must not touch.
  //   - It already escapes the agent-supplied `executionArn` with
  //     `escapeQuotedString` (backslashes-then-quotes) before embedding it in a
  //     double-quoted Logs Insights literal — the correct escaper for this
  //     language (NOT the SQL single-quote doubler).
  //   - It is already bounded (`| limit 1`), and Logs Insights has no write
  //     constructs, so the choke point's two jobs — `assertReadOnly` and the row
  //     cap — add nothing on this path (the choke point does not apply
  //     `assertReadOnly` to logs anyway). `fetchLogsInsightsRecord` is a fetch
  //     helper, NOT a core runner, so calling it here does not violate the
  //     one-runner-import rule that `queryChokePoint.test.ts` enforces.
  // Partition components prune an Athena/S3 scan and mean nothing anywhere else.
  // Report them rather than dropping them: a passed-but-ignored parameter that
  // produces no signal is indistinguishable, from the agent's side, from one that
  // was honored.
  const ignoredParams =
    cfg.destinationType === "s3"
      ? []
      : (["year", "month", "day"] as const).filter(
          (k) => params[k] !== undefined,
        );

  if (isLogDestination(cfg)) {
    const credentials = resolveCredentials(cfg.awsProfile);
    const lookbackHours =
      params.lookbackHours !== undefined && params.lookbackHours > 0
        ? params.lookbackHours
        : DEFAULT_RECORD_LOOKBACK_HOURS;
    const record = await fetchLogsInsightsRecord({
      region: cfg.region,
      credentials,
      logGroupNames: cfg.logGroupNames,
      executionArn: params.executionArn,
      lookbackMs: lookbackHours * 60 * 60 * 1000,
    });
    return {
      destinationType: cfg.destinationType,
      engine: LOGS_INSIGHTS_ENGINE,
      found: record !== undefined,
      executionArn: params.executionArn,
      searchedLookbackHours: lookbackHours,
      ...(ignoredParams.length > 0
        ? { ignoredParams: [...ignoredParams] }
        : {}),
      ...(record !== undefined ? { record } : {}),
    };
  }

  const sql = buildGetExecutionSql(cfg, params);
  const result = await runReadOnlyQuery(cfg, sql);
  if (result.rows.length === 0) {
    return {
      destinationType: cfg.destinationType,
      engine: result.engine,
      found: false,
      executionArn: params.executionArn,
      ...(ignoredParams.length > 0
        ? { ignoredParams: [...ignoredParams] }
        : {}),
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
    ...(ignoredParams.length > 0 ? { ignoredParams: [...ignoredParams] } : {}),
    record,
  };
}

// ── list_executions ──────────────────────────────────────────────────────────

/**
 * Resolve the Logs Insights API window for a `list_executions` call.
 *
 * PRECEDENCE, and why:
 *   1. An explicit `lookbackHours` wins -- the caller stated the window outright.
 *   2. Otherwise `since` derives it, because a lower bound the caller asked to filter
 *      on is worthless if the API never scanned that far back.
 *   3. Otherwise the 24-hour default, matching `query`.
 *
 * The derived window is rounded UP to the next whole hour and given a small margin,
 * so a `since` of "exactly 7 days ago" cannot land a fraction of a second inside the
 * boundary and clip the oldest matching event.
 *
 * An unparseable `since` falls back to the default rather than throwing, which keeps
 * this helper total. Note that this branch is UNREACHABLE through the tool: the query
 * is built first, and `validateTimestamp` rejects a malformed bound there, so a bad
 * value never arrives here. `tools.test.ts` pins that ordering, since it is the
 * difference between a clean rejection and a silent 24-hour window.
 */
function logWindowFor(params: ListExecutionsParams): {
  timeRangeMs: number;
  lookbackHours: number;
} {
  const fromHours = (hours: number) => ({
    timeRangeMs: hours * 60 * 60 * 1000,
    lookbackHours: hours,
  });

  if (params.lookbackHours !== undefined && params.lookbackHours > 0) {
    return fromHours(params.lookbackHours);
  }

  if (params.since !== undefined) {
    const sinceMs = Date.parse(params.since);
    if (!Number.isNaN(sinceMs)) {
      const spanMs = Date.now() - sinceMs;
      if (spanMs > 0) {
        // +1 hour of margin, then round up: never scan less than asked for.
        const hours = Math.ceil(spanMs / (60 * 60 * 1000)) + 1;
        return fromHours(hours);
      }
    }
  }

  return fromHours(DEFAULT_LOG_TIME_RANGE_MS / (60 * 60 * 1000));
}

export interface ListExecutionsParams {
  status?: string;
  since?: string;
  until?: string;
  functionName?: string;
  limit?: number;
  /**
   * Log destinations only: how many hours back `StartQuery` should scan. Normally
   * unnecessary -- when `since` is given the window is derived from it -- but needed
   * to widen a search that has no lower bound.
   */
  lookbackHours?: number;
}

/**
 * Build the filtered list SELECT.
 *
 * `status` is validated against the known set (rejected if unknown);
 * `since`/`until` are validated as ISO timestamps (rejected if malformed) —
 * both are then safe to interpolate because their validated shapes cannot
 * contain a quote. `functionName` is free-form text, so it is quote-escaped.
 * Everything engine-specific — column casing, table quoting, whether a
 * `recordType` guard exists, and whether ORDER BY/LIMIT are appended — comes
 * from {@link dialectFor}, because these idioms are NOT portable across Trino,
 * PartiQL, PostgreSQL, Redshift and OpenSearch SQL.
 */
export function buildListExecutionsSql(
  cfg: InsightConfig,
  params: ListExecutionsParams,
): string {
  const d = dialectFor(cfg);

  const where: string[] = [];
  // Aurora/Redshift have no recordType column (dedicated table) — omit the
  // discriminator entirely there; it would be a "column does not exist" error.
  if (d.recordTypeColumn !== undefined) {
    where.push(`${d.recordTypeColumn} = 'WorkflowInsight'`);
  }
  if (params.status !== undefined) {
    where.push(`${d.statusColumn} = '${validateStatus(params.status)}'`);
  }
  if (params.functionName !== undefined) {
    where.push(
      `${d.functionNameColumn} = '${escapeSqlString(params.functionName)}'`,
    );
  }
  if (params.since !== undefined) {
    where.push(
      `${d.startTimeColumn} >= '${validateTimestamp("since", params.since)}'`,
    );
  }
  if (params.until !== undefined) {
    where.push(
      `${d.startTimeColumn} <= '${validateTimestamp("until", params.until)}'`,
    );
  }

  const limit = coerceLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_ROWS);
  // With no recordType guard and no filters, the WHERE list can be empty
  // (Aurora/Redshift with no params) — emit no WHERE clause in that case.
  const whereClause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";

  if (d.orderByAndLimit) {
    // Trino, PostgreSQL, Redshift and OpenSearch SQL all support ORDER BY +
    // LIMIT; most-recent-first is the useful default. (OpenSearch orders on
    // startTime, a DATE field — ordering a raw text field there is rejected.)
    return (
      `SELECT ${d.listSelect} FROM ${d.from}${whereClause} ` +
      `ORDER BY ${d.startTimeColumn} DESC LIMIT ${limit}`
    );
  }
  // dynamodb (PartiQL): ORDER BY and LIMIT are unsupported, so this statement
  // carries no bound. `runListExecutions` passes the caller's limit as the row cap
  // instead, which is what actually bounds this path.
  return `SELECT ${d.listSelect} FROM ${d.from}${whereClause}`;
}

/**
 * Build the filtered `list_executions` query for a CloudWatch Logs Insights
 * destination — a pipe query, NOT SQL.
 *
 * This is the log counterpart to {@link buildListExecutionsSql}. The two log
 * shapes require different queries, both sourced from core's `buildSystemPrompt`
 * dialect guidance (`schema.ts`):
 *   - "direct" (cloudwatch-logs-exporter): fields are top-level, so filters read
 *     them directly and the base discriminator is
 *     `filter recordType = "WorkflowInsight"`.
 *   - "nested" (lambda-log-exporter): the record is a JSON string inside
 *     `message`, so we isolate insight records with
 *     `filter level = "INFO" and message like /WorkflowInsight/`, `parse` the
 *     needed fields out of the message, then filter on the parsed aliases.
 *
 * In BOTH shapes every agent-supplied value is interpolated into a
 * DOUBLE-QUOTED Logs Insights literal and escaped with core's
 * `escapeQuotedString` (the correct escaper for this language — NOT the SQL
 * single-quote doubler). `status` is validated against the closed enum and
 * `since`/`until` against the ISO-timestamp shape (rejected if malformed),
 * exactly as the SQL builder does. A `limit` is appended here (bounded by
 * {@link MAX_ROWS}); the choke point's `ensureLimit` then leaves it untouched.
 */
export function buildListExecutionsLogsQuery(
  cfg: InsightConfig,
  params: ListExecutionsParams,
): string {
  const limit = coerceLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_ROWS);
  const direct = cfg.destinationType === "cloudwatch-logs-exporter";
  const stages: string[] = [];

  if (direct) {
    // Top-level fields: filter on them directly, discriminate on recordType.
    const filters = ['recordType = "WorkflowInsight"'];
    if (params.status !== undefined) {
      filters.push(
        `status = "${escapeQuotedString(validateStatus(params.status))}"`,
      );
    }
    if (params.functionName !== undefined) {
      filters.push(
        `functionName = "${escapeQuotedString(params.functionName)}"`,
      );
    }
    if (params.since !== undefined) {
      filters.push(
        `startTime >= "${escapeQuotedString(validateTimestamp("since", params.since))}"`,
      );
    }
    if (params.until !== undefined) {
      filters.push(
        `startTime <= "${escapeQuotedString(validateTimestamp("until", params.until))}"`,
      );
    }
    stages.push(`filter ${filters.join(" and ")}`);
    stages.push(
      "fields executionArn, status, functionName, startTime, endTime, durationMs",
    );
    stages.push("sort @timestamp desc");
    stages.push(`limit ${limit}`);
    return stages.join(" | ");
  }

  // Nested (lambda-log-exporter): isolate insight records, parse the fields we
  // filter/return out of the JSON string, then filter on the parsed aliases so
  // every agent value still lands in a double-quoted literal.
  stages.push('filter level = "INFO" and message like /WorkflowInsight/');
  stages.push('parse message "\\"executionArn\\":\\"*\\"" as executionArn');
  stages.push('parse message "\\"status\\":\\"*\\"" as status');
  stages.push('parse message "\\"functionName\\":\\"*\\"" as functionName');
  stages.push('parse message "\\"startTime\\":\\"*\\"" as startTime');

  const postFilters: string[] = [];
  if (params.status !== undefined) {
    postFilters.push(
      `status = "${escapeQuotedString(validateStatus(params.status))}"`,
    );
  }
  if (params.functionName !== undefined) {
    postFilters.push(
      `functionName = "${escapeQuotedString(params.functionName)}"`,
    );
  }
  if (params.since !== undefined) {
    postFilters.push(
      `startTime >= "${escapeQuotedString(validateTimestamp("since", params.since))}"`,
    );
  }
  if (params.until !== undefined) {
    postFilters.push(
      `startTime <= "${escapeQuotedString(validateTimestamp("until", params.until))}"`,
    );
  }
  if (postFilters.length > 0) {
    stages.push(`filter ${postFilters.join(" and ")}`);
  }
  stages.push(
    "fields @timestamp, executionArn, status, functionName, startTime",
  );
  stages.push("sort @timestamp desc");
  stages.push(`limit ${limit}`);
  return stages.join(" | ");
}

export interface ListExecutionsResult {
  destinationType: string;
  engine: string;
  columns: string[];
  rows: string[][];
  count: number;
  truncated: boolean;
  /**
   * The window `StartQuery` actually scanned, in hours, for log destinations.
   *
   * Reported because a Logs Insights result is bounded by TWO things that can
   * disagree: the API window, and the `filter` stages inside the query. If the window
   * is narrower than the filters ask for, the result is silently partial -- so the
   * window has to be visible to be trusted.
   */
  searchedLookbackHours?: number;
}

/**
 * Execute `list_executions`: build the filtered SELECT and run it through the
 * choke point (which applies `assertReadOnly` and the row cap).
 */
export async function runListExecutions(
  cfg: InsightConfig,
  params: ListExecutionsParams,
): Promise<ListExecutionsResult> {
  // Log destinations build a Logs Insights pipe query; SQL destinations build
  // SELECT. Both run through the single choke point, which applies the
  // destination-appropriate bound (`ensureLimit` for logs, the row cap for SQL).
  const query = isLogDestination(cfg)
    ? buildListExecutionsLogsQuery(cfg, params)
    : buildListExecutionsSql(cfg, params);

  // On a log destination `since`/`until` are only `filter` stages INSIDE the pipe
  // query. The API window is separate, and defaulted to 24 hours -- so asking for
  // executions since last week scanned one day, applied a filter that everything in
  // that day satisfied, and returned a plausible partial answer with
  // `truncated: false`. Nothing in the result hinted that six days were missing.
  //
  // The window is therefore derived from the bounds the caller actually gave. It is
  // deliberately a SUPERSET of `[since, until]`: `timeRangeMs` is a duration measured
  // back from now, so an `until` in the past cannot narrow the top of the window --
  // the in-query filters do that. A superset returns correct results; a subset is the
  // bug being fixed.
  const logWindow = isLogDestination(cfg) ? logWindowFor(params) : undefined;
  // Also pass the caller's limit as the row cap, NOT only as query text. For most
  // destinations the generated `LIMIT`/`limit` already bounds the result, but
  // DynamoDB PartiQL supports neither ORDER BY nor LIMIT, so its statement carries
  // no bound at all -- without this, `limit: 10` on DynamoDB returns up to MAX_ROWS
  // rows, which is the token cost this tool exists to avoid.
  const result = await runReadOnlyQuery(cfg, query, {
    maxRows: coerceLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_ROWS),
    ...(logWindow !== undefined ? { timeRangeMs: logWindow.timeRangeMs } : {}),
  });
  return {
    destinationType: cfg.destinationType,
    engine: result.engine,
    columns: result.columns,
    rows: result.rows,
    count: result.count,
    truncated: result.truncated,
    ...(logWindow !== undefined
      ? { searchedLookbackHours: logWindow.lookbackHours }
      : {}),
  };
}
