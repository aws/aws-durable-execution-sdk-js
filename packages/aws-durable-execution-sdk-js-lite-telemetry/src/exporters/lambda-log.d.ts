import type { TelemetryExporter } from "../index.js";

export interface LambdaLogExporterConfig {
  /** Default 256_000. */
  maxRecordBytes?: number;
}

/** Writes each record with console.log, as JSON with operationsByName. Lambda sends it to the function's log group. */
export function createLambdaLogExporter(
  config?: LambdaLogExporterConfig,
): TelemetryExporter & { maxRecordBytes: number };
