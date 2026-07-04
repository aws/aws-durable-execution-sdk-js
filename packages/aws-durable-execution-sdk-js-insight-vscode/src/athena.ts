import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  type Row,
  type ColumnInfo,
} from "@aws-sdk/client-athena";
import { GlueClient, GetTableCommand } from "@aws-sdk/client-glue";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface AthenaQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
  dataScannedBytes?: number;
}

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a SQL query against Amazon Athena and normalize the results into a
 * simple columns/rows table. Athena is asynchronous: we StartQueryExecution,
 * then poll GetQueryExecution until the query completes, then page through
 * GetQueryResults.
 */
export async function runAthenaQuery(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  workgroup?: string;
  outputLocation?: string;
  query: string;
  timeoutMs?: number;
}): Promise<AthenaQueryResult> {
  if (!opts.database) {
    throw new Error(
      "No Athena database configured. Set workflowInsight.athenaDatabase.",
    );
  }
  if (!opts.workgroup && !opts.outputLocation) {
    throw new Error(
      "Set either workflowInsight.athenaWorkgroup (with its own output location) " +
        "or workflowInsight.athenaOutputLocation (e.g. s3://my-bucket/athena-results/).",
    );
  }

  const client = new AthenaClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const { QueryExecutionId } = await client.send(
    new StartQueryExecutionCommand({
      QueryString: opts.query,
      QueryExecutionContext: { Database: opts.database },
      WorkGroup: opts.workgroup,
      ResultConfiguration: opts.outputLocation
        ? { OutputLocation: opts.outputLocation }
        : undefined,
    }),
  );

  if (!QueryExecutionId) {
    throw new Error("Failed to start Athena query (no QueryExecutionId).");
  }

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let dataScannedBytes: number | undefined;

  for (;;) {
    const { QueryExecution } = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId }),
    );
    const state = QueryExecution?.Status?.State;
    dataScannedBytes = QueryExecution?.Statistics?.DataScannedInBytes;

    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELLED") {
      const reason =
        QueryExecution?.Status?.StateChangeReason ?? "no reason given";
      throw new Error(`Athena query ${state.toLowerCase()}: ${reason}`);
    }
    if (Date.now() > deadline) {
      throw new Error("Athena query timed out while polling for results.");
    }
    await delay(POLL_INTERVAL_MS);
  }

  return paginateResults(client, QueryExecutionId, dataScannedBytes);
}

/** Page through GetQueryResults and normalize into columns/rows. */
async function paginateResults(
  client: AthenaClient,
  queryExecutionId: string,
  dataScannedBytes: number | undefined,
): Promise<AthenaQueryResult> {
  let columns: string[] | undefined;
  const rows: string[][] = [];
  let nextToken: string | undefined;
  let isFirstPage = true;

  do {
    const result = await client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
      }),
    );

    if (!columns) {
      columns = (result.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map(
        (c: ColumnInfo) => c.Name ?? "?",
      );
    }

    const resultRows: Row[] = result.ResultSet?.Rows ?? [];
    // Athena includes the header row as the first row of the first page only.
    const dataRows = isFirstPage ? resultRows.slice(1) : resultRows;
    for (const row of dataRows) {
      rows.push((row.Data ?? []).map((d) => d.VarCharValue ?? ""));
    }

    nextToken = result.NextToken;
    isFirstPage = false;
  } while (nextToken);

  return {
    columns: columns ?? [],
    rows,
    count: rows.length,
    dataScannedBytes,
  };
}

