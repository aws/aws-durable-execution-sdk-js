/**
 * The one and only place in this package permitted to execute a query.
 *
 * WHY THIS FILE EXISTS — read before adding a second query path:
 *   In the VS Code and Electron hosts, `assertReadOnly` guards SQL that our own
 *   prompt produced, and it is invoked from `explorerSession.ts`. This MCP host
 *   deliberately does NOT use `ExplorerSession`: here the SQL comes from a model
 *   we do not control, invoked in a loop, on behalf of a user who may approve
 *   without reading. This is THE security boundary of this host.
 *
 *   There is a verified structural hazard in core: `assertReadOnly` and
 *   `ensureLimit` are called ONLY inside `explorerSession.ts`, never inside the
 *   engine runners (`runAthenaQuery`, `runDynamoDBQuery`, ...). Those runners are
 *   therefore reachable with NO read-only enforcement whatsoever — nothing in
 *   core stops you executing a DELETE through them. The mitigation is NOT to
 *   sprinkle `assertReadOnly` at each call site (that is exactly the pattern that
 *   let it be forgotten); it is to have ONE choke point. `runReadOnlyQuery` is
 *   that choke point, and `queryChokePoint.test.ts` mechanically enforces that no
 *   other non-test file in this package imports a runner.
 */
import {
  assertReadOnly,
  ensureLimit,
  resolveCredentials,
  runAthenaQuery,
  runAuroraQuery,
  runDynamoDBQuery,
  runLogsInsightsQuery,
  runOpenSearchQuery,
  runRedshiftQuery,
  type InsightConfig,
} from "@aws/durable-insight-core";

/**
 * Hard cap on rows pulled into this process from any single query.
 *
 * This is the SQL bound. It is deliberately a single exported constant so the
 * cap lives in exactly one place, is testable, and is passed to Athena's
 * `maxRows` on every dispatch. On the SQL paths we do NOT use core's
 * `ensureLimit` to bound the result: it emits `" | limit N"`, which is
 * CloudWatch Logs Insights syntax, not SQL — appending it to a Trino or PartiQL
 * statement produces a syntax error (verified against `schema.ts`'s
 * `ensureLimit`). The CloudWatch Logs path is the exact opposite: `ensureLimit`
 * IS the right bound there (see `runLogsInsightsReadOnly`), because `" | limit
 * N"` is native Logs Insights syntax. The SQL row bound is this cap, enforced
 * per engine according to what the runner does itself:
 *   - Athena: passed as `maxRows`; the runner stops paging at the cap.
 *   - DynamoDB: a single non-paginating `ExecuteStatement`, then a post-hoc
 *     slice if the returned count reaches the cap.
 *   - Aurora / Redshift / OpenSearch: their runners do NOT cap (Redshift even
 *     pages through EVERY `NextToken` page), so this package slices the result
 *     to the cap after dispatch and sets `truncated` when it did.
 */
export const MAX_ROWS = 1000;

/**
 * The engine label for the two CloudWatch Logs Insights destinations
 * (`cloudwatch-logs-exporter`, `lambda-log-exporter`). Unlike the five SQL
 * labels this is NOT a SQL dialect — Logs Insights is a pipe language — and it
 * is never handed to `assertReadOnly` (see the log path below for why).
 */
export const LOGS_INSIGHTS_ENGINE = "CloudWatch Logs Insights";

/**
 * Default lookback window for CloudWatch Logs Insights queries when the caller
 * does not specify one: the last 24 hours. Logs Insights REQUIRES an explicit
 * `[startTime, endTime]` window — there is no "all time" — so a default must
 * exist. 24h matches `explorerSession.ts`'s default (`lookbackHours ?? 24`) so
 * every host agrees on the same window.
 */
export const DEFAULT_LOG_TIME_RANGE_MS = 24 * 60 * 60 * 1000;

/**
 * Per-call options for {@link runReadOnlyQuery}. Everything here applies ONLY to
 * the CloudWatch Logs Insights destinations; the five SQL engines are not
 * time-windowed and ignore it.
 */
