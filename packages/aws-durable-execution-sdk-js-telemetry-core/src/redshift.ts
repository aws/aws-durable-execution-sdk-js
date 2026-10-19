import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
  type Field,
  type ColumnMetadata,
} from "@aws-sdk/client-redshift-data";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface RedshiftQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
  /** Per-column numeric-type flag (aligned with `columns`) — see AthenaQueryResult.numericColumns. */
  numericColumns: boolean[];
}

/**
 * Connection identity for the Redshift Data API. Redshift Serverless is
 * addressed by `workgroupName`; a provisioned cluster by `clusterIdentifier`
 * (+ `dbUser` for GetClusterCredentials, or a `secretArn`). Exactly one of
 * workgroupName/clusterIdentifier is expected — callers validate that upstream.
 */
export interface RedshiftConnection {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  database: string;
  workgroupName?: string;
  clusterIdentifier?: string;
  dbUser?: string;
  secretArn?: string;
}

// Redshift's Data API reports column types via columnMetadata.typeName using
// PostgreSQL type names (int2/int4/int8, float4/float8, numeric, ...). Matched
// exactly (not by prefix) so types like "interval"/"intervaly2m" don't slip in;
// anything unmatched simply stays a string. Kept in sync with aurora.ts's set.
const NUMERIC_REDSHIFT_TYPES = new Set([
  "int2",
  "int4",
  "int8",
  "float4",
  "float8",
  "numeric",
  "decimal",
  "oid",
]);
function isNumericRedshiftType(typeName?: string): boolean {
  return (
    typeName != null &&
    NUMERIC_REDSHIFT_TYPES.has(typeName.trim().toLowerCase())
  );
}

function fieldToString(field: Field): string {
  if (field.isNull) return "";
  if (field.stringValue != null) return field.stringValue;
  if (field.longValue != null) return String(field.longValue);
  if (field.doubleValue != null) return String(field.doubleValue);
  if (field.booleanValue != null) return String(field.booleanValue);
  return JSON.stringify(field);
}

// The Redshift Data API is asynchronous: ExecuteStatement returns immediately
// with a statement Id, and results are only available after the statement
// reaches FINISHED. Poll DescribeStatement until then. Bounded so a hung/very
// long query surfaces as an error instead of blocking the extension forever.
const POLL_INTERVAL_MS = 500;
const MAX_POLL_MS = 120_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a statement via the Redshift Data API and wait for it to finish.
 * Returns the finished statement Id (for GetStatementResult), or undefined
 * when the statement produced no result set (e.g. SELECT 1 on a DDL path —
 * here callers always SELECT, so a result set is expected).
 */
async function executeAndWait(
  client: RedshiftDataClient,
  conn: RedshiftConnection,
  sql: string,
  parameters?: { name: string; value: string }[],
): Promise<string> {
  const exec = await client.send(
    new ExecuteStatementCommand({
      WorkgroupName: conn.workgroupName,
      ClusterIdentifier: conn.clusterIdentifier,
      Database: conn.database,
      DbUser: conn.dbUser,
      SecretArn: conn.secretArn,
      Sql: sql,
      Parameters: parameters,
    }),
  );
  const id = exec.Id;
  if (!id)
    throw new Error("Redshift ExecuteStatement returned no statement Id.");

  const deadline = Date.now() + MAX_POLL_MS;
  for (;;) {
    const desc = await client.send(new DescribeStatementCommand({ Id: id }));
    const status = desc.Status;
    if (status === "FINISHED") return id;
    if (status === "FAILED" || status === "ABORTED") {
      throw new Error(
        `Redshift statement ${status.toLowerCase()}: ${desc.Error ?? "no error detail"}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Redshift statement did not finish within ${MAX_POLL_MS / 1000}s (last status: ${status ?? "unknown"}).`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Run a read query against Redshift via the Data API and normalize results
 * into the same shape as AuroraQueryResult/AthenaQueryResult.
 */
export async function runRedshiftQuery(
  opts: RedshiftConnection & { sql: string },
): Promise<RedshiftQueryResult> {
  const client = new RedshiftDataClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const id = await executeAndWait(client, opts, opts.sql);

  // GetStatementResult is paginated via NextToken; columnMetadata is only
  // returned on the first page.
  let columnMetadata: ColumnMetadata[] = [];
  const records: Field[][] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new GetStatementResultCommand({ Id: id, NextToken: nextToken }),
    );
    if (columnMetadata.length === 0 && page.ColumnMetadata) {
      columnMetadata = page.ColumnMetadata;
    }
    for (const row of page.Records ?? []) records.push(row);
    nextToken = page.NextToken;
  } while (nextToken);

  const columns = columnMetadata.map((col) => col.label || col.name || "?");
  const numericColumns = columnMetadata.map((col) =>
    isNumericRedshiftType(col.typeName),
  );
  const rows = records.map((row) => row.map(fieldToString));

  return { columns, rows, count: rows.length, numericColumns };
}

/**
 * Fetch a single full record by execution_arn, for the row-detail drill-down.
 * Mirrors fetchAuroraRecord: the only record-shaped column is `record_json`
 * (a SUPER blob) — the scalar columns are a denormalized subset for
 * filtering, not the full record. Select record_json and unpack it into
 * top-level fields (input/output/operations/error) so this matches the
 * flat-fields shape RecordDetail.tsx expects.
 *
 * Uses a parameterized statement so the identifier value (which round-trips
 * through the webview — treat as untrusted) can't inject SQL.
 */
export async function fetchRedshiftRecord(
  opts: RedshiftConnection & { table: string; executionArn: string },
): Promise<Record<string, string> | undefined> {
  const client = new RedshiftDataClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const id = await executeAndWait(
    client,
    opts,
    `SELECT record_json FROM ${opts.table} WHERE execution_arn = :executionArn LIMIT 1`,
    [{ name: "executionArn", value: opts.executionArn }],
  );

  const page = await client.send(new GetStatementResultCommand({ Id: id }));
  const field = (page.Records ?? [])[0]?.[0];
  // record_json is SUPER; the Data API returns it as JSON text in stringValue.
  if (!field || field.isNull || field.stringValue == null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(field.stringValue);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (val == null) continue;
    out[key] = typeof val === "object" ? JSON.stringify(val) : String(val);
  }
  return out;
}
