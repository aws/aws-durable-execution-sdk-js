import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { createCloudWatchLogsExporter } from "../src/exporters/cloudwatch-logs.js";
import {
  buildOperationsByName,
  withOperationsByName,
} from "../src/operations-by-name.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

const target = (request) => request.headers["x-amz-target"];

const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  emittedAt: new Date("2026-03-04T05:06:07.000Z"),
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

test("CreateLogStream runs once per stream, then PutLogEvents writes one event", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-04T23:59:59.000Z"),
  });
  const client = fakeClient();
  const exporter = createCloudWatchLogsExporter({
    logGroupName: "telemetry",
    client,
  });
  assert.equal(exporter.maxRecordBytes, 256_000);
  await exporter.export(record);
  await exporter.export(record);
  assert.deepEqual(client.requests.map(target), [
    "Logs_20140328.CreateLogStream",
    "Logs_20140328.PutLogEvents",
    "Logs_20140328.PutLogEvents",
  ]);
  for (const request of client.requests) {
    assert.equal(request.path, "/");
    assert.equal(request.headers["content-type"], "application/x-amz-json-1.1");
  }
  assert.deepEqual(client.requests[0].json, {
    logGroupName: "telemetry",
    logStreamName: "durable-execution-telemetry/2026/03/04",
  });
  const put = client.requests[1].json;
  assert.equal(put.logGroupName, "telemetry");
  assert.equal(put.logStreamName, "durable-execution-telemetry/2026/03/04");
  assert.equal(put.logEvents.length, 1);
  assert.equal(
    put.logEvents[0].timestamp,
    Date.parse("2026-03-04T23:59:59.000Z"),
  );
  const message = JSON.parse(put.logEvents[0].message);
  assert.deepEqual(
    message,
    JSON.parse(JSON.stringify(withOperationsByName(record))),
  );
  assert.equal(message.operations, undefined);
  assert.deepEqual(message.operationsByName.charge, {
    type: "STEP",
    subType: "Step",
    count: 1,
    failedCount: 0,
    status: "SUCCEEDED",
    minDurationMs: 1000,
    maxDurationMs: 1000,
    totalDurationMs: 1000,
    maxAttempt: 1,
  });

  // A new UTC day uses a new stream.
  t.mock.timers.tick(1000);
  await exporter.export(record);
  assert.equal(target(client.requests[3]), "Logs_20140328.CreateLogStream");
  assert.equal(
    client.requests[3].json.logStreamName,
    "durable-execution-telemetry/2026/03/05",
  );
});

test("ResourceAlreadyExistsException is ignored; the stream is not created again", async () => {
  const client = fakeClient((request) => {
    if (target(request) === "Logs_20140328.CreateLogStream") {
      throw Object.assign(new Error("exists"), {
        name: "ResourceAlreadyExistsException",
      });
    }
    return {};
  });
  const exporter = createCloudWatchLogsExporter({
    logGroupName: "g",
    logStreamPrefix: "p/",
    client,
    maxRecordBytes: 1000,
  });
  assert.equal(exporter.maxRecordBytes, 1000);
  await exporter.export(record);
  await exporter.export(record);
  assert.deepEqual(client.requests.map(target), [
    "Logs_20140328.CreateLogStream",
    "Logs_20140328.PutLogEvents",
    "Logs_20140328.PutLogEvents",
  ]);
  assert.match(
    client.requests[1].json.logStreamName,
    /^p\/\d{4}\/\d{2}\/\d{2}$/,
  );
});

test("another CreateLogStream error rejects, and the next export tries again", async () => {
  let fail = true;
  const client = fakeClient((request) => {
    if (target(request) === "Logs_20140328.CreateLogStream" && fail) {
      throw Object.assign(new Error("denied"), {
        name: "AccessDeniedException",
      });
    }
    return {};
  });
  const exporter = createCloudWatchLogsExporter({ logGroupName: "g", client });
  await assert.rejects(exporter.export(record), {
    name: "AccessDeniedException",
  });
  fail = false;
  await exporter.export(record);
  assert.deepEqual(client.requests.map(target), [
    "Logs_20140328.CreateLogStream",
    "Logs_20140328.CreateLogStream",
    "Logs_20140328.PutLogEvents",
  ]);
});