export interface RunReadOnlyQueryOptions {
  /**
   * Size of the Logs Insights lookback window, in milliseconds. The window is
   * `[Date.now() - timeRangeMs, Date.now()]`. Defaults to
   * {@link DEFAULT_LOG_TIME_RANGE_MS} when absent or non-positive. Ignored for
   * SQL destinations.
   */
  timeRangeMs?: number;
}

/** True for the two CloudWatch Logs Insights destinations. */
function isLogDestination(cfg: InsightConfig): boolean {
  return (
    cfg.destinationType === "cloudwatch-logs-exporter" ||
    cfg.destinationType === "lambda-log-exporter"
  );
}

/** The normalized, engine-independent shape every query returns. */
export interface ReadOnlyQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
  truncated: boolean;
  /**
   * The query-language engine the SQL was validated and run against — the same
   * label `assertReadOnly` was given, so error text is consistent with the other
   * hosts (`"PartiQL"` for DynamoDB, `"Trino/Presto SQL"` for S3/Athena).
   */
  engine: string;
}

/**
 * Execute `sql` against the configured destination, read-only.
 *
 * Order is load-bearing:
 *   1. Resolve the engine label for the destination. An unsupported destination
 *      is rejected HERE, before any validation or credential work — there is no
 *      engine to validate against and nothing to run.
 *   2. `assertReadOnly(sql, engine)` — core's validator, called BEFORE resolving
 *      credentials or issuing any AWS call. A non-read-only statement throws here
 *      and never reaches a runner. We call core's; we never reimplement it.
 *   3. Resolve credentials.
 *   4. Dispatch to the runner, always bounding the result to {@link MAX_ROWS}.
 */
