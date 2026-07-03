import type {
  InsightExporter,
  OperationsFormat,
  WorkflowInsightRecord,
} from "../types";
import { applyOperationsFormat } from "../operations-index";

/**
 * Configuration for the OpenTelemetry log exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface OTelExporterConfig {
  /**
   * OTLP endpoint for log ingestion.
   * e.g. "http://localhost:4318/v1/logs" or "https://otlp.vendor.com/v1/logs"
   */
  endpoint: string;

  /** Additional headers (e.g. API keys, auth tokens). */
  headers?: Record<string, string>;

  /**
   * OTLP protocol.
   * - "http/json": JSON over HTTP (default, widest compatibility)
   * - "http/protobuf": protobuf over HTTP (more efficient, requires protobuf serialization)
   * Default: "http/json"
   */
  protocol?: "http/json" | "http/protobuf";

  /**
   * How operations are rendered in the log body: the canonical `operations`
   * array (`"array"`, default), the name-keyed `operationsByName` map
   * (`"by-name"`), or `"both"`. Operations are only in the log body (not
   * attributes), so this has no effect on attribute cardinality.
   */
  operationsFormat?: OperationsFormat;

  /**
   * Max serialized record size before truncation.
   * Default: 1_000_000 (a conservative OTLP/HTTP request guard).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records as OpenTelemetry log records via the
 * OTLP HTTP protocol. Compatible with any OTLP-capable backend (Datadog,
 * Grafana, Jaeger, Splunk, New Relic, etc.).
 *
 * Each WorkflowInsightRecord is mapped to a single OTLP LogRecord with
 * the record fields as resource/log attributes and the full JSON as the
 * log body.
 *
 * Uses native `fetch` (available in Node 22+ / Lambda runtime) — no
 * additional dependencies required.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class OTelExporter implements InsightExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly operationsFormat: OperationsFormat;
  readonly maxRecordSizeBytes: number;

  constructor(config: OTelExporterConfig) {
    if (config.protocol === "http/protobuf") {
      throw new Error(
        "OTelExporter: http/protobuf is not yet supported. Use http/json.",
      );
    }
    this.endpoint = config.endpoint;
    this.headers = config.headers ?? {};
    this.operationsFormat = config.operationsFormat ?? "array";
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 1_000_000;
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const payload = this.buildPayload(record);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `OTelExporter: OTLP endpoint returned ${response.status} ${response.statusText}`,
      );
    }
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single HTTP request.
  }

  /**
   * Build an OTLP ExportLogsServiceRequest payload.
   * Spec: https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
   */
  private buildPayload(record: WorkflowInsightRecord) {
    return {
      resourceLogs: [
        {
          resource: {
            attributes: [
              kv("service.name", record.functionName),
              kv("cloud.region", record.region),
              kv("cloud.account.id", record.accountId),
              kv("faas.name", record.functionName),
              kv("faas.version", record.functionQualifier),
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "@aws/durable-execution-sdk-js-insight",
                version: record.schemaVersion,
              },
              logRecords: [
                {
                  timeUnixNano: toNano(record.emittedAt),
                  severityNumber: severityFor(record.status),
                  severityText: record.status,
                  body: {
                    stringValue: JSON.stringify(
                      applyOperationsFormat(record, this.operationsFormat),
                    ),
                  },
                  attributes: [
                    kv("workflow.execution_arn", record.executionArn),
                    kv("workflow.execution_name", record.executionName ?? ""),
                    kv("workflow.status", record.status),
                    kv("workflow.duration_ms", record.durationMs ?? 0),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }
}

function kv(key: string, value: string | number) {
  return typeof value === "number"
    ? { key, value: { intValue: String(value) } }
    : { key, value: { stringValue: value } };
}

function toNano(isoString: string): string {
  return String(new Date(isoString).getTime() * 1_000_000);
}

function severityFor(status: string): number {
  switch (status) {
    case "FAILED":
      return 17; // ERROR
    case "RUNNING":
      return 9; // INFO
    case "SUCCEEDED":
      return 9; // INFO
    default:
      return 0; // UNSPECIFIED
  }
}
