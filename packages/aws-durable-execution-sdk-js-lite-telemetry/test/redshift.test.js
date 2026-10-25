import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import {
  createRedshiftExporter,
  createTableSql,
} from "../src/exporters/redshift.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

const STATEMENT = { Id: "d9b6c0c9-0747-4bf4-b142-e8883122f766" };

const ended = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  emittedAt: new Date("2026-01-01T00:00:02.500Z"),
  output: { ok: true },
});

// No execution name in the ARN, and no end: the three nullable fields are absent.
const running = buildRecord({
  arn: "arn:aws:lambda:us-east-1:1:function:f:1",
  status: "RUNNING",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  emittedAt: new Date("2026-01-01T00:00:01.000Z"),
});

const values = (request) =>
  Object.fromEntries(request.json.Parameters.map((p) => [p.name, p.value]));

const T = "public.durable_execution_telemetry";
const guarded = (column) =>
  `${column} = CASE WHEN ${T}.emitted_at <= src.emitted_at THEN src.${column} ELSE ${T}.${column} END`;

test("one ExecuteStatement merges the record into a Serverless workgroup", async () => {
  const client = fakeClient(() => STATEMENT);
  const exporter = createRedshiftExporter({
    workgroupName: "telemetry-wg",
    database: "telemetry",
    client,
  });
  assert.equal(exporter.maxRecordBytes, 1_000_000);
  await exporter.export(ended);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.path, "/");
  assert.equal(request.method, undefined);
  assert.deepEqual(request.headers, {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-target": "RedshiftData.ExecuteStatement",
  });
  const { Sql, Parameters, ...target } = request.json;
  // No ClusterIdentifier, DbUser or SecretArn keys.
  assert.deepEqual(target, {
    WorkgroupName: "telemetry-wg",
    Database: "telemetry",
  });
  assert.equal(
    Sql,
    `MERGE INTO ${T} USING (
  SELECT
    :execution_arn::varchar AS execution_arn,
    :execution_name::varchar AS execution_name,
    :function_name::varchar AS function_name,
    :status::varchar AS status,
    :start_time::timestamptz AS start_time,
    :end_time::timestamptz AS end_time,
    :duration_ms::bigint AS duration_ms,
    JSON_PARSE(:record_json) AS record_json,
    :emitted_at::timestamptz AS emitted_at
) AS src
ON ${T}.execution_arn = src.execution_arn
WHEN MATCHED THEN UPDATE SET
  ${guarded("status")},
  ${guarded("end_time")},
  ${guarded("duration_ms")},
  ${guarded("record_json")},
  ${guarded("emitted_at")}
WHEN NOT MATCHED THEN INSERT
  (execution_arn, execution_name, function_name, status, start_time, end_time, duration_ms, record_json, emitted_at)
VALUES
  (src.execution_arn, src.execution_name, src.function_name, src.status, src.start_time, src.end_time, src.duration_ms, src.record_json, src.emitted_at)`,
  );
  // Every value is a string, as the Data API requires.
  assert.deepEqual(Parameters, [
    { name: "execution_arn", value: ARN },
    { name: "execution_name", value: "local" },
    { name: "function_name", value: "workflow" },
    { name: "status", value: "SUCCEEDED" },
    { name: "start_time", value: "2026-01-01T00:00:00.000Z" },
    { name: "end_time", value: "2026-01-01T00:00:02.500Z" },
    { name: "duration_ms", value: "2500" },
    { name: "record_json", value: JSON.stringify(ended) },
    { name: "emitted_at", value: "2026-01-01T00:00:02.500Z" },
  ]);
});

test("a provisioned cluster sends ClusterIdentifier with DbUser or SecretArn", async () => {
  const client = fakeClient(() => STATEMENT);
  await createRedshiftExporter({
    clusterIdentifier: "telemetry-cluster",
    dbUser: "telemetry_writer",
    database: "telemetry",
    client,
  }).export(ended);
  await createRedshiftExporter({
    clusterIdentifier: "telemetry-cluster",
    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:rs",
    database: "telemetry",
    client,
  }).export(ended);
  const targets = client.requests.map(
    ({ json: { Sql, Parameters, ...t } }) => t,
  );
  assert.deepEqual(targets, [
    {
      ClusterIdentifier: "telemetry-cluster",
      DbUser: "telemetry_writer",
      Database: "telemetry",
    },
    {
      ClusterIdentifier: "telemetry-cluster",
      SecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:rs",
      Database: "telemetry",
    },
  ]);
});

test("absent fields are NULL literals in the SQL, not parameters", async () => {
  const client = fakeClient(() => STATEMENT);
  await createRedshiftExporter({
    workgroupName: "wg",
    database: "d",
    client,
  }).export(running);
  const [request] = client.requests;
  assert.match(request.json.Sql, /\n {4}NULL::varchar AS execution_name,\n/);
  assert.match(request.json.Sql, /\n {4}NULL::timestamptz AS end_time,\n/);
  assert.match(request.json.Sql, /\n {4}NULL::bigint AS duration_ms,\n/);
  assert.doesNotMatch(
    request.json.Sql,
    /:(execution_name|end_time|duration_ms)/,
  );
  assert.deepEqual(values(request), {
    execution_arn: "arn:aws:lambda:us-east-1:1:function:f:1",
    function_name: "f",
    status: "RUNNING",
    start_time: "2026-01-01T00:00:00.000Z",
    record_json: JSON.stringify(running),
    emitted_at: "2026-01-01T00:00:01.000Z",
  });
});

