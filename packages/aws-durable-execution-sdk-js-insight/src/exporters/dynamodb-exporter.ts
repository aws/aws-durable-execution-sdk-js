import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { InsightExporter, WorkflowInsightRecord } from "../types";
import { withOperationsByName } from "../operations-index";

/**
 * Configuration for the DynamoDB exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface DynamoDBExporterConfig {
  /** DynamoDB table name. */
  tableName: string;

  /**
   * Partition key attribute name. The value will be the executionArn.
   * Default: "pk"
   */
  partitionKey?: string;

  /**
   * Sort key attribute name. The value will be the emittedAt timestamp.
   * If omitted, no sort key is used (table must be key-only on pk).
   * Default: "sk"
   */
  sortKey?: string;

  /** AWS region of the table. If omitted, uses the SDK default. */
  region?: string;

  /**
   * Max serialized record size before truncation.
   * Default: 400_000 (DynamoDB's 400 KB item limit).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records to Amazon DynamoDB.
 *
 * Each record is written via PutItem keyed by executionArn (partition key).
 * With the default sort key ("sk" = emittedAt), each export creates a new
 * item — giving you a full history. Without a sort key, subsequent exports
 * for the same execution **overwrite** the previous item (upsert).
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class DynamoDBExporter implements InsightExporter {
  private readonly tableName: string;
  private readonly partitionKey: string;
  private readonly sortKey: string | undefined;
  private readonly client: DynamoDBClient;
  readonly maxRecordSizeBytes: number;

  constructor(config: DynamoDBExporterConfig) {
    this.tableName = config.tableName;
    this.partitionKey = config.partitionKey ?? "pk";
    this.sortKey = config.sortKey ?? "sk";
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 400_000;
    this.client = new DynamoDBClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const item: Record<string, unknown> = {
      ...withOperationsByName(record),
      [this.partitionKey]: record.executionArn,
    };

    if (this.sortKey) {
      item[this.sortKey] = record.emittedAt;
    }

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single PutItem.
  }
}