/**
 * The Glue DDL matching what `S3Exporter` writes: one JSON object per file
 * (JSON SerDe, not NDJSON), Hive-style date partitioning
 * (year=YYYY/month=MM/day=DD/), and the canonical `operations` array (the
 * S3Exporter does not reshape into `operationsByName`).
 *
 * Column names are written lowercase throughout (recordtype, executionarn,
 * subtype, parentid, durationms, ...) to match the CDK-provisioned Glue
 * table (stack.ts's InsightGlueTable) exactly, rather than the mixed-case
 * WorkflowInsightRecord field names (recordType, executionArn, ...).
 * Hive/Glue table and column identifiers are case-insensitive and get
 * folded to lowercase regardless of how they're written in the DDL — so
 * this was never functionally different from writing camelCase here, but
 * keeping both DDL definitions written in the same (lowercase, effectively
 * canonical) casing avoids the two drifting into visually different
 * text that describes an identical schema, which is confusing to compare
 * side by side. The openx JSON SerDe separately lowercases the *data*
 * values' object keys when parsing input/output (a different, unrelated
 * mechanism — see schema.ts's Athena dialect notes on that).
 *
 * Uses partition projection (year/month/day as `integer` type, with a
 * `storage.location.template` reconstructing S3Exporter's exact key
 * pattern) instead of a plain `PARTITIONED BY` + Glue-catalog partition
 * list. With projection, Athena computes valid partition values and their
 * S3 locations mathematically from these table properties at query time —
 * it never calls Glue's GetPartitions, so there's no partition-count
 * metadata lookup to slow down as more days accumulate, and critically, no
 * MSCK REPAIR TABLE (or manual ADD PARTITION) is needed at all: a query for
 * today's data works the moment S3Exporter writes today's first object,
 * with no discovery step first. See
 * https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html
 *
 * Trade-off: the `year` range needs a fixed upper bound (integer projection
 * requires a bounded range, unlike a real date type — which Athena's docs
 * note doesn't support separate year/month/day partition columns, only a
 * single combined date column). A wider range means more query-planning
 * work for any query that doesn't filter on year/month/day (Athena has to
 * reason about every year × month × day combination in range as a
 * candidate partition) — verified empirically: a `GROUP BY year, month,
 * day` with no date filter took ~30s of query planning time against a
 * 2024–2100 range (76 years × 12 × 31 ≈ 28k candidate partitions), most of
 * it before any data was scanned. Kept deliberately narrow (5 years out)
 * rather than a large round number, to bound that cost; if data is ever
 * queried past PROJECTION_YEAR_END, raise it and either recreate the table
 * or ALTER TABLE SET TBLPROPERTIES with the new range.
 *
 * These constants are exported specifically so
 * aws-durable-execution-sdk-js-insight/cdk/stack.test.ts (a different
 * package) can import them directly and assert its own hardcoded
 * projection.year.range matches — a real cross-package npm dependency
 * isn't warranted just for two constants (this package is a dev-only,
 * unpublished VS Code extension; the CDK package has no other reason to
 * depend on it), so a relative-path source import in test code is the
 * practical way to keep these two definitions of the same value from
 * silently drifting apart, short of that.
 */
export const PROJECTION_YEAR_START = 2024;
export const PROJECTION_YEAR_END = 2030;

export function buildCreateTableDdl(opts: {
  database: string;
  table: string;
  s3Location: string;
}): string {
  const loc = opts.s3Location.endsWith("/")
    ? opts.s3Location
    : `${opts.s3Location}/`;
  // Trailing slash trimmed from loc for the template, since the template
  // itself supplies the path separators between segments.
  const locTemplate = `${loc}year=\${year}/month=\${month}/day=\${day}`;
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${opts.database}\`.\`${opts.table}\` (
  recordtype string,
  schemaversion string,
  emittedat string,
  executionarn string,
  executionname string,
  functionname string,
  functionqualifier string,
  region string,
  accountid string,
  status string,
  starttime string,
  endtime string,
  durationms bigint,
  input string,
  output string,
  error struct<name:string,message:string>,
  operations array<struct<
    id:string,
    name:string,
    type:string,
    subtype:string,
    parentid:string,
    status:string,
    starttime:string,
    endtime:string,
    durationms:bigint,
    attempt:int,
    error:struct<name:string,message:string>,
    result:string,
    truncated:boolean
  >>,
  truncated boolean,
  droppedoperations int,
  droppedinput boolean,
  droppedoutput boolean
)
PARTITIONED BY (year string, month string, day string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION '${loc}'
TBLPROPERTIES (
  'has_encrypted_data'='false',
  'projection.enabled'='true',
  'projection.year.type'='integer',
  'projection.year.range'='${PROJECTION_YEAR_START},${PROJECTION_YEAR_END}',
  'projection.month.type'='integer',
  'projection.month.range'='1,12',
  'projection.month.digits'='2',
  'projection.day.type'='integer',
  'projection.day.range'='1,31',
  'projection.day.digits'='2',
  'storage.location.template'='${locTemplate}'
);`;
}

