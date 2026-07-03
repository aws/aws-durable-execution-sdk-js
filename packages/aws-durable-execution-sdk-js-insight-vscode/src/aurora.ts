import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface AuroraQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
}

/**
 * Run a SQL query against Aurora via the RDS Data API and normalize results.
 */
export async function runAuroraQuery(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  resourceArn: string;
  secretArn: string;
  database: string;
  sql: string;
}): Promise<AuroraQueryResult> {
  const client = new RDSDataClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const result = await client.send(
    new ExecuteStatementCommand({
      resourceArn: opts.resourceArn,
      secretArn: opts.secretArn,
      database: opts.database,
      sql: opts.sql,
      includeResultMetadata: true,
    }),
  );

  const columns = (result.columnMetadata ?? []).map(
    (col) => col.label || col.name || "?",
  );
  const records = result.records ?? [];

  const rows = records.map((row) =>
    row.map((field) => {
      if (field.isNull) return "";
      if (field.stringValue != null) return field.stringValue;
      if (field.longValue != null) return String(field.longValue);
      if (field.doubleValue != null) return String(field.doubleValue);
      if (field.booleanValue != null) return String(field.booleanValue);
      return JSON.stringify(field);
    }),
  );

  return { columns, rows, count: rows.length };
}

/**
 * Fetch a single full record by execution_arn, for the row-detail
 * drill-down. Uses the RDS Data API's parameterized statements to avoid SQL
 * injection from the identifier value (which round-trips through the
 * webview, so treat it as untrusted input even though it originated from a
 * previous query result).
 *
 * The table's only record-shaped column is `record_json` (a JSONB blob) —
 * the individual scalar columns (execution_arn, status, etc.) are a
 * denormalized subset for indexing/filtering, not the full record. Select
 * record_json and unpack it into top-level fields so this matches the
 * flat-fields shape RecordDetail.tsx expects (input/output/operations/error
 * as top-level keys), rather than returning it as a single opaque JSON
 * string column.
 */
export async function fetchAuroraRecord(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  resourceArn: string;
  secretArn: string;
  database: string;
  table: string;
  executionArn: string;
}): Promise<Record<string, string> | undefined> {
  const client = new RDSDataClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const result = await client.send(
    new ExecuteStatementCommand({
      resourceArn: opts.resourceArn,
      secretArn: opts.secretArn,
      database: opts.database,
      sql: `SELECT record_json FROM ${opts.table} WHERE execution_arn = :executionArn LIMIT 1`,
      parameters: [
        { name: "executionArn", value: { stringValue: opts.executionArn } },
      ],
    }),
  );

  const field = (result.records ?? [])[0]?.[0];
  if (!field?.stringValue) return undefined;

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
