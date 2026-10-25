import type { AwsClient, TelemetryExporter } from "../index.js";

export interface AuroraExporterConfig {
  /** The Aurora cluster ARN. The cluster must have the Data API enabled. */
  resourceArn: string;
  /** The Secrets Manager secret that holds the database credentials. */
  secretArn: string;
  database: string;
  /** The SQL dialect of the upsert. Default "postgresql". */
  engine?: "postgresql" | "mysql";
  /** Letters, digits and underscores; not starting with a digit. Default "durable_execution_telemetry". */
  table?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://rds-data.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "rds-data" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 1_000_000. */
  maxRecordBytes?: number;
}

/**
 * Upserts each record into one row per execution. Throws when the table name is not a
 * plain identifier.
 */
export function createAuroraExporter(
  config: AuroraExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };

/**
 * The CREATE TABLE IF NOT EXISTS statement for the table. Default engine "postgresql".
 * Throws for an invalid name.
 */
export function createTableSql(
  table?: string,
  options?: { engine?: "postgresql" | "mysql" },
): string;
