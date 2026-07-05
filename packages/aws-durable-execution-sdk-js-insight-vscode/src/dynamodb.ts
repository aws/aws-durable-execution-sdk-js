import {
  DynamoDBClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface DynamoDBQueryResult {
  columns: string[];
  rows: string[][];
  count: number;
  /** Per-column numeric flag (aligned with `columns`) — see AthenaQueryResult.numericColumns. */
  numericColumns: boolean[];
}

/**
 * Run a PartiQL query against DynamoDB and normalize results into columns/rows.
 */
export async function runDynamoDBQuery(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  tableName: string;
  statement: string;
}): Promise<DynamoDBQueryResult> {
  const client = new DynamoDBClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const result = await client.send(
    new ExecuteStatementCommand({
      Statement: opts.statement,
    }),
  );

  const items = (result.Items ?? []).map((item) => unmarshall(item));

  if (items.length === 0) {
    return { columns: [], rows: [], count: 0, numericColumns: [] };
  }

  // Collect all unique keys across all items as columns
  const columnSet = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      columnSet.add(key);
    }
  }
  // Put pk first, then status, then others sorted
  const priority = [
    "pk",
    "status",
    "functionName",
    "executionName",
    "durationMs",
    "startTime",
    "endTime",
    "emittedAt",
  ];
  const columns = [
    ...priority.filter((c) => columnSet.has(c)),
    ...[...columnSet].filter((c) => !priority.includes(c)).sort(),
  ];

  const rows = items.map((item) =>
    columns.map((col) => {
      const val = item[col];
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    }),
  );

  // A column is numeric only if every present value in it is a JS number
  // (unmarshall returns numbers for DynamoDB N attributes) — so the display
  // rows above keep the string form, but run_javascript can coerce these back.
  const numericColumns = columns.map((col) => {
    let sawNumber = false;
    for (const item of items) {
      const val = item[col];
      if (val == null) continue;
      if (typeof val === "number") sawNumber = true;
      else return false;
    }
    return sawNumber;
  });

  return { columns, rows, count: items.length, numericColumns };
}

/**
 * Fetch a single full record by its partition key (pk = executionArn), for
 * the row-detail drill-down. Uses ExecuteStatement (PartiQL) with a direct
 * key-equality WHERE clause — a Query, not a Scan, so this is cheap even on
 * a large table.
 *
 * Uses ExecuteStatementCommand's `Parameters` (positional `?` placeholders)
 * rather than string interpolation — `pk` round-trips through the webview
 * (it's a value from a previous query's result row), so treat it as
 * untrusted input even though it originated from our own query, the same
 * way fetchAuroraRecord parameterizes execution_arn.
 */
export async function fetchDynamoDBRecord(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  tableName: string;
  pk: string;
}): Promise<Record<string, string> | undefined> {
  const client = new DynamoDBClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  const result = await client.send(
    new ExecuteStatementCommand({
      Statement: `SELECT * FROM "${opts.tableName}" WHERE pk = ?`,
      Parameters: [{ S: opts.pk }],
    }),
  );

  const item = result.Items?.[0];
  if (!item) return undefined;
  const unmarshalled = unmarshall(item);
  const record: Record<string, string> = {};
  for (const [key, val] of Object.entries(unmarshalled)) {
    if (val == null) continue;
    record[key] = typeof val === "object" ? JSON.stringify(val) : String(val);
  }
  return record;
}
