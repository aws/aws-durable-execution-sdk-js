import type { AwsClient, TelemetryExporter } from "../index.js";

export interface OpenSearchExporterConfig {
  /**
   * The domain endpoint, for example "https://my-domain.us-east-1.es.amazonaws.com".
   * Required without client. Unused with client.
   */
  endpoint?: string;
  /** The index. OpenSearch creates it on the first write. Default "durable-execution-telemetry". */
  indexName?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: the built-in client, signed for "es" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 10_000_000. */
  maxRecordBytes?: number;
}

/** Indexes each record as one document with the executionArn as id. Later records of an execution replace the document. */
export function createOpenSearchExporter(
  config: OpenSearchExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
