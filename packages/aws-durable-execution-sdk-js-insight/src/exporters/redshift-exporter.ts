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

  /**
   * Max serialized record size before truncation.
   * Default: 1_000_000 (Redshift Data API practical statement/parameter limit).
   */
  maxRecordSizeBytes?: number;
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
  readonly maxRecordSizeBytes: number;

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
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 1_000_000;
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

    // Nullable fields: the Redshift Data API doesn't support NULL/empty-string
    // parameter values, so absent values are emitted as typed SQL NULL literals
    // in the source projection instead of bound parameters.
    const endTimeSel = record.endTime
      ? (parameters.push({ name: "end_time", value: record.endTime }),
        ":end_time::varchar")
      : "NULL::varchar";
    const durationSel =
      record.durationMs != null
        ? (parameters.push({
            name: "duration_ms",
            value: String(record.durationMs),
          }),
          ":duration_ms::bigint")
        : "NULL::bigint";
    const execNameSel = record.executionName
      ? (parameters.push({
          name: "execution_name",
          value: record.executionName,
        }),
        ":execution_name::varchar")
      : "NULL::varchar";

    // Upsert by executionArn. The source row is projected in a subquery and the
    // MERGE joins target/source on execution_arn — Redshift's MERGE requires an
    // equality join on a SOURCE COLUMN (joining on a parameter/constant makes it
    // plan a NestedLoop join, which MERGE rejects with "NestedLoop join is not
    // supported in MERGE"). record_json is populated with JSON_PARSE(...) so it
    // lands in the SUPER column.
    const sql = `MERGE INTO ${this.fqTable} USING (
      SELECT
        :execution_arn::varchar AS execution_arn,
        ${execNameSel} AS execution_name,
        :function_name::varchar AS function_name,
        :status::varchar AS status,
        :start_time::varchar AS start_time,
        ${endTimeSel} AS end_time,
        ${durationSel} AS duration_ms,
        JSON_PARSE(:record_json) AS record_json,
        :emitted_at::varchar AS emitted_at
    ) AS src
    ON ${this.fqTable}.execution_arn = src.execution_arn
    WHEN MATCHED THEN UPDATE SET
      status = src.status,
      end_time = src.end_time,
      duration_ms = src.duration_ms,
      record_json = src.record_json,
      emitted_at = src.emitted_at
    WHEN NOT MATCHED THEN INSERT
      (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
    VALUES
      (src.execution_arn, src.execution_name, src.function_name, src.status, src.start_time, src.end_time, src.duration_ms, src.record_json, src.emitted_at)`;

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
