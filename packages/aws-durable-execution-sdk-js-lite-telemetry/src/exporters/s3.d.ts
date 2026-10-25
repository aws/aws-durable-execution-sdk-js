import type { AwsClient, TelemetryExporter } from "../index.js";

export interface S3ExporterConfig {
  /** The bucket. It must exist. Used only for the default endpoint. */
  bucket: string;
  /** The start of every key. Default "durable-execution-telemetry/". */
  keyPrefix?: string;
  /**
   * The part of the key between keyPrefix and the file name. Default "date".
   * - "date": `year=YYYY/month=MM/day=DD/`, the UTC date of startTime.
   * - "function-name": `function=NAME/`.
   * - "none": nothing.
   */
  partitioning?: "date" | "function-name" | "none";
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://${bucket}.s3.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "s3" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 5_000_000. */
  maxRecordBytes?: number;
}

/** Writes each record as one JSON object with PutObject. Later records of an execution replace the object. */
export function createS3Exporter(
  config: S3ExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