/** Check whether the Glue table already exists (used to prompt for auto-create). */
export async function tableExists(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  table: string;
}): Promise<boolean> {
  const client = new GlueClient({
    region: opts.region,
    credentials: opts.credentials,
  });
  try {
    await client.send(
      new GetTableCommand({ DatabaseName: opts.database, Name: opts.table }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "EntityNotFoundException") {
      return false;
    }
    throw err;
  }
}

/**
 * Create the Glue table (via Athena DDL, which registers it in the Glue
 * Catalog). Idempotent — safe to call every time settings are saved.
 *
 * No MSCK REPAIR TABLE / partition discovery step: buildCreateTableDdl uses
 * partition projection, so Athena computes valid year/month/day partitions
 * (and their S3 locations) from the table properties instead of listing
 * them from the Glue Catalog. Today's partition is queryable the moment
 * S3Exporter writes today's first record — there's nothing to "discover"
 * after the table exists, and running MSCK REPAIR TABLE against a
 * projection-enabled table is a documented no-op (verified: it does not
 * error, it just has no effect — projected partitions aren't tracked in
 * the Glue Catalog for it to add).
 */
export async function ensureAthenaTable(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  table: string;
  workgroup?: string;
  outputLocation?: string;
  s3Location: string;
}): Promise<void> {
  const ddl = buildCreateTableDdl({
    database: opts.database,
    table: opts.table,
    s3Location: opts.s3Location,
  });
  await runAthenaQuery({
    region: opts.region,
    credentials: opts.credentials,
    database: opts.database,
    workgroup: opts.workgroup,
    outputLocation: opts.outputLocation,
    query: ddl,
  });
}

/**
 * Fetch a single full record by executionArn, for the row-detail
 * drill-down. Without a partition predicate this scans every year/month/day
 * partition in the table on every row click — `LIMIT 1` only bounds the
 * number of *output* rows, it does not make Trino/Athena stop scanning
 * splits early once a match is found, so this is a real full-table scan
 * (cost + latency) on a large bucket. Pass `year`/`month`/`day` (the
 * clicked row's own partition columns, carried through by
 * ensureIdentifierColumn's extraColumns — see extension.ts) whenever
 * available to add an equality predicate on the partition columns and let
 * Athena prune to just that one partition.
 *
 * Unlike fetchAuroraRecord/fetchDynamoDBRecord, this can't use a
 * parameterized statement — StartQueryExecutionCommand takes a single
 * QueryString with no positional/named parameter support (that's an RDS
 * Data API / PartiQL ExecuteStatement feature, not part of the Athena API).
 * Manual quote-escaping is the correct mitigation here, same as any other
 * raw-SQL API without parameter binding.
 */
export async function fetchAthenaRecord(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  table: string;
  workgroup?: string;
  outputLocation?: string;
  executionArn: string;
  /** The clicked row's own year/month/day partition values, if known — adds a partition-pruning predicate instead of scanning the whole table. */
  year?: string;
  month?: string;
  day?: string;
}): Promise<Record<string, string> | undefined> {
  const escaped = opts.executionArn.replace(/'/g, "''");
  const partitionPredicate = [
    opts.year ? `year = '${opts.year.replace(/'/g, "''")}'` : undefined,
    opts.month ? `month = '${opts.month.replace(/'/g, "''")}'` : undefined,
    opts.day ? `day = '${opts.day.replace(/'/g, "''")}'` : undefined,
  ]
    .filter((p): p is string => p != null)
    .map((p) => `${p} AND `)
    .join("");
  const result = await runAthenaQuery({
    region: opts.region,
    credentials: opts.credentials,
    database: opts.database,
    workgroup: opts.workgroup,
    outputLocation: opts.outputLocation,
    query: `SELECT * FROM ${opts.table} WHERE ${partitionPredicate}executionarn = '${escaped}' LIMIT 1`,
  });

  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  const record: Record<string, string> = {};
  // Always include every column's value, even an empty string — unlike
  // fetchDynamoDBRecord/fetchAuroraRecord (which distinguish a real NULL
  // from an empty string and only drop the former), runAthenaQuery's
  // paginateResults already normalizes a missing VarCharValue to "" (see
  // that function), so there is no separate null/undefined signal left to
  // check for here by the time rows reach this function — "" from Athena
  // could mean either NULL or a genuinely empty string, and since there's
  // no way to tell them apart at this point, don't drop it either way. The
  // previous `if (row[i])` check was wrong regardless: it treated a
  // legitimately empty string as absent and silently omitted that field
  // from the detail view.
  result.columns.forEach((col, i) => {
    record[col] = row[i] ?? "";
  });
  return record;
}
