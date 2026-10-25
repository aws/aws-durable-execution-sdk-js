import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import {
  createAuroraExporter,
  createTableSql,
} from "../src/exporters/aurora.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

const config = (client, extra = {}) => ({
  resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:telemetry",
  secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:db",
  database: "telemetry",
  client,
  ...extra,
});

const ended = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  emittedAt: new Date("2026-01-01T00:00:02.500Z"),
  output: { ok: true },
});

test("one ExecuteStatement upserts the record with named parameters", async () => {
  const client = fakeClient();
  const exporter = createAuroraExporter(config(client));
  assert.equal(exporter.maxRecordBytes, 1_000_000);
  await exporter.export(ended);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.path, "/Execute");
  assert.deepEqual(request.headers, { "content-type": "application/json" });
  const { sql, parameters, ...target } = request.json;
  assert.deepEqual(target, {
    resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:telemetry",
    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:db",
    database: "telemetry",
  });
  assert.match(sql, /^INSERT INTO durable_execution_telemetry\n/);
  assert.match(sql, /ON CONFLICT \(execution_arn\) DO UPDATE SET/);
  assert.match(
    sql,
    /\nWHERE durable_execution_telemetry\.emitted_at <= EXCLUDED\.emitted_at$/,
  );
  assert.match(sql, /:record_json::jsonb/);
  assert.deepEqual(parameters, [
    { name: "execution_arn", value: { stringValue: ARN } },
    { name: "execution_name", value: { stringValue: "local" } },
    { name: "function_name", value: { stringValue: "workflow" } },
    { name: "status", value: { stringValue: "SUCCEEDED" } },
    { name: "start_time", value: { stringValue: "2026-01-01T00:00:00.000Z" } },
    { name: "end_time", value: { stringValue: "2026-01-01T00:00:02.500Z" } },
    { name: "duration_ms", value: { longValue: 2500 } },
    { name: "record_json", value: { stringValue: JSON.stringify(ended) } },
    { name: "emitted_at", value: { stringValue: "2026-01-01T00:00:02.500Z" } },
  ]);
});

test("missing fields are sent as isNull", async () => {
  const client = fakeClient();
  const running = buildRecord({
    arn: "arn:aws:lambda:us-east-1:1:function:f:1",
    status: "RUNNING",
  });
  await createAuroraExporter(config(client)).export(running);
  const values = Object.fromEntries(
    client.requests[0].json.parameters.map((p) => [p.name, p.value]),
  );
  assert.deepEqual(values.execution_name, { isNull: true });
  assert.deepEqual(values.end_time, { isNull: true });
  assert.deepEqual(values.duration_ms, { isNull: true });
  assert.deepEqual(values.status, { stringValue: "RUNNING" });
});

test("a custom table name appears in the SQL", async () => {
  const client = fakeClient();
  await createAuroraExporter(
    config(client, { table: "My_Table_2", maxRecordBytes: 5 }),
  ).export(ended);
  const { sql } = client.requests[0].json;
  assert.match(sql, /^INSERT INTO My_Table_2\n/);
  assert.match(sql, /WHERE My_Table_2\.emitted_at <= EXCLUDED\.emitted_at$/);
});

test("an invalid table name throws when the exporter is created", () => {
  for (const table of ["2fast", "a-b", "t; DROP TABLE x", "", "a.b"]) {
    assert.throws(() => createAuroraExporter(config(fakeClient(), { table })), {
      message: new RegExp(
        `Invalid table name "${table.replace(/[.;]/g, "\\$&")}"`,
      ),
    });
    assert.throws(() => createTableSql(table), /Invalid table name/);
  }
});

test("a client error rejects the export", async () => {
  const client = fakeClient(() => {
    throw Object.assign(new Error("resuming"), {
      name: "DatabaseResumingException",
    });
  });
  await assert.rejects(createAuroraExporter(config(client)).export(ended), {
    name: "DatabaseResumingException",
  });
});

test("the built-in client sends a signed POST /Execute to the RDS Data API", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([
    json(500, { message: "internal" }),
    json(200, { numberOfRecordsUpdated: 1 }),
  ]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createAuroraExporter(config(undefined)).export(ended);
  // The 500 is retried.
  assert.equal(fetch.calls.length, 2);
  const call = fetch.calls[1];
  assert.equal(call.method, "POST");
  assert.equal(
    call.url.href,
    "https://rds-data.us-west-2.amazonaws.com/Execute",
  );
  assert.equal(call.headers["content-type"], "application/json");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-west-2\/rds-data\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  const body = JSON.parse(call.body);
  assert.equal(body.resourceArn, config().resourceArn);
  assert.equal(body.database, "telemetry");
  assert.match(body.sql, /^INSERT INTO durable_execution_telemetry\n/);
  assert.equal(body.parameters.length, 9);
});

test("region and endpoint options reach the built-in client", async (t) => {
  setAwsEnv(t, { AWS_ACCESS_KEY_ID: "AKID", AWS_SECRET_ACCESS_KEY: "SECRET" });
  const fetch = fakeFetch([json(200, {})]);
  t.mock.method(globalThis, "fetch", fetch);
  await createAuroraExporter(
    config(undefined, {
      region: "eu-west-1",
      endpoint: "http://localhost:4566",
    }),
  ).export(ended);
  assert.equal(fetch.calls[0].url.href, "http://localhost:4566/Execute");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/eu-west-1\/rds-data\/aws4_request/,
  );
});

test("createTableSql has the full SDK's schema", () => {
  assert.equal(
    createTableSql(),
    `CREATE TABLE IF NOT EXISTS durable_execution_telemetry (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json JSONB,
  emitted_at TIMESTAMPTZ
)`,
  );
  assert.match(createTableSql("runs"), /^CREATE TABLE IF NOT EXISTS runs \(/);
});

test("the exporter can be created without a client", () => {
  const exporter = createAuroraExporter({
    resourceArn: "r",
    secretArn: "s",
    database: "d",
  });
  assert.equal(typeof exporter.export, "function");
});
