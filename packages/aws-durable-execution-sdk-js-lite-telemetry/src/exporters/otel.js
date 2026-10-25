import { applyOperationsFormat } from "../operations-by-name.js";

// One OTLP attribute. OTLP/JSON encodes a 64-bit integer as a string, because JSON
// numbers lose precision above 2^53. So a number becomes { intValue: "123" }.
const kv = (key, value) =>
  typeof value === "number"
    ? { key, value: { intValue: String(value) } }
    : { key, value: { stringValue: value } };

// The record status is SUCCEEDED, FAILED or RUNNING. OTLP severity 17 is ERROR and 9 is
// INFO, as in the full SDK.
const severityFor = (status) => (status === "FAILED" ? 17 : 9);

// The OTLP/HTTP JSON ExportLogsServiceRequest of one record, as in the full SDK's
// OTelExporter. The log body is the record as JSON. The attributes repeat a few fields,
// so a backend can filter without parsing the body.
function buildOtlpLogsRequest(record, operationsFormat) {
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
            // The full SDK's scope name and version. So a backend query on the scope
            // finds the records of both packages.
            scope: {
              name: "@aws/durable-execution-sdk-js-telemetry-exporter",
              version: record.schemaVersion,
            },
            logRecords: [
              {
                // emittedAt has milliseconds. The product has at most 19 digits, and
                // String prints it without rounding.
                timeUnixNano: String(Date.parse(record.emittedAt) * 1_000_000),
                severityNumber: severityFor(record.status),
                severityText: record.status,
                body: {
                  stringValue: JSON.stringify(
                    applyOperationsFormat(record, operationsFormat),
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

// Sends each record as one OpenTelemetry log record over OTLP/HTTP with JSON, as in the
// full SDK's OTelExporter.
export function createOtelLogsExporter({
  endpoint,
  headers = {},
  // The plugin stops waiting after exportTimeoutMs. A request without a timeout then
  // keeps running in the background. So the request has its own timeout.
  timeoutMs = 5_000,
  // "array", "by-name" or "both", as in the full SDK. See applyOperationsFormat.
  operationsFormat = "array",
  // The full SDK's default: a conservative limit for one OTLP/HTTP request.
  maxRecordBytes = 1_000_000,
  fetch = globalThis.fetch,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      const response = await fetch(endpoint, {
        method: "POST",
        // The caller's headers come last. So they can replace content-type.
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(buildOtlpLogsRequest(record, operationsFormat)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A 2xx response can hold partialSuccess with rejected log records. The full SDK
      // does not read it. So this exporter does not read it either.
      if (!response.ok) {
        const excerpt = (await response.text()).slice(0, 200);
        throw Object.assign(
          new Error(
            `OTLP endpoint returned ${response.status} ${response.statusText}: ${excerpt}`,
          ),
          { status: response.status },
        );
      }
    },
  };
}
