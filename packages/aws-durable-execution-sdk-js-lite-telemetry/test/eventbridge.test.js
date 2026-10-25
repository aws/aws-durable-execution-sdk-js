import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { createEventBridgeExporter } from "../src/exporters/eventbridge.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

const record = buildRecord({
  arn: ARN,
  status: "FAILED",
  emittedAt: new Date("2026-03-04T05:06:07.250Z"),
  error: { ErrorType: "Boom", ErrorMessage: "bad" },
  operations: [
    { Id: "e", Type: "EXECUTION", Status: "STARTED", StartTimestamp: 1 },
    {
      Id: "1",
      Name: "charge",
      Type: "STEP",
      SubType: "Step",
      Status: "FAILED",
      StartTimestamp: 1,
      EndTimestamp: 2,
      StepDetails: { Attempt: 1 },
    },
  ],
});

const ok = () => ({ FailedEntryCount: 0, Entries: [{ EventId: "id" }] });

test("one PutEvents call publishes the record with the status as detail-type", async () => {
  const client = fakeClient(ok);
  const exporter = createEventBridgeExporter({ client });
  assert.equal(exporter.maxRecordBytes, 256_000);
  await exporter.export(record);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.path, "/");
  assert.deepEqual(request.headers, {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-target": "AWSEvents.PutEvents",
  });
  assert.equal(request.json.Entries.length, 1);
  const { Detail, ...entry } = request.json.Entries[0];
  assert.deepEqual(entry, {
    EventBusName: "default",
    Source: "software.amazon.lambda.durable.telemetry",
    DetailType: "FAILED",
    Time: Date.parse("2026-03-04T05:06:07.250Z") / 1000,
  });
  // The detail is the record itself, with the operations array.
  const detail = JSON.parse(Detail);
  assert.deepEqual(detail, JSON.parse(JSON.stringify(record)));
  assert.equal(detail.operations[0].name, "charge");
  assert.equal(detail.operationsByName, undefined);
});

test("eventBusName, source and maxRecordBytes options are used", async () => {
  const client = fakeClient(ok);
  const exporter = createEventBridgeExporter({
    eventBusName: "arn:aws:events:us-east-1:123456789012:event-bus/telemetry",
    source: "my.app",
    maxRecordBytes: 1000,
    client,
  });
  assert.equal(exporter.maxRecordBytes, 1000);
  await exporter.export(record);
  const [entry] = client.requests[0].json.Entries;
  assert.equal(
    entry.EventBusName,
    "arn:aws:events:us-east-1:123456789012:event-bus/telemetry",
  );
  assert.equal(entry.Source, "my.app");
});

test("a failed entry in a 200 response rejects with its error code and message", async () => {
  const client = fakeClient(() => ({
    FailedEntryCount: 1,
    Entries: [
      {
        ErrorCode: "InternalFailure",
        ErrorMessage: "Internal service error",
      },
    ],
  }));
  await assert.rejects(createEventBridgeExporter({ client }).export(record), {
    message:
      "EventBridge PutEvents failed: InternalFailure — Internal service error",
  });
});

test("an error of the client rejects unchanged", async () => {
  const error = Object.assign(new Error("not authorized"), {
    name: "AccessDeniedException",
    status: 400,
  });
  const client = fakeClient(() => {
    throw error;
  });
  await assert.rejects(
    createEventBridgeExporter({ client }).export(record),
    (err) => err === error,
  );
});

test("the built-in client sends a signed AWS JSON 1.1 request to EventBridge", async (t) => {
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
  const fetch = fakeFetch([json(200, ok())]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createEventBridgeExporter({ region: "eu-central-1" }).export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url.href, "https://events.eu-central-1.amazonaws.com/");
  assert.equal(call.headers["content-type"], "application/x-amz-json-1.1");
  assert.equal(call.headers["x-amz-target"], "AWSEvents.PutEvents");
  assert.equal(call.headers["x-amz-security-token"], "TOKEN");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/eu-central-1\/events\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(JSON.parse(call.body).Entries[0].DetailType, "FAILED");
});

test("the endpoint option reaches the built-in client", async (t) => {
  setAwsEnv(t, { AWS_ACCESS_KEY_ID: "AKID", AWS_SECRET_ACCESS_KEY: "SECRET" });
  const fetch = fakeFetch([json(200, ok())]);
  t.mock.method(globalThis, "fetch", fetch);
  await createEventBridgeExporter({
    region: "eu-west-1",
    endpoint: "http://localhost:4566",
  }).export(record);
  assert.equal(fetch.calls[0].url.href, "http://localhost:4566/");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/eu-west-1\/events\/aws4_request/,
  );
});

test("the exporter can be created without arguments", () => {
  const exporter = createEventBridgeExporter();
  assert.equal(typeof exporter.export, "function");
  assert.equal(exporter.maxRecordBytes, 256_000);
});
