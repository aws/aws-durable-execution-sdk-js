import type { AwsClient, TelemetryExporter } from "../index.js";

export interface DynamoDBExporterConfig {
  /** The table. It must exist. */
  tableName: string;
  /** The partition key attribute. Its value is the executionArn. Default "pk". */
  partitionKey?: string;
  /** The sort key attribute. Its value is emittedAt. Default "sk". "" means no sort key. */
  sortKey?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://dynamodb.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "dynamodb" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 400_000. */
  maxRecordBytes?: number;
}

/** Writes each record as one item with PutItem, with operations rendered as operationsByName. */
export function createDynamoDBExporter(
  config: DynamoDBExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
