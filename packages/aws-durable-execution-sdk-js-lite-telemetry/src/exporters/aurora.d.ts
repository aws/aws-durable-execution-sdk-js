import type { TelemetryExporter } from "../index.js";

export interface AuroraExporterConfig {
  /** The Aurora PostgreSQL cluster ARN. The cluster must have the Data API enabled. */
  resourceArn: string;
  /** The Secrets Manager secret that holds the database credentials. */
  secretArn: string;
  database: string;
  /** Letters, digits and underscores; not starting with a digit. Default "durable_execution_telemetry". */
  table?: string;
  /** An object with send(command), such as an RDSDataClient. Default: new RDSDataClient({}). */
  client?: { send(command: unknown): Promise<unknown> };
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

/** The CREATE TABLE IF NOT EXISTS statement for the table. Throws for an invalid name. */
export function createTableSql(table?: string): string;
