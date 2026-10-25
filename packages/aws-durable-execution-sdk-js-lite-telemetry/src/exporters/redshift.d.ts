import type { AwsClient, TelemetryExporter } from "../index.js";

export interface RedshiftExporterConfig {
  /** The Redshift Serverless workgroup. Set this or clusterIdentifier. */
  workgroupName?: string;
  /** The provisioned cluster. Set this or workgroupName. */
  clusterIdentifier?: string;
  /** The database user of a provisioned cluster, with temporary credentials. */
  dbUser?: string;
  /** The Secrets Manager secret with the database credentials. */
  secretArn?: string;
  /** The database name. */
  database: string;
  /** Default "public". Letters, digits and underscores, not starting with a digit. */
  schema?: string;
  /** Default "durable_execution_telemetry". Same rule as schema. */
  table?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://redshift-data.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "redshift-data" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 1_000_000. */
  maxRecordBytes?: number;
}

/**
 * Upserts each record into one row per execution with a MERGE. Throws when the schema
 * or table name is not a plain identifier. The export resolves when Redshift accepts the
 * statement. It does not wait for the statement to finish.
 */
export function createRedshiftExporter(
  config: RedshiftExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };

/** The CREATE TABLE IF NOT EXISTS statement for the table. Throws for an invalid name. */
export function createTableSql(names?: {
  schema?: string;
  table?: string;
}): string;
