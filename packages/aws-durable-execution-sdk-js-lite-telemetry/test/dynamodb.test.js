import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord, createTelemetryPlugin } from "../src/index.js";
import { createDynamoDBExporter } from "../src/exporters/dynamodb.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  runDurable,
  setAwsEnv,
} from "./helpers.js";

const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  startTime: new Date("2026-03-04T05:06:05.000Z"),
  emittedAt: new Date("2026-03-04T05:06:07.000Z"),
  input: { orderId: "o-1" },
  output: { ok: true },
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

// A record with the given input. The input holds the values to marshall.
const withInput = (input) => ({ ...record, input });

test("one PutItem writes the record keyed by executionArn and emittedAt", async () => {
  const client = fakeClient();
  const exporter = createDynamoDBExporter({ tableName: "telemetry", client });
  assert.equal(exporter.maxRecordBytes, 400_000);
  await exporter.export(record);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.method, undefined);
  assert.equal(request.path, "/");
  assert.deepEqual(request.headers, {
    "content-type": "application/x-amz-json-1.0",
    "x-amz-target": "DynamoDB_20120810.PutItem",
  });
  assert.deepEqual(request.json, {
    TableName: "telemetry",
    Item: {
      recordType: { S: "DurableExecutionTelemetry" },
      schemaVersion: { S: "1.0" },
      emittedAt: { S: "2026-03-04T05:06:07.000Z" },
      executionArn: { S: ARN },
      executionName: { S: "local" },
      functionName: { S: "workflow" },
      functionQualifier: { S: "$LATEST" },
      region: { S: "us-east-1" },
      accountId: { S: "123456789012" },
      status: { S: "SUCCEEDED" },
      startTime: { S: "2026-03-04T05:06:05.000Z" },
      endTime: { S: "2026-03-04T05:06:07.000Z" },
      durationMs: { N: "2000" },
      input: { M: { orderId: { S: "o-1" } } },
      output: { M: { ok: { BOOL: true } } },
      operationsByName: {
        M: {
          charge: {
            M: {
              type: { S: "STEP" },
              count: { N: "1" },
              failedCount: { N: "0" },
              status: { S: "SUCCEEDED" },
              subType: { S: "Step" },
              minDurationMs: { N: "1000" },
              maxDurationMs: { N: "1000" },
              totalDurationMs: { N: "1000" },
              maxAttempt: { N: "1" },
            },
          },
        },
      },
      pk: { S: ARN },
      sk: { S: "2026-03-04T05:06:07.000Z" },
    },
  });
});

test("every JSON type is marshalled, also nested", async () => {
  const client = fakeClient();
  await createDynamoDBExporter({ tableName: "t", client }).export(
    withInput({
      s: "text",
      empty: "",
      n: -1.5,
      big: 1e21,
      t: true,
      f: false,
      nil: null,
      list: [1, "a", [false], { k: null }],
      map: { a: { b: { c: "d" } } },
      emptyList: [],
      emptyMap: {},
    }),
  );
  assert.deepEqual(client.requests[0].json.Item.input, {
    M: {
      s: { S: "text" },
      empty: { S: "" },
      n: { N: "-1.5" },
      big: { N: "1e+21" },
      t: { BOOL: true },
      f: { BOOL: false },
      nil: { NULL: true },
      list: {
        L: [
          { N: "1" },
          { S: "a" },
          { L: [{ BOOL: false }] },
          { M: { k: { NULL: true } } },
        ],
      },
      map: { M: { a: { M: { b: { M: { c: { S: "d" } } } } } } },
      emptyList: { L: [] },
      emptyMap: { M: {} },
    },
  });
});

test("values without a JSON form get the JSON value that the other exporters store", async () => {
  const client = fakeClient();
  await createDynamoDBExporter({ tableName: "t", client }).export(
    withInput({
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      negInf: Number.NEGATIVE_INFINITY,
      skipped: undefined,
      list: [undefined, Number.NaN],
      date: new Date("2026-01-02T03:04:05.000Z"),
    }),
  );
  const { Item } = client.requests[0].json;
  assert.deepEqual(Item.input, {
    M: {
      nan: { NULL: true },
      inf: { NULL: true },
      negInf: { NULL: true },
      list: { L: [{ NULL: true }, { NULL: true }] },
      date: { S: "2026-01-02T03:04:05.000Z" },
    },
  });
  // Undefined top-level fields are absent too. A RUNNING record has no endTime.
  const running = buildRecord({ arn: ARN, status: "RUNNING" });
  await createDynamoDBExporter({ tableName: "t", client }).export(running);
  const item = client.requests[1].json.Item;
  for (const field of ["endTime", "durationMs", "input", "output", "error"]) {
    assert.equal(Object.hasOwn(item, field), false, field);
  }
});