test("a durationMs of 0 is a parameter", async () => {
  const client = fakeClient(() => STATEMENT);
  const instant = buildRecord({
    arn: ARN,
    status: "SUCCEEDED",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    emittedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(instant.durationMs, 0);
  await createRedshiftExporter({
    workgroupName: "wg",
    database: "d",
    client,
  }).export(instant);
  assert.equal(values(client.requests[0]).duration_ms, "0");
  assert.match(client.requests[0].json.Sql, /:duration_ms::bigint/);
});

test("a custom schema and table appear in the SQL", async () => {
  const client = fakeClient(() => STATEMENT);
  const exporter = createRedshiftExporter({
    workgroupName: "wg",
    database: "d",
    schema: "Telemetry_2",
    table: "Runs_2",
    maxRecordBytes: 5,
    client,
  });
  assert.equal(exporter.maxRecordBytes, 5);
  await exporter.export(ended);
  const { Sql } = client.requests[0].json;
  assert.match(Sql, /^MERGE INTO Telemetry_2\.Runs_2 USING \(/);
  assert.match(
    Sql,
    /\nON Telemetry_2\.Runs_2\.execution_arn = src\.execution_arn\n/,
  );
  assert.match(
    Sql,
    / {2}status = CASE WHEN Telemetry_2\.Runs_2\.emitted_at <= src\.emitted_at THEN src\.status ELSE Telemetry_2\.Runs_2\.status END,\n/,
  );
  assert.doesNotMatch(Sql, /public|durable_execution_telemetry/);
});

test("an invalid schema or table name throws when the exporter is created", () => {
  const create = (names) =>
    createRedshiftExporter({
      workgroupName: "wg",
      database: "d",
      client: fakeClient(),
      ...names,
    });
  for (const name of ["2fast", "a-b", "t; DROP TABLE x", "", "a.b"]) {
    const message = new RegExp(`"${name.replace(/[.;]/g, "\\$&")}"`);
    assert.throws(() => create({ table: name }), {
      message: new RegExp(`^Invalid table name ${message.source}`),
    });
    assert.throws(() => create({ schema: name }), {
      message: new RegExp(`^Invalid schema name ${message.source}`),
    });
    assert.throws(() => createTableSql({ table: name }), /Invalid table name/);
    assert.throws(
      () => createTableSql({ schema: name }),
      /Invalid schema name/,
    );
  }
});

test("a client error rejects the export", async () => {
  const client = fakeClient(() => {
    throw Object.assign(new Error("workgroup not found"), {
      name: "ResourceNotFoundException",
      status: 400,
    });
  });
  await assert.rejects(
    createRedshiftExporter({
      workgroupName: "wg",
      database: "d",
      client,
    }).export(ended),
    { name: "ResourceNotFoundException", status: 400 },
  );
});

test("the built-in client sends a signed AWS JSON 1.1 ExecuteStatement", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-04T05:06:07.000Z"),
  });
  const fetch = fakeFetch([json(200, STATEMENT)]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createRedshiftExporter({
    workgroupName: "telemetry-wg",
    database: "telemetry",
    region: "eu-central-1",
  }).export(ended);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "POST");
  assert.equal(
    call.url.href,
    "https://redshift-data.eu-central-1.amazonaws.com/",
  );
  assert.equal(call.headers["content-type"], "application/x-amz-json-1.1");
  assert.equal(call.headers["x-amz-target"], "RedshiftData.ExecuteStatement");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/eu-central-1\/redshift-data\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
  );
  const body = JSON.parse(call.body);
  assert.equal(body.WorkgroupName, "telemetry-wg");
  assert.match(body.Sql, /^MERGE INTO public\.durable_execution_telemetry /);
  assert.equal(body.Parameters.length, 9);
});

test("the endpoint option reaches the built-in client", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([json(200, STATEMENT)]);
  t.mock.method(globalThis, "fetch", fetch);
  await createRedshiftExporter({
    workgroupName: "wg",
    database: "d",
    endpoint: "http://localhost:4566",
  }).export(ended);
  assert.equal(fetch.calls[0].url.href, "http://localhost:4566/");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/us-west-2\/redshift-data\/aws4_request/,
  );
});

test("createTableSql has the full SDK's schema with a SUPER record_json", () => {
  assert.equal(
    createTableSql(),
    `CREATE TABLE IF NOT EXISTS public.durable_execution_telemetry (
  execution_arn VARCHAR(512) PRIMARY KEY,
  execution_name VARCHAR(256),
  function_name VARCHAR(128),
  status VARCHAR(20),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  record_json SUPER,
  emitted_at TIMESTAMPTZ
)`,
  );
  assert.match(
    createTableSql({ schema: "analytics", table: "runs" }),
    /^CREATE TABLE IF NOT EXISTS analytics\.runs \(/,
  );
  assert.match(
    createTableSql({ table: "runs" }),
    /^CREATE TABLE IF NOT EXISTS public\.runs \(/,
  );
});
