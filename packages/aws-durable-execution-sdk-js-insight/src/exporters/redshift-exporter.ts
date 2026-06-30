import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  type SqlParameter,
} from "@aws-sdk/client-redshift-data";
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
 * Configuration for the Redshift exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface RedshiftExporterConfig {
  /**
   * Redshift cluster identifier (for provisioned)
   * or workgroup name (for Serverless).
   */
  workgroupName?: string;

  /** Cluster identifier (provisioned Redshift). Mutually exclusive with workgroupName. */
  clusterIdentifier?: string;

  /** Database name. */
  database: string;

  /**
   * Database user (provisioned Redshift with temporary credentials).
   * Not needed for Serverless (uses IAM identity).
   */
  dbUser?: string;

  /**
   * Secrets Manager secret ARN for authentication.
   * Alternative to dbUser for provisioned clusters.
   */
  secretArn?: string;

  /** Table name. Default: "workflow_insight" */
  table?: string;

  /** Schema name. Default: "public" */
  schema?: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;
}

/**
 * Exports workflow insight records to Amazon Redshift via the Redshift Data API.
 *
 * Supports both provisioned clusters and Redshift Serverless. Records are
 * upserted by executionArn using a MERGE statement — subsequent exports for
 * the same execution overwrite the previous row.
 *
 * No VPC or JDBC driver required. The Data API is asynchronous but we fire
 * and don't wait for completion (best-effort, consistent with plugin design).
 *
 * Requires IAM: redshift-data:ExecuteStatement (and redshift-serverless:GetCredentials
 * for Serverless, or redshift:GetClusterCredentialsWithIAM for provisioned).
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class RedshiftExporter implements InsightExporter {
  private readonly database: string;
  private readonly fqTable: string;
  private readonly workgroupName?: string;
  private readonly clusterIdentifier?: string;
  private readonly dbUser?: string;
  private readonly secretArn?: string;
  private readonly client: RedshiftDataClient;

  constructor(config: RedshiftExporterConfig) {
    if (!config.workgroupName && !config.clusterIdentifier) {
      throw new Error(
        "RedshiftExporter: provide either workgroupName or clusterIdentifier.",
      );
    }
    this.database = config.database;
    const table = sanitizeIdentifier(config.table ?? "workflow_insight");
    const schema = sanitizeIdentifier(config.schema ?? "public");
    this.fqTable = `${schema}.${table}`;
    this.workgroupName = config.workgroupName;
    this.clusterIdentifier = config.clusterIdentifier;
    this.dbUser = config.dbUser;
    this.secretArn = config.secretArn;
    this.client = new RedshiftDataClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const parameters: SqlParameter[] = [
      { name: "execution_arn", value: record.executionArn },
      { name: "function_name", value: record.functionName },
      { name: "status", value: record.status },
      { name: "start_time", value: record.startTime },
      { name: "record_json", value: JSON.stringify(record) },
      { name: "emitted_at", value: record.emittedAt },
    ];

    // Nullable fields: Redshift Data API doesn't support NULL or empty string
    // in parameters, so we use SQL NULL literals for absent values.
    const endTimeExpr = record.endTime
      ? (parameters.push({ name: "end_time", value: record.endTime }),
        ":end_time")
      : "NULL";
    const durationExpr =
      record.durationMs != null
        ? (parameters.push({
            name: "duration_ms",
            value: String(record.durationMs),
          }),
          ":duration_ms")
        : "NULL";
    const execNameExpr = record.executionName
      ? (parameters.push({
          name: "execution_name",
          value: record.executionName,
        }),
        ":execution_name")
      : "NULL";

    const sql = `MERGE INTO ${this.fqTable} USING (SELECT 1) AS src
    ON ${this.fqTable}.execution_arn = :execution_arn
    WHEN MATCHED THEN UPDATE SET
      status = :status,
      end_time = ${endTimeExpr},
      duration_ms = ${durationExpr},
      record_json = :record_json,
      emitted_at = :emitted_at
    WHEN NOT MATCHED THEN INSERT
      (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
    VALUES
      (:execution_arn, ${execNameExpr}, :function_name, :status, :start_time, ${endTimeExpr}, ${durationExpr}, :record_json, :emitted_at)`;

    await this.client.send(
      new ExecuteStatementCommand({
        WorkgroupName: this.workgroupName,
        ClusterIdentifier: this.clusterIdentifier,
        Database: this.database,
        DbUser: this.dbUser,
        SecretArn: this.secretArn,
        Sql: sql,
        Parameters: parameters,
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single ExecuteStatement.
  }
}