export async function runReadOnlyQuery(
  cfg: InsightConfig,
  sql: string,
  opts: RunReadOnlyQueryOptions = {},
): Promise<ReadOnlyQueryResult> {
  // ── CloudWatch Logs Insights path — DELIBERATELY NOT SQL ──────────────────
  //
  // This path is fundamentally different from the five SQL engines below and is
  // handled BEFORE any of the SQL machinery, for three load-bearing reasons:
  //
  //   1. `assertReadOnly` is NOT called here, ON PURPOSE. It requires a query to
  //      begin with SELECT or WITH; a Logs Insights query begins with `fields`,
  //      `filter`, `stats`, ... so running it through `assertReadOnly` would
  //      reject EVERY valid Logs Insights query. This is not an oversight to
  //      "fix for consistency" — doing so silently breaks all log queries.
  //      Read-only is instead guaranteed by the API surface: the Logs Insights
  //      query language has NO write/DDL constructs at all, and the only API we
  //      call (`StartQuery`/`GetQueryResults`) can only read. There is nothing a
  //      caller can express here that mutates data, so there is nothing for
  //      `assertReadOnly` to catch — its absence removes no protection.
  //      `explorerSession.ts` guards only its five SQL engines the same way and
  //      never applies `assertReadOnly` to this path.
  //
  //   2. `ensureLimit` DOES belong here — this is the ONE engine it was written
  //      for. It appends `" | limit N"`, which is Logs Insights syntax (a syntax
  //      error on Trino/PartiQL, which is why the SQL paths use a row cap
  //      instead). It deliberately skips a query that already contains `limit`
  //      and skips `stats` aggregations; both behaviors are preserved by calling
  //      core's `ensureLimit` verbatim.
  //
  //   3. It needs an explicit time window; there is no "all time". We compute it
  //      exactly as `explorerSession.ts` does: `endTimeMs = Date.now()`,
  //      `startTimeMs = endTimeMs - timeRangeMs`.
  if (isLogDestination(cfg)) {
    return runLogsInsightsReadOnly(cfg, sql, opts);
  }

  // 1. Engine label per destination. Unsupported types are rejected up front.
  let engine: string;
  switch (cfg.destinationType) {
    case "dynamodb":
      engine = "PartiQL";
      break;
    case "s3":
      engine = "Trino/Presto SQL";
      break;
    case "aurora":
      engine = "PostgreSQL";
      break;
    case "redshift":
      engine = "Redshift SQL";
      break;
    case "opensearch":
      engine = "OpenSearch SQL";
      break;
    case "sqs":
      // SQS is deliberately NOT a fall-through to the generic "unsupported"
      // error: it is not a queryable store at all. It is a message queue this
      // host can only TAIL (long-poll for new messages via core's
      // `listenToQueue`); there is no query runner for it and never will be
      // (see explorerSession.ts: "SQS isn't queryable and never reaches here").
      // Reject it explicitly with an error that says so, so an agent does not
      // keep retrying a query it can never make work.
      throw new Error(
        `Query is not supported for destination type "sqs": SQS is a message ` +
          `queue, not a queryable data store. This host can only TAIL an SQS ` +
          `queue (long-poll for new messages), not run SQL/PartiQL against it. ` +
          `There is no query engine for SQS.`,
      );
    default:
      throw new Error(
        `Query is not supported for destination type "${cfg.destinationType}" ` +
          `in this version. Supported destinations: "dynamodb", "s3", "aurora", ` +
          `"redshift", "opensearch", and the CloudWatch Logs destinations ` +
          `("cloudwatch-logs-exporter", "lambda-log-exporter", handled on the ` +
          `Logs Insights path above).`,
      );
  }

  // 2. THE security boundary. Reject any non-read-only SQL before touching
  //    credentials or the network. Do not move anything above this line.
  assertReadOnly(sql, engine);

  // 3. Credentials (lazy providers; no network until a runner uses them).
  const credentials = resolveCredentials(cfg.awsProfile);

  // 4. Dispatch, always bounding the result set.
  if (cfg.destinationType === "s3") {
    // Athena's GetQueryResults pages through the ENTIRE result set; without
    // maxRows a query whose LIMIT the model omitted would pull every matching
    // row into this process. Always pass the cap and surface the runner's
    // `truncated` flag.
    const result = await runAthenaQuery({
      region: cfg.region,
      credentials,
      database: cfg.athenaDatabase,
      workgroup: cfg.athenaWorkgroup || undefined,
      // `athenaOutputLocation`, NOT `athenaS3Location`. These are different
      // buckets and confusing them is quietly destructive: `athenaOutputLocation`
      // is where Athena writes query RESULTS, while `athenaS3Location` is the
      // SOURCE data location used for the table's DDL. Passing the source bucket
      // here would write result files into the data being queried. Every other
      // call site in the repo passes athenaOutputLocation, and athena.ts's own
      // error text names it.
      outputLocation: cfg.athenaOutputLocation || undefined,
      query: sql,
      maxRows: MAX_ROWS,
    });
    return {
      columns: result.columns,
      rows: result.rows,
      count: result.count,
      truncated: result.truncated,
      engine,
    };
  }

  // dynamodb: a single ExecuteStatementCommand with no pagination loop, so it is
  // page-bounded already. There is no `truncated` flag from the runner, so if the
  // returned row count reaches the cap we report truncation and slice to the cap.
  if (cfg.destinationType === "dynamodb") {
    const result = await runDynamoDBQuery({
      region: cfg.region,
      credentials,
      tableName: cfg.dynamodbTableName,
      statement: sql,
    });
    const truncated = result.count >= MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows;
    return {
      columns: result.columns,
      rows,
      count: rows.length,
      truncated,
      engine,
    };
  }

  // Aurora / Redshift / OpenSearch: unlike Athena, NONE of these runners bound
  // their own result — they return whatever the API produced (Redshift even
  // pages through EVERY NextToken page). The cap is therefore this package's
  // responsibility: dispatch, then slice to MAX_ROWS and flag truncation when
  // the runner handed back more than the cap. `capUnbounded` centralizes that so
  // the three branches cannot drift.
  if (cfg.destinationType === "aurora") {
    const result = await runAuroraQuery({
      region: cfg.region,
      credentials,
      resourceArn: cfg.auroraResourceArn,
      secretArn: cfg.auroraSecretArn,
      database: cfg.auroraDatabase,
      sql,
    });
    return capUnbounded(result, engine);
  }

  if (cfg.destinationType === "redshift") {
    const result = await runRedshiftQuery({
      region: cfg.region,
      credentials,
      database: cfg.redshiftDatabase,
      workgroupName: cfg.redshiftWorkgroupName || undefined,
      clusterIdentifier: cfg.redshiftClusterIdentifier || undefined,
      dbUser: cfg.redshiftDbUser || undefined,
      secretArn: cfg.redshiftSecretArn || undefined,
      sql,
    });
    return capUnbounded(result, engine);
  }

  if (cfg.destinationType === "opensearch") {
    const result = await runOpenSearchQuery({
      region: cfg.region,
      credentials,
      endpoint: cfg.opensearchEndpoint,
      sql,
    });
    return capUnbounded(result, engine);
  }

  // Unreachable: the engine-label switch above returns a label only for the
  // destinations handled here and throws for everything else. This satisfies
  // the return type and guards against a new engine label being added without a
  // matching dispatch branch.
  throw new Error(
    `Internal error: no dispatch branch for destination type ` +
      `"${cfg.destinationType}".`,
  );
}

