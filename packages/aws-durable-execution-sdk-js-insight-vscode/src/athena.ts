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
 */
export function buildCreateTableDdl(opts: {
  database: string;
  table: string;
  s3Location: string;
}): string {
  const loc = opts.s3Location.endsWith("/")
    ? opts.s3Location
    : `${opts.s3Location}/`;
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${opts.database}\`.\`${opts.table}\` (
  recordType string,
  schemaVersion string,
  emittedAt string,
  executionArn string,
  executionName string,
  functionName string,
  functionQualifier string,
  region string,
  accountId string,
  status string,
  startTime string,
  endTime string,
  durationMs bigint,
  input string,
  output string,
  error struct<name:string,message:string>,
  operations array<struct<
    id:string,
    name:string,
    type:string,
    subType:string,
    parentId:string,
    status:string,
    startTime:string,
    endTime:string,
    durationMs:bigint,
    attempt:int,
    error:struct<name:string,message:string>,
    result:string,
    truncated:boolean
  >>,
  truncated boolean,
  droppedOperations int,
  droppedInput boolean,
  droppedOutput boolean
)
PARTITIONED BY (year string, month string, day string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION '${loc}'
TBLPROPERTIES ('has_encrypted_data'='false');`;
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
 * Catalog) and discover existing Hive partitions with MSCK REPAIR TABLE.
 * Idempotent — safe to call every time settings are saved.
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
  // Discover the year=/month=/day= partitions already written by S3Exporter.
  await runAthenaQuery({
    region: opts.region,
    credentials: opts.credentials,
    database: opts.database,
    workgroup: opts.workgroup,
    outputLocation: opts.outputLocation,
    query: `MSCK REPAIR TABLE \`${opts.database}\`.\`${opts.table}\`;`,
  });
}

/**
 * Fetch a single full record by executionArn, for the row-detail
 * drill-down. Athena has no cheap point-lookup (every query scans the
 * relevant partitions), but scoping to a specific executionArn with an
 * equality predicate lets Athena's engine short-circuit once it finds the
 * match, and LIMIT 1 keeps the result set trivially small — still an
 * ordinary query under the hood, just narrowly scoped.
 */
export async function fetchAthenaRecord(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  table: string;
  workgroup?: string;
  outputLocation?: string;
  executionArn: string;
}): Promise<Record<string, string> | undefined> {
  const escaped = opts.executionArn.replace(/'/g, "''");
  const result = await runAthenaQuery({
    region: opts.region,
    credentials: opts.credentials,
    database: opts.database,
    workgroup: opts.workgroup,
    outputLocation: opts.outputLocation,
    query: `SELECT * FROM ${opts.table} WHERE executionarn = '${escaped}' LIMIT 1`,
  });

  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  const record: Record<string, string> = {};
  result.columns.forEach((col, i) => {
    if (row[i]) record[col] = row[i];
  });
  return record;
}
