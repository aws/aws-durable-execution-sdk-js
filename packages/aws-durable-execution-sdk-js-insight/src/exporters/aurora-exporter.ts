import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/** Validates a SQL identifier (table/schema name) to prevent injection. */
function sanitizeIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid SQL identifier: "${name}". Only letters, digits, and underscores are allowed.`,
    );
  }
  return name;
}

/**
 * Configuration for the Aurora exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface AuroraExporterConfig {
  /** Aurora cluster ARN. */
  resourceArn: string;

  /** Secrets Manager secret ARN for Data API authentication. */
  secretArn: string;

  /** Database name. */
  database: string;

  /** Table name. Default: "workflow_insight" */
  table?: string;

  /** Database engine. Determines upsert SQL dialect. */
  engine: "postgresql" | "mysql";

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;
}

/**
 * Exports workflow insight records to Amazon Aurora (MySQL or PostgreSQL)
 * via the RDS Data API.
 *
 * Records are upserted by executionArn — subsequent exports for the same
 * execution overwrite the previous row. No VPC or connection pooling required.
 *
 * Requires the Aurora cluster to have the Data API enabled.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class AuroraExporter implements InsightExporter {
  private readonly resourceArn: string;
  private readonly secretArn: string;
  private readonly database: string;
  private readonly table: string;
  private readonly engine: "postgresql" | "mysql";
  private readonly client: RDSDataClient;

  constructor(config: AuroraExporterConfig) {
    this.resourceArn = config.resourceArn;
    this.secretArn = config.secretArn;
    this.database = config.database;
    this.table = sanitizeIdentifier(config.table ?? "workflow_insight");
    this.engine = config.engine;
    this.client = new RDSDataClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const sql =
      this.engine === "postgresql"
        ? this.buildPostgresUpsert()
        : this.buildMysqlUpsert();

    await this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.resourceArn,
        secretArn: this.secretArn,
        database: this.database,
        sql,
        parameters: [
          {
            name: "execution_arn",
            value: { stringValue: record.executionArn },
          },
          {
            name: "execution_name",
            value: record.executionName
              ? { stringValue: record.executionName }
              : { isNull: true },
          },
          {
            name: "function_name",
            value: { stringValue: record.functionName },
          },
          { name: "status", value: { stringValue: record.status } },
          {
            name: "start_time",
            value: { stringValue: record.startTime },
          },
          {
            name: "end_time",
            value: record.endTime
              ? { stringValue: record.endTime }
              : { isNull: true },
          },
          {
            name: "duration_ms",
            value:
              record.durationMs != null
                ? { longValue: record.durationMs }
                : { isNull: true },
          },
          {
            name: "record_json",
            value: { stringValue: JSON.stringify(record) },
          },
          {
            name: "emitted_at",
            value: { stringValue: record.emittedAt },
          },
        ],
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single statement.
  }

  private buildPostgresUpsert(): string {
    return `INSERT INTO ${this.table}
      (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
    VALUES
      (:execution_arn, :execution_name, :function_name, :status, :start_time::timestamptz, :end_time::timestamptz, :duration_ms, :record_json::jsonb, :emitted_at::timestamptz)
    ON CONFLICT (execution_arn) DO UPDATE SET
      status = EXCLUDED.status,
      end_time = EXCLUDED.end_time,
      duration_ms = EXCLUDED.duration_ms,
      record_json = EXCLUDED.record_json,
      emitted_at = EXCLUDED.emitted_at`;
  }

  private buildMysqlUpsert(): string {
    return `INSERT INTO ${this.table}
      (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
    VALUES
      (:execution_arn, :execution_name, :function_name, :status, :start_time, :end_time, :duration_ms, :record_json, :emitted_at)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      end_time = VALUES(end_time),
      duration_ms = VALUES(duration_ms),
      record_json = VALUES(record_json),
      emitted_at = VALUES(emitted_at)`;
  }
}
