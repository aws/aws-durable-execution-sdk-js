import assert from "node:assert/strict";
import { test } from "node:test";
import { createOtelLogsExporter } from "../src/exporters/otel.js";
import { buildRecord } from "../src/index.js";
import { applyOperationsFormat } from "../src/operations-by-name.js";
import { ARN, fakeFetch } from "./helpers.js";

const ENDPOINT = "https://otlp.example.com/v1/logs";
const EMITTED_AT = "2026-01-01T00:00:10.001Z";
// Date.parse(EMITTED_AT) is 1767225610001 ms.
const EMITTED_NANOS = "1767225610001000000";

const makeRecord = ({ arn = ARN, status = "SUCCEEDED" } = {}) =>
  buildRecord({
    arn,
    status,
    emittedAt: new Date(EMITTED_AT),
    operations: [
      { Id: "e", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
      {
        Id: "1",
        Name: "charge",
        Type: "STEP",
        Status: "SUCCEEDED",
        StartTimestamp: 1,
        EndTimestamp: 2,
      },
    ],
  });
const record = makeRecord();

const ok = () => new Response("{}", { status: 200 });

// Exports one record and returns the fetch call and the parsed OTLP request.
const exportOne = async (config = {}, rec = record) => {
  const fetch = fakeFetch([ok()]);
  await createOtelLogsExporter({ endpoint: ENDPOINT, fetch, ...config }).export(
    rec,
  );
  return { call: fetch.calls[0], payload: JSON.parse(fetch.calls[0].body) };
};
const logRecordOf = (payload) =>
  payload.resourceLogs[0].scopeLogs[0].logRecords[0];

test("one POST with the OTLP ExportLogsServiceRequest of the record", async () => {
  const { call, payload } = await exportOne();
  assert.equal(call.url.href, ENDPOINT);
  assert.equal(call.method, "POST");
  assert.deepEqual(call.headers, { "content-type": "application/json" });
  assert.deepEqual(payload, {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "workflow" } },
            { key: "cloud.region", value: { stringValue: "us-east-1" } },
            { key: "cloud.account.id", value: { stringValue: "123456789012" } },
            { key: "faas.name", value: { stringValue: "workflow" } },
            { key: "faas.version", value: { stringValue: "$LATEST" } },
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: "@aws/durable-execution-sdk-js-telemetry-exporter",
              version: "1.0",
            },
            logRecords: [
              {
                timeUnixNano: EMITTED_NANOS,
                severityNumber: 9,
                severityText: "SUCCEEDED",
                body: { stringValue: JSON.stringify(record) },
                attributes: [
                  {
                    key: "workflow.execution_arn",
                    value: { stringValue: ARN },
                  },
                  {
                    key: "workflow.execution_name",
                    value: { stringValue: "local" },
                  },
                  {
                    key: "workflow.status",
                    value: { stringValue: "SUCCEEDED" },
                  },
                  // OTLP/JSON encodes int64 as a string.
                  {
                    key: "workflow.duration_ms",
                    value: { intValue: String(record.durationMs) },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(typeof record.durationMs, "number");
  // The default "array" format keeps the operations array in the body.
  const body = JSON.parse(logRecordOf(payload).body.stringValue);
  assert.equal(body.operations[0].name, "charge");
  assert.equal(body.operationsByName, undefined);
});

test("FAILED is severity 17 (ERROR); SUCCEEDED and RUNNING are 9 (INFO)", async () => {
  for (const [status, severity] of [
    ["FAILED", 17],
    ["SUCCEEDED", 9],
    ["RUNNING", 9],
  ]) {
    const { payload } = await exportOne({}, makeRecord({ status }));
    const logRecord = logRecordOf(payload);
    assert.equal(logRecord.severityNumber, severity, status);
    assert.equal(logRecord.severityText, status);
  }
});

test("a RUNNING record has duration 0 and a record without a name has an empty name", async () => {
  const running = logRecordOf(
    (await exportOne({}, makeRecord({ status: "RUNNING" }))).payload,
  );
  assert.deepEqual(running.attributes[3], {
    key: "workflow.duration_ms",
    value: { intValue: "0" },
  });

  const noNameArn =
    "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST";
  const noName = makeRecord({ arn: noNameArn });
  assert.equal(noName.executionName, undefined);
  const attrs = logRecordOf((await exportOne({}, noName)).payload).attributes;
  assert.deepEqual(attrs[1], {
    key: "workflow.execution_name",
    value: { stringValue: "" },
  });
});

test('operationsFormat "by-name" and "both" set the log body', async () => {
  for (const format of ["by-name", "both"]) {
    const { payload } = await exportOne({ operationsFormat: format });
    const body = logRecordOf(payload).body.stringValue;
    assert.equal(
      body,
      JSON.stringify(applyOperationsFormat(record, format)),
      format,
    );
    assert.equal(JSON.parse(body).operationsByName.charge.status, "SUCCEEDED");
  }
});

test("headers are added to the request and can replace content-type", async () => {
  const { call } = await exportOne({
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/x-test",
    },
  });
  assert.deepEqual(call.headers, {
    "content-type": "application/x-test",
    authorization: "Bearer test-token",
  });
});

test("a non-2xx response rejects with the status and the first 200 characters of the body", async () => {
  const fetch = fakeFetch([
    new Response(`bad${"x".repeat(300)}`, {
      status: 400,
      statusText: "Bad Request",
    }),
  ]);
  const exporter = createOtelLogsExporter({ endpoint: ENDPOINT, fetch });
  await assert.rejects(exporter.export(record), {
    status: 400,
    message: `OTLP endpoint returned 400 Bad Request: bad${"x".repeat(197)}`,
  });
});

test("a 2xx response with partialSuccess resolves", async () => {
  const body = { partialSuccess: { rejectedLogRecords: "1" } };
  const fetch = fakeFetch([new Response(JSON.stringify(body))]);
  await createOtelLogsExporter({ endpoint: ENDPOINT, fetch }).export(record);
  assert.equal(fetch.calls.length, 1);
});

test("each request has a timeout signal of timeoutMs, default 5_000", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  const { call } = await exportOne();
  assert.ok(call.signal instanceof AbortSignal);
  await exportOne({ timeoutMs: 250 });
  assert.deepEqual(
    timeout.mock.calls.map((c) => c.arguments[0]),
    [5_000, 250],
  );
});

test("a request that exceeds timeoutMs rejects with a TimeoutError", async () => {
  // The timer of AbortSignal.timeout does not keep Node.js running. So the fake fetch
  // holds its own timer until the abort.
  const fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => {}, 5_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
  const exporter = createOtelLogsExporter({
    endpoint: ENDPOINT,
    fetch,
    timeoutMs: 10,
  });
  await assert.rejects(exporter.export(record), { name: "TimeoutError" });
});

test("fetch defaults to globalThis.fetch", async (t) => {
  const fetch = fakeFetch([ok()]);
  t.mock.method(globalThis, "fetch", fetch);
  await createOtelLogsExporter({ endpoint: ENDPOINT }).export(record);
  assert.equal(fetch.calls.length, 1);
});

test("maxRecordBytes defaults to 1_000_000 and can be set", () => {
  assert.equal(
    createOtelLogsExporter({ endpoint: ENDPOINT }).maxRecordBytes,
    1_000_000,
  );
  assert.equal(
    createOtelLogsExporter({ endpoint: ENDPOINT, maxRecordBytes: 1 })
      .maxRecordBytes,
    1,
  );
});
