import type { AwsClient, TelemetryExporter } from "../index.js";

export interface EventBridgeExporterConfig {
  /** The event bus name or ARN. Default "default". */
  eventBusName?: string;
  /** The event source. Must not start with "aws.". Default "software.amazon.lambda.durable.telemetry". */
  source?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://events.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "events" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 256_000. */
  maxRecordBytes?: number;
}

/**
 * Publishes each record as one event: the detail-type is the record status, the detail
 * is the record. Rejects when PutEvents reports a failed entry.
 */
export function createEventBridgeExporter(
  config?: EventBridgeExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
