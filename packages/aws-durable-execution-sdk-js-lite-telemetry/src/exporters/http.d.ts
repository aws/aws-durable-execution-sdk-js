import type { OperationsFormat, TelemetryExporter } from "../index.js";

export interface HttpExporterConfig {
  /** The URL that receives each record. */
  url: string;
  /** Default "POST". */
  method?: "POST" | "PUT";
  /** Added to the request. A "Content-Type" key replaces the default "application/json". */
  headers?: Record<string, string>;
  /** The longest time one request may take, including the response body. Default 10_000. */
  timeoutMs?: number;
  /** How the body holds the operations. See OperationsFormat. Default "array". */
  operationsFormat?: OperationsFormat;
  /** Default: no limit. */
  maxRecordBytes?: number;
  /** Default: globalThis.fetch, read when the exporter is created. */
  fetch?: typeof globalThis.fetch;
}

/** Sends each record as one JSON request. A response that is not 2xx rejects the export. */
export function createHttpExporter(
  config: HttpExporterConfig,
): TelemetryExporter & { maxRecordBytes: number | undefined };
