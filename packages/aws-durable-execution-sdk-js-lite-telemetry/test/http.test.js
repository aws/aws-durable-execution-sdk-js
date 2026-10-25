import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpExporter } from "../src/exporters/http.js";
import { buildRecord } from "../src/index.js";
import { applyOperationsFormat } from "../src/operations-by-name.js";
import { ARN, fakeFetch } from "./helpers.js";

const URL_ = "https://hook.example/telemetry";

const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  emittedAt: new Date("2026-01-01T00:00:10.000Z"),
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

const ok = () => new Response("accepted", { status: 200 });

test("POSTs the record as JSON with a Content-Type header and a signal", async () => {
  const fetch = fakeFetch([ok()]);
  const exporter = createHttpExporter({ url: URL_, fetch });
  assert.equal(exporter.maxRecordBytes, undefined);
  await exporter.export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.url.href, URL_);
  assert.equal(call.method, "POST");
  assert.deepEqual(call.headers, { "Content-Type": "application/json" });
  // The default "array" format sends the record unchanged.
  assert.equal(call.body, JSON.stringify(record));
  assert.ok(call.signal instanceof AbortSignal);
});

test("method and headers are sent; a header with the same key replaces the default", async () => {
  const fetch = fakeFetch([ok(), ok()]);
  await createHttpExporter({
    url: URL_,
    method: "PUT",
    headers: { Authorization: "Bearer token" },
    fetch,
  }).export(record);
  assert.equal(fetch.calls[0].method, "PUT");
  assert.deepEqual(fetch.calls[0].headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer token",
  });
  await createHttpExporter({
    url: URL_,
    headers: { "Content-Type": "application/x-ndjson" },
    fetch,
  }).export(record);
  assert.deepEqual(fetch.calls[1].headers, {
    "Content-Type": "application/x-ndjson",
  });
});

test('operationsFormat "by-name" and "both" set the body', async () => {
  for (const format of ["by-name", "both"]) {
    const fetch = fakeFetch([ok()]);
    await createHttpExporter({
      url: URL_,
      operationsFormat: format,
      fetch,
    }).export(record);
    const body = fetch.calls[0].body;
    assert.equal(body, JSON.stringify(applyOperationsFormat(record, format)));
    assert.equal(JSON.parse(body).operationsByName.charge.status, "SUCCEEDED");
  }
});

test("the body of a 2xx response is read, so the connection is released", async () => {
  const response = ok();
  await createHttpExporter({ url: URL_, fetch: fakeFetch([response]) }).export(
    record,
  );
  assert.equal(response.bodyUsed, true);
});

test("a response that is not 2xx rejects with the status and the first 200 characters of the body", async () => {
  const body = `${"x".repeat(200)}TAIL`;
  const fetch = fakeFetch([
    new Response(body, { status: 503, statusText: "Service Unavailable" }),
  ]);
  await assert.rejects(
    createHttpExporter({ url: URL_, fetch }).export(record),
    {
      name: "Error",
      status: 503,
      message: `HTTP exporter: the endpoint returned 503 Service Unavailable. Body: "${"x".repeat(200)}"`,
    },
  );
});

test("timeoutMs aborts a request that does not finish", async () => {
  // A fetch that never resolves. It rejects with the reason of the signal, as Node's
  // fetch does. The timer of AbortSignal.timeout does not keep Node's event loop
  // running. A real request keeps it running with its socket. So the fake keeps it
  // running with its own timer.
  const fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      const socket = setTimeout(() => {}, 5_000);
      signal.addEventListener("abort", () => {
        clearTimeout(socket);
        reject(signal.reason);
      });
    });
  await assert.rejects(
    createHttpExporter({ url: URL_, timeoutMs: 10, fetch }).export(record),
    { name: "TimeoutError" },
  );
});

test("the default timeout is 10_000 ms", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  const fetch = fakeFetch([ok()]);
  await createHttpExporter({ url: URL_, fetch }).export(record);
  assert.deepEqual(timeout.mock.calls[0].arguments, [10_000]);
  assert.equal(fetch.calls[0].signal, timeout.mock.calls[0].result);
});

test("the default fetch is globalThis.fetch", async (t) => {
  const fetch = fakeFetch([ok()]);
  t.mock.method(globalThis, "fetch", fetch);
  await createHttpExporter({ url: URL_ }).export(record);
  assert.equal(fetch.calls.length, 1);
});

test("maxRecordBytes can be set", () => {
  assert.equal(
    createHttpExporter({ url: URL_, maxRecordBytes: 1 }).maxRecordBytes,
    1,
  );
});
