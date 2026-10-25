import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import {
  createAuroraExporter,
  createTableSql,
} from "../src/exporters/aurora.js";
import { ARN, fakeClient } from "./helpers.js";

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
  assert.equal(client.commands.length, 1);
  const [command] = client.commands;
  assert.equal(command.constructor.name, "ExecuteStatementCommand");
  const { sql, parameters, ...target } = command.input;
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
    client.commands[0].input.parameters.map((p) => [p.name, p.value]),
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
  const { sql } = client.commands[0].input;
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
