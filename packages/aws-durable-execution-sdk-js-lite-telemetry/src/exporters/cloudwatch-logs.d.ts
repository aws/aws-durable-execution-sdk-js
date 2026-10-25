import type { AwsClient, TelemetryExporter } from "../index.js";

export interface CloudWatchLogsExporterConfig {
  /** The log group. It must exist. */
  logGroupName: string;
  /** The stream name is `${logStreamPrefix}YYYY/MM/DD` (UTC). Default "durable-execution-telemetry/". */
  logStreamPrefix?: string;
  /** The region of the built-in client. Default: process.env.AWS_REGION. Unused with client. */
  region?: string;
  /** Default: `https://logs.${region}.amazonaws.com`. Unused with client. */
  endpoint?: string;
  /** Default: the built-in client, signed for "logs" with the Lambda credentials. */
  client?: AwsClient;
  /** Default 256_000. */
  maxRecordBytes?: number;
}

/** Writes each record as one log event, with operations rendered as operationsByName. */
export function createCloudWatchLogsExporter(
  config: CloudWatchLogsExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