test("an operation named __proto__ stays a key of the map", async () => {
  const client = fakeClient();
  await createDynamoDBExporter({ tableName: "t", client }).export({
    ...record,
    operations: [{ name: "__proto__", type: "STEP", status: "SUCCEEDED" }],
  });
  assert.match(
    client.requests[0].body,
    /"operationsByName":\{"M":\{"__proto__":\{"M":\{"type":\{"S":"STEP"\}/,
  );
});

test("custom key names hold the keys; sortKey '' writes no sort key", async () => {
  const client = fakeClient();
  const exporter = createDynamoDBExporter({
    tableName: "t",
    partitionKey: "executionId",
    sortKey: "at",
    client,
    maxRecordBytes: 1000,
  });
  assert.equal(exporter.maxRecordBytes, 1000);
  await exporter.export(record);
  const { Item } = client.requests[0].json;
  assert.deepEqual(Item.executionId, { S: ARN });
  assert.deepEqual(Item.at, { S: "2026-03-04T05:06:07.000Z" });
  assert.equal(Item.pk, undefined);
  assert.equal(Item.sk, undefined);

  await createDynamoDBExporter({ tableName: "t", sortKey: "", client }).export(
    record,
  );
  const upsert = client.requests[1].json.Item;
  assert.deepEqual(upsert.pk, { S: ARN });
  assert.equal(Object.hasOwn(upsert, "sk"), false);
  assert.equal(Object.hasOwn(upsert, ""), false);
});

test("a client error rejects the export", async () => {
  const client = fakeClient(() => {
    throw Object.assign(new Error("Requested resource not found"), {
      name: "ResourceNotFoundException",
    });
  });
  await assert.rejects(
    createDynamoDBExporter({ tableName: "t", client }).export(record),
    { name: "ResourceNotFoundException" },
  );
});

test("the plugin sends the record of a run to the exporter", async () => {
  const client = fakeClient();
  const plugin = createTelemetryPlugin({
    exporters: [createDynamoDBExporter({ tableName: "t", client })],
  });
  const result = await runDurable({
    workflow: async ({ ctx }) => ctx.step({ name: "a", fn: () => 7 }),
    plugins: [plugin],
    input: { n: 1 },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(client.requests.length, 1);
  const { Item } = client.requests[0].json;
  assert.deepEqual(Item.pk, { S: ARN });
  assert.deepEqual(Item.sk, Item.emittedAt);
  assert.deepEqual(Item.status, { S: "SUCCEEDED" });
  assert.deepEqual(Item.input, { M: { n: { N: "1" } } });
  assert.deepEqual(Item.output, { N: "7" });
  assert.deepEqual(Item.operationsByName.M.a.M.status, { S: "SUCCEEDED" });
});

test("the built-in client sends a signed AWS JSON 1.0 PutItem to DynamoDB", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-04T05:06:07.000Z"),
  });
  const fetch = fakeFetch([json(200, {})]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createDynamoDBExporter({ tableName: "telemetry" }).export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url.href, "https://dynamodb.us-west-2.amazonaws.com/");
  assert.equal(call.headers["content-type"], "application/x-amz-json-1.0");
  assert.equal(call.headers["x-amz-target"], "DynamoDB_20120810.PutItem");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/us-west-2\/dynamodb\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
  );
  const body = JSON.parse(call.body);
  assert.equal(body.TableName, "telemetry");
  assert.deepEqual(body.Item.pk, { S: ARN });
});

test("region and endpoint options reach the built-in client", async (t) => {
  setAwsEnv(t, { AWS_ACCESS_KEY_ID: "AKID", AWS_SECRET_ACCESS_KEY: "SECRET" });
  const fetch = fakeFetch([json(200, {})]);
  t.mock.method(globalThis, "fetch", fetch);
  await createDynamoDBExporter({
    tableName: "t",
    region: "eu-west-1",
    endpoint: "http://localhost:8000",
  }).export(record);
  assert.equal(fetch.calls[0].url.href, "http://localhost:8000/");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/eu-west-1\/dynamodb\/aws4_request/,
  );
});
