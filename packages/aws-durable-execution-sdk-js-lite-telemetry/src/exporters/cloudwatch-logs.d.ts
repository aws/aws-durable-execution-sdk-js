import type { TelemetryExporter } from "../index.js";

export interface CloudWatchLogsExporterConfig {
  /** The log group. It must exist. */
  logGroupName: string;
  /** The stream name is `${logStreamPrefix}YYYY/MM/DD` (UTC). Default "durable-execution-telemetry/". */
  logStreamPrefix?: string;
  /** An object with send(command), such as a CloudWatchLogsClient. Default: new CloudWatchLogsClient({}). */
  client?: { send(command: unknown): Promise<unknown> };
  /** Default 256_000. */
  maxRecordBytes?: number;
}

/** Writes each record as one log event, with operations rendered as operationsByName. */
export function createCloudWatchLogsExporter(
  config: CloudWatchLogsExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
