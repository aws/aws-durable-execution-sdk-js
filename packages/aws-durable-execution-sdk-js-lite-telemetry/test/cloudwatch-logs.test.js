import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { createCloudWatchLogsExporter } from "../src/exporters/cloudwatch-logs.js";
import {
  buildOperationsByName,
  withOperationsByName,
} from "../src/operations-by-name.js";
import { ARN, fakeClient } from "./helpers.js";

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
  assert.deepEqual(
    client.commands.map((c) => c.constructor.name),
    ["CreateLogStreamCommand", "PutLogEventsCommand", "PutLogEventsCommand"],
  );
  assert.deepEqual(client.commands[0].input, {
    logGroupName: "telemetry",
    logStreamName: "durable-execution-telemetry/2026/03/04",
  });
  const put = client.commands[1].input;
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
  assert.equal(client.commands[3].constructor.name, "CreateLogStreamCommand");
  assert.equal(
    client.commands[3].input.logStreamName,
    "durable-execution-telemetry/2026/03/05",
  );
});

test("ResourceAlreadyExistsException is ignored; the stream is not created again", async () => {
  const client = fakeClient((command) => {
    if (command.constructor.name === "CreateLogStreamCommand") {
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
  assert.deepEqual(
    client.commands.map((c) => c.constructor.name),
    ["CreateLogStreamCommand", "PutLogEventsCommand", "PutLogEventsCommand"],
  );
  assert.match(
    client.commands[1].input.logStreamName,
    /^p\/\d{4}\/\d{2}\/\d{2}$/,
  );
});

test("another CreateLogStream error rejects, and the next export tries again", async () => {
  let fail = true;
  const client = fakeClient((command) => {
    if (command.constructor.name === "CreateLogStreamCommand" && fail) {
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
  assert.deepEqual(
    client.commands.map((c) => c.constructor.name),
    ["CreateLogStreamCommand", "CreateLogStreamCommand", "PutLogEventsCommand"],
  );
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
