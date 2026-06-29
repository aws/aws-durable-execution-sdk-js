import {
  RedshiftDataClient,
  ExecuteStatementCommand,
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
  private readonly table: string;
  private readonly schema: string;
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
    this.table = sanitizeIdentifier(config.table ?? "workflow_insight");
    this.schema = sanitizeIdentifier(config.schema ?? "public");
    this.workgroupName = config.workgroupName;
    this.clusterIdentifier = config.clusterIdentifier;
    this.dbUser = config.dbUser;
    this.secretArn = config.secretArn;
    this.client = new RedshiftDataClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const fqTable = `${this.schema}.${this.table}`;
    const sql = this.buildMerge(fqTable, record);

    await this.client.send(
      new ExecuteStatementCommand({
        WorkgroupName: this.workgroupName,
        ClusterIdentifier: this.clusterIdentifier,
        Database: this.database,
        DbUser: this.dbUser,
        SecretArn: this.secretArn,
        Sql: sql,
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single ExecuteStatement.
  }

  private buildMerge(fqTable: string, record: WorkflowInsightRecord): string {
    const esc = (v: string | undefined | null) =>
      v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
    const num = (v: number | undefined) => (v == null ? "NULL" : String(v));

    return `MERGE INTO ${fqTable} USING (SELECT 1) AS src
    ON ${fqTable}.execution_arn = ${esc(record.executionArn)}
    WHEN MATCHED THEN UPDATE SET
      status = ${esc(record.status)},
      end_time = ${esc(record.endTime)},
      duration_ms = ${num(record.durationMs)},
      record_json = ${esc(JSON.stringify(record))},
      emitted_at = ${esc(record.emittedAt)}
    WHEN NOT MATCHED THEN INSERT
      (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
    VALUES
      (${esc(record.executionArn)}, ${esc(record.executionName)}, ${esc(record.functionName)}, ${esc(record.status)}, ${esc(record.startTime)}, ${esc(record.endTime)}, ${num(record.durationMs)}, ${esc(JSON.stringify(record))}, ${esc(record.emittedAt)})`;
  }
}
