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
