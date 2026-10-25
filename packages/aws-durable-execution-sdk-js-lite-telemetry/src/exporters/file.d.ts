import type { OperationsFormat, TelemetryExporter } from "../index.js";

export interface FileExporterConfig {
  /** The directory of the files. The exporter creates it. On Lambda, only /tmp and mounted file systems are writable. */
  directory: string;
  /** "ndjson": append one line to {YYYY-MM-DD}.ndjson. "json": write {executionName}.json. Default "ndjson". */
  mode?: "ndjson" | "json";
  /** How the file holds the operations. See OperationsFormat. Default "array". */
  operationsFormat?: OperationsFormat;
  /** Default: no limit. */
  maxRecordBytes?: number;
}

/** Writes each record to a file in directory, in mode. */
export function createFileExporter(
  config: FileExporterConfig,
): TelemetryExporter & { maxRecordBytes: number | undefined };
