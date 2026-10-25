import type { AwsClient, TelemetryExporter } from "../index.js";

export interface FirehoseExporterConfig {
  /** The delivery stream. It must exist and have the source "Direct PUT". */
  deliveryStreamName: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://firehose.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "firehose" with the Lambda credentials. */
  client?: AwsClient;
  /** The record JSON in bytes, without the trailing newline. Default 1_000_000. */
  maxRecordBytes?: number;
}

/** Sends each record as one line of newline-delimited JSON with PutRecord. */
export function createFirehoseExporter(
  config: FirehoseExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
