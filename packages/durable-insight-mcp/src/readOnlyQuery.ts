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
  resolveCredentials,
  runAthenaQuery,
  runDynamoDBQuery,
  type InsightConfig,
} from "durable-insight-core";

/**
 * Hard cap on rows pulled into this process from any single query.
 *
 * This is the SQL bound. It is deliberately a single exported constant so the
 * cap lives in exactly one place, is testable, and is passed to Athena's
 * `maxRows` on every dispatch. We do NOT use core's `ensureLimit` to bound the
 * result: it emits `" | limit N"`, which is CloudWatch Logs Insights syntax, not
 * SQL — appending it to a Trino or PartiQL statement produces a syntax error
 * (verified against `schema.ts`'s `ensureLimit`). The row bound is this cap,
 * enforced by the runner (`maxRows` for Athena; a page-bounded single
 * `ExecuteStatement` plus a post-hoc slice for DynamoDB).
 */
export const MAX_ROWS = 1000;

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
): Promise<ReadOnlyQueryResult> {
  // 1. Engine label per destination. Unsupported types are rejected up front.
  let engine: string;
  switch (cfg.destinationType) {
    case "dynamodb":
      engine = "PartiQL";
      break;
    case "s3":
      engine = "Trino/Presto SQL";
      break;
    default:
      throw new Error(
        `Query is not supported for destination type "${cfg.destinationType}" ` +
          `in this version. Supported destinations: "dynamodb", "s3". Aurora, ` +
          `Redshift, OpenSearch, SQS and CloudWatch Logs are planned for Phase 4.`,
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