test("the built-in client sends signed AWS JSON 1.1 requests to CloudWatch Logs", async (t) => {
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
  const fetch = fakeFetch([
    json(
      400,
      {
        __type: "com.amazonaws.logs#ResourceAlreadyExistsException",
        message: "The specified log stream already exists",
      },
      { "x-amzn-requestid": "rid" },
    ),
    json(200, { nextSequenceToken: "n" }),
  ]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  const exporter = createCloudWatchLogsExporter({
    logGroupName: "/durable/telemetry",
    region: "eu-central-1",
  });
  await exporter.export(record);
  assert.equal(fetch.calls.length, 2);
  const [create, put] = fetch.calls;
  for (const call of fetch.calls) {
    assert.equal(call.method, "POST");
    assert.equal(call.url.href, "https://logs.eu-central-1.amazonaws.com/");
    assert.equal(call.headers["content-type"], "application/x-amz-json-1.1");
    assert.equal(call.headers["x-amz-date"], "20260304T050607Z");
    assert.equal(call.headers["x-amz-security-token"], "TOKEN");
    assert.match(
      call.headers.authorization,
      /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/eu-central-1\/logs\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
    );
  }
  assert.equal(create.headers["x-amz-target"], "Logs_20140328.CreateLogStream");
  assert.deepEqual(JSON.parse(create.body), {
    logGroupName: "/durable/telemetry",
    logStreamName: "durable-execution-telemetry/2026/03/04",
  });
  assert.equal(put.headers["x-amz-target"], "Logs_20140328.PutLogEvents");
  assert.equal(JSON.parse(put.body).logEvents[0].timestamp, Date.now());
});

test("the exporter can be created without a client", () => {
  const exporter = createCloudWatchLogsExporter({ logGroupName: "g" });
  assert.equal(typeof exporter.export, "function");
});

test("operationsByName aggregates repeated names and drops their error", () => {
  const byName = buildOperationsByName([
    {
      name: "poll",
      type: "STEP",
      subType: "Step",
      status: "FAILED",
      durationMs: 30,
      attempt: 2,
      error: { name: "E", message: "m" },
    },
    { name: "poll", type: "STEP", status: "SUCCEEDED", durationMs: 10 },
    {
      name: "poll",
      type: "STEP",
      status: "SUCCEEDED",
      durationMs: 20,
      attempt: 1,
    },
    { name: "once", type: "WAIT", status: "STARTED" },
    {
      name: "fail",
      type: "STEP",
      status: "FAILED",
      error: { name: "X", message: "y" },
    },
    { type: "STEP", status: "SUCCEEDED" },
  ]);
  assert.deepEqual(Object.keys(byName), ["poll", "once", "fail"]);
  assert.deepEqual(byName.poll, {
    type: "STEP",
    count: 3,
    failedCount: 1,
    status: "SUCCEEDED",
    minDurationMs: 10,
    maxDurationMs: 30,
    totalDurationMs: 60,
    maxAttempt: 2,
  });
  assert.deepEqual(byName.once, {
    type: "WAIT",
    count: 1,
    failedCount: 0,
    status: "STARTED",
  });
  assert.deepEqual(byName.fail.error, { name: "X", message: "y" });
});

test("operationsByName fills durations and attempts first seen on a repeat", () => {
  const byName = buildOperationsByName([
    { name: "a", type: "STEP", status: "STARTED" },
    {
      name: "a",
      type: "STEP",
      subType: "Step",
      status: "SUCCEEDED",
      durationMs: 5,
      attempt: 3,
    },
  ]);
  assert.deepEqual(byName.a, {
    type: "STEP",
    subType: "Step",
    count: 2,
    failedCount: 0,
    status: "SUCCEEDED",
    minDurationMs: 5,
    maxDurationMs: 5,
    totalDurationMs: 5,
    maxAttempt: 3,
  });
});

test("an operation named __proto__ becomes an own key", () => {
  const byName = buildOperationsByName([
    { name: "__proto__", type: "STEP", status: "SUCCEEDED" },
  ]);
  assert.equal(Object.getPrototypeOf(byName), Object.prototype);
  assert.ok(Object.hasOwn(byName, "__proto__"));
  assert.match(JSON.stringify(byName), /"__proto__":\{"type":"STEP"/);
});
