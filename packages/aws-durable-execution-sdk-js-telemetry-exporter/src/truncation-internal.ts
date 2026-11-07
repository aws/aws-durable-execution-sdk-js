import type { OperationsFormat } from "./types";

export interface TruncationFormat {
  operations: OperationsFormat | "by-name";
  envelope?: "otel";
}

// Keep sizing metadata outside exported class declarations. Otherwise TypeScript
// publishes an implementation detail on every first-party exporter type.
const formats = new WeakMap<object, TruncationFormat>();

export function registerTruncationFormat(
  exporter: object,
  format: TruncationFormat,
): void {
  formats.set(exporter, format);
}

export function getTruncationFormat(
  exporter: object,
): TruncationFormat | undefined {
  return formats.get(exporter);
}
