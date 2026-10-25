import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { applyOperationsFormat } from "../src/operations-by-name.js";
import { createFirehoseExporter } from "../src/exporters/firehose.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

// The input has characters outside ASCII. So the test checks that Data is the UTF-8
// bytes of the JSON, in base64.
const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  emittedAt: new Date("2026-03-04T05:06:07.000Z"),
  input: { city: "Zürich", note: "日本" },
  operations: [
    { Id: "e", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
    {
      Id: "1",
      Name: "charge",
      Type: "STEP",
      SubType: "Step",
      Status: "SUCCEEDED",
      StartTimestamp: 1,
      EndTimestamp: 2,
      StepDetails: { Attempt: 1 },
    },
  ],
});

const decode = (data) => Buffer.from(data, "base64").toString("utf8");

test("PutRecord sends the record as one line of JSON in base64", async () => {
  const client = fakeClient(() => ({ RecordId: "r", Encrypted: false }));
  const exporter = createFirehoseExporter({
    deliveryStreamName: "telemetry",
    client,
  });
  assert.equal(exporter.maxRecordBytes, 1_000_000);
  await exporter.export(record);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.path, "/");
  assert.deepEqual(request.headers, {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-target": "Firehose_20150804.PutRecord",
  });
  assert.deepEqual(Object.keys(request.json), ["DeliveryStreamName", "Record"]);
  assert.equal(request.json.DeliveryStreamName, "telemetry");
  assert.deepEqual(Object.keys(request.json.Record), ["Data"]);
  // The record as is, with the operations array, then one newline.
  assert.equal(decode(request.json.Record.Data), `${JSON.stringify(record)}\n`);
  const parsed = JSON.parse(decode(request.json.Record.Data));
  assert.equal(parsed.input.city, "Zürich");
  assert.equal(parsed.operations[0].name, "charge");
  assert.equal(parsed.operationsByName, undefined);
});

test('operationsFormat "by-name" and "both" set the data', async () => {
  for (const format of ["by-name", "both"]) {
    const client = fakeClient();
    await createFirehoseExporter({
      deliveryStreamName: "s",
      client,
      operationsFormat: format,
    }).export(record);
    const data = decode(client.requests[0].json.Record.Data);
    assert.equal(
      data,
      `${JSON.stringify(applyOperationsFormat(record, format))}\n`,
    );
    assert.equal(JSON.parse(data).operationsByName.charge.status, "SUCCEEDED");
  }
});

test("maxRecordBytes can be set", () => {
  const exporter = createFirehoseExporter({
    deliveryStreamName: "s",
    client: fakeClient(),
    maxRecordBytes: 500,
  });
  assert.equal(exporter.maxRecordBytes, 500);
});

test("a client error rejects the export", async () => {
  const client = fakeClient(() => {
    throw Object.assign(new Error("not found"), {
      name: "ResourceNotFoundException",
      status: 400,
    });
  });
  const exporter = createFirehoseExporter({ deliveryStreamName: "s", client });
  await assert.rejects(exporter.export(record), {
    name: "ResourceNotFoundException",
    status: 400,
  });
});

test("the built-in client sends a signed AWS JSON 1.1 PutRecord to Firehose", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
    AWS_SESSION_TOKEN: "TOKEN",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-04T05:06:07.000Z"),
  });
  const fetch = fakeFetch([json(200, { RecordId: "r", Encrypted: false })]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  const exporter = createFirehoseExporter({
    deliveryStreamName: "telemetry",
    region: "eu-central-1",
  });
  await exporter.export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url.href, "https://firehose.eu-central-1.amazonaws.com/");
  assert.equal(call.headers["content-type"], "application/x-amz-json-1.1");
  assert.equal(call.headers["x-amz-target"], "Firehose_20150804.PutRecord");
  assert.equal(call.headers["x-amz-security-token"], "TOKEN");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/eu-central-1\/firehose\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
  );
  const body = JSON.parse(call.body);
  assert.equal(body.DeliveryStreamName, "telemetry");
  assert.equal(decode(body.Record.Data), `${JSON.stringify(record)}\n`);
});

test("the endpoint option reaches the built-in client", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([json(200, {})]);
  t.mock.method(globalThis, "fetch", fetch);
  await createFirehoseExporter({
    deliveryStreamName: "s",
    endpoint: "http://localhost:4566",
  }).export(record);
  assert.equal(fetch.calls[0].url.href, "http://localhost:4566/");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/us-west-2\/firehose\/aws4_request/,
  );
});
