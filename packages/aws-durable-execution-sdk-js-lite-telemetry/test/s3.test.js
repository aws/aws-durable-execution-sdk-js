import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createS3Exporter } from "../src/exporters/s3.js";
import { buildRecord } from "../src/index.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

// The execution started on 2026-03-04 UTC. The record was built a day later. So a key
// with day=04 proves that the date partition uses startTime, not emittedAt.
const record = buildRecord({
  arn: ARN,
  status: "SUCCEEDED",
  startTime: new Date("2026-03-04T23:59:59.000Z"),
  emittedAt: new Date("2026-03-05T00:00:10.000Z"),
  input: { city: "Zürich" },
  operations: [
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

// The ARN of the helpers ends with /durable-execution/local/run. So the execution name,
// and the file name, is "local".
const pathFor = async (config, r = record) => {
  const client = fakeClient();
  await createS3Exporter({ bucket: "b", client, ...config }).export(r);
  return client.requests[0].path;
};

test("the default key is prefix, UTC start date and execution name; the body is the record", async () => {
  const client = fakeClient();
  const exporter = createS3Exporter({ bucket: "b", client });
  assert.equal(exporter.maxRecordBytes, 5_000_000);
  await exporter.export(record);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.method, "PUT");
  // The key is durable-execution-telemetry/year=2026/month=03/day=04/local.json. RFC
  // 3986 encodes "=" as %3D.
  assert.equal(
    request.path,
    "/durable-execution-telemetry/year%3D2026/month%3D03/day%3D04/local.json",
  );
  assert.deepEqual(request.headers, { "content-type": "application/json" });
  // The record as is, with the operations array, without a trailing newline.
  assert.equal(request.body, JSON.stringify(record));
  assert.equal(request.json.operations[0].name, "charge");
});

test("function-name partitioning puts the sanitized function name in the key", async () => {
  assert.equal(
    await pathFor({ partitioning: "function-name", keyPrefix: "wi/" }),
    "/wi/function%3Dworkflow/local.json",
  );
  // A function name never holds other characters. The full SDK sanitizes it anyway.
  assert.equal(
    await pathFor(
      { partitioning: "function-name" },
      { ...record, functionName: "a:b c" },
    ),
    "/durable-execution-telemetry/function%3Da_b_c/local.json",
  );
});

test("none partitioning writes the object directly under the prefix", async () => {
  assert.equal(
    await pathFor({ partitioning: "none" }),
    "/durable-execution-telemetry/local.json",
  );
});

test("without an execution name, the file name is the ARN with every : / and $ as _", async () => {
  const arn = "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST";
  const noName = buildRecord({
    arn,
    status: "RUNNING",
    startTime: new Date("2026-03-04T00:00:00.000Z"),
  });
  assert.equal(noName.executionName, undefined);
  assert.equal(
    await pathFor({ partitioning: "none" }, noName),
    "/durable-execution-telemetry/arn_aws_lambda_us-east-1_123456789012_function_workflow__LATEST.json",
  );
});

test("each key segment is encoded with RFC 3986, including !'()*", async () => {
  assert.equal(
    await pathFor({ partitioning: "none", keyPrefix: "team a/(v1)!*'/%/" }),
    "/team%20a/%28v1%29%21%2A%27/%25/local.json",
  );
});

test("the built-in client sends a signed PUT to the virtual-hosted bucket endpoint", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
    AWS_SESSION_TOKEN: "TOKEN",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-05T00:00:10.000Z"),
  });
  // S3 answers a successful PutObject with an empty body.
  const fetch = fakeFetch([json(200)]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createS3Exporter({
    bucket: "telemetry",
    region: "eu-central-1",
  }).export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "PUT");
  assert.equal(call.url.host, "telemetry.s3.eu-central-1.amazonaws.com");
  assert.equal(
    call.url.pathname,
    "/durable-execution-telemetry/year%3D2026/month%3D03/day%3D04/local.json",
  );
  assert.equal(call.body, JSON.stringify(record));
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(
    call.headers["x-amz-content-sha256"],
    createHash("sha256").update(call.body).digest("hex"),
  );
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260305\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
  );
});

test("without region, the default endpoint and the signature use AWS_REGION", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([json(200)]);
  t.mock.method(globalThis, "fetch", fetch);
  await createS3Exporter({ bucket: "telemetry" }).export(record);
  assert.equal(fetch.calls[0].url.host, "telemetry.s3.us-west-2.amazonaws.com");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/us-west-2\/s3\/aws4_request/,
  );
});

test("a dotted bucket uses a path-style endpoint with the bucket in keyPrefix", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([json(200)]);
  t.mock.method(globalThis, "fetch", fetch);
  await createS3Exporter({
    bucket: "my.bucket",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    keyPrefix: "my.bucket/durable-execution-telemetry/",
    partitioning: "none",
  }).export(record);
  assert.equal(
    fetch.calls[0].url.href,
    "https://s3.us-east-1.amazonaws.com/my.bucket/durable-execution-telemetry/local.json",
  );
});

test("an S3 error response rejects the export with its status", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  // S3 errors are XML. The client parses only JSON. So the error has the status and the
  // status text, and the name UnknownError.
  const fetch = fakeFetch([
    new Response("<Error><Code>AccessDenied</Code></Error>", {
      status: 403,
      statusText: "Forbidden",
      headers: { "content-type": "application/xml" },
    }),
  ]);
  t.mock.method(globalThis, "fetch", fetch);
  await assert.rejects(createS3Exporter({ bucket: "b" }).export(record), {
    name: "UnknownError",
    status: 403,
    message: "Forbidden",
  });
});

test("a client error rejects the export", async () => {
  const client = fakeClient(() => {
    throw Object.assign(new Error("no bucket"), {
      name: "NoSuchBucket",
      status: 404,
    });
  });
  await assert.rejects(
    createS3Exporter({ bucket: "b", client }).export(record),
    {
      name: "NoSuchBucket",
      status: 404,
    },
  );
});

test("maxRecordBytes can be set", () => {
  const exporter = createS3Exporter({
    bucket: "b",
    client: fakeClient(),
    maxRecordBytes: 500,
  });
  assert.equal(exporter.maxRecordBytes, 500);
});