/**
 * Bound an unbounded runner result to {@link MAX_ROWS} in this package.
 *
 * For Aurora, Redshift and OpenSearch the runner applies no cap of its own, so
 * a query whose LIMIT the caller omitted would pull the entire result set into
 * this process. Slice to the cap and report `truncated: true` when we did — the
 * same guarantee Athena gets from `maxRows` and DynamoDB gets from its post-hoc
 * slice, so EVERY destination returns at most MAX_ROWS rows.
 */
function capUnbounded(
  result: { columns: string[]; rows: string[][] },
  engine: string,
): ReadOnlyQueryResult {
  const truncated = result.rows.length > MAX_ROWS;
  const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows;
  return {
    columns: result.columns,
    rows,
    count: rows.length,
    truncated,
    engine,
  };
}

/**
 * Execute a CloudWatch Logs Insights query, read-only.
 *
 * This is the log-destination counterpart to the SQL dispatch in
 * {@link runReadOnlyQuery}, kept inside the same choke point so `runReadOnlyQuery`
 * remains the ONE place a query executes. Two things differ from the SQL paths,
 * both intentional and documented at the call site:
 *
 *   - No `assertReadOnly`. The Logs Insights language has no write/DDL forms and
 *     `StartQuery` can only read, so read-only is guaranteed by the API surface,
 *     not by a SELECT/WITH prefix check (which would reject every valid query).
 *   - Bounding is via core's `ensureLimit`, the function written for exactly this
 *     syntax. It appends `" | limit MAX_ROWS"` unless the query already has a
 *     `limit` or is a `stats` aggregation, in which case it is left untouched.
 *
 * Logs Insights requires an explicit `[startTime, endTime]`; we derive it the
 * same way `explorerSession.ts` does — `endTimeMs = Date.now()`, `startTimeMs =
 * endTimeMs - timeRangeMs` — using the caller's window or the 24h default.
 */
async function runLogsInsightsReadOnly(
  cfg: InsightConfig,
  queryString: string,
  opts: RunReadOnlyQueryOptions,
): Promise<ReadOnlyQueryResult> {
  // Bound the result with the function written for this syntax. `ensureLimit`
  // is a no-op for queries that already carry a `limit` (e.g. the structured
  // tools, which append their own) or that aggregate with `stats`.
  const bounded = ensureLimit(queryString, MAX_ROWS);

  const credentials = resolveCredentials(cfg.awsProfile);

  // Explicit, always-present window. There is no "all time" in Logs Insights.
  const endTimeMs = Date.now();
  const timeRangeMs =
    opts.timeRangeMs !== undefined && opts.timeRangeMs > 0
      ? opts.timeRangeMs
      : DEFAULT_LOG_TIME_RANGE_MS;
  const startTimeMs = endTimeMs - timeRangeMs;

  // Log groups are a LIST on InsightConfig (core derives `logGroupNames` from
  // the comma-separated `logGroupName` setting). Pass the array through as-is.
  const table = await runLogsInsightsQuery({
    region: cfg.region,
    credentials,
    logGroupNames: cfg.logGroupNames,
    queryString: bounded,
    startTimeMs,
    endTimeMs,
  });

  // The runner does not carry a `truncated` flag; `ensureLimit` caps a
  // non-aggregating query at MAX_ROWS, so reaching the cap is our truncation
  // signal (a `stats`/pre-limited query that returns fewer rows reports false).
  const truncated = table.rows.length >= MAX_ROWS;
  return {
    columns: table.columns,
    rows: table.rows,
    count: table.rows.length,
    truncated,
    engine: LOGS_INSIGHTS_ENGINE,
  };
}
