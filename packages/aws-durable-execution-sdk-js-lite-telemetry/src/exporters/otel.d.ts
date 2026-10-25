import type { OperationsFormat, TelemetryExporter } from "../index.js";

export interface OtelLogsExporterConfig {
  /** The OTLP/HTTP logs URL, for example "http://localhost:4318/v1/logs". Required. */
  endpoint: string;
  /** Added to every request, for example { authorization: `Bearer ${token}` }. They replace content-type. Default {}. */
  headers?: Record<string, string>;
  /** The timeout of one request, in milliseconds. Default 5_000. */
  timeoutMs?: number;
  /** How the log body holds the operations. See OperationsFormat. Default "array". */
  operationsFormat?: OperationsFormat;
  /** Default 1_000_000. */
  maxRecordBytes?: number;
  /** The fetch function. Default: globalThis.fetch when the exporter is created. */
  fetch?: typeof globalThis.fetch;
}

/** Sends each record as one OTLP log record, POSTed as OTLP/HTTP JSON. The log body is the record as JSON, in operationsFormat. */
export function createOtelLogsExporter(
  config: OtelLogsExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
