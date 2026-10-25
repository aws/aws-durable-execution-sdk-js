import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRecord } from "../src/index.js";
import { createSQSExporter } from "../src/exporters/sqs.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

const STANDARD = "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry";
const FIFO = "https://sqs.us-east-1.amazonaws.com/123456789012/telemetry.fifo";
const EMITTED_AT = "2026-01-01T00:00:10.000Z";

const makeRecord = (arn = ARN) =>
  buildRecord({
    arn,
    status: "SUCCEEDED",
    emittedAt: new Date(EMITTED_AT),
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
const record = makeRecord();

const sentInput = async (config) => {
  const client = fakeClient();
  await createSQSExporter({ client, ...config }).export(record);
  return client.requests[0].json;
};

test("a standard queue gets one SendMessage with the record as the body and no ids", async () => {
  const client = fakeClient();
  const exporter = createSQSExporter({ queueUrl: STANDARD, client });
  assert.equal(exporter.maxRecordBytes, 256_000);
  await exporter.export(record);
  assert.equal(client.requests.length, 1);
  const [request] = client.requests;
  assert.equal(request.path, "/");
  assert.deepEqual(request.headers, {
    "content-type": "application/x-amz-json-1.0",
    "x-amz-target": "AmazonSQS.SendMessage",
  });
  assert.deepEqual(request.json, {
    QueueUrl: STANDARD,
    MessageBody: JSON.stringify(record),
    MessageAttributes: {
      status: { DataType: "String", StringValue: "SUCCEEDED" },
      functionName: { DataType: "String", StringValue: "workflow" },
    },
  });
  // The body keeps the operations array, as the full SDK's default "array" format.
  assert.equal(
    JSON.parse(request.json.MessageBody).operations[0].name,
    "charge",
  );
});

test("a FIFO queue groups by executionArn and deduplicates by executionArn:emittedAt", async () => {
  const input = await sentInput({ queueUrl: FIFO });
  assert.ok(`${ARN}:${EMITTED_AT}`.length <= 128);
  assert.equal(input.MessageGroupId, ARN);
  assert.equal(input.MessageDeduplicationId, `${ARN}:${EMITTED_AT}`);
  assert.equal(input.MessageBody, JSON.stringify(record));
});

test("messageGroupId sets the FIFO group; an empty one counts as omitted", async () => {
  const custom = await sentInput({ queueUrl: FIFO, messageGroupId: "orders" });
  assert.equal(custom.MessageGroupId, "orders");
  const empty = await sentInput({ queueUrl: FIFO, messageGroupId: "" });
  assert.equal(empty.MessageGroupId, ARN);
  const standard = await sentInput({ queueUrl: STANDARD, messageGroupId: "x" });
  assert.equal(standard.MessageGroupId, undefined);
});

test("FIFO ids over 128 characters become their SHA-256 hex digests", async () => {
  // The full SDK's test computed these digests with Python's hashlib.
  const LONG_ARN =
    "arn:aws:lambda:us-east-1:123456789012:function:order-processor:$LATEST/durable-execution/order-bdd640fb0667/23b8c1e9-3924-46de-beb1-3b9046685257";
  const GROUP_DIGEST =
    "170a1c1ff1dda2b2794acd77c3ae7bb96d09b3a38a1b9b16908fcde381801e4d";
  const DEDUP_DIGEST =
    "f9c598b766c105226add0b8a43d72bb84a567ff7d3cf630f41ee53d326ecc1c6";
  const client = fakeClient();
  const exporter = createSQSExporter({ queueUrl: FIFO, client });
  await exporter.export(makeRecord(LONG_ARN));
  const input = client.requests[0].json;
  assert.equal(input.MessageGroupId, GROUP_DIGEST);
  assert.equal(input.MessageDeduplicationId, DEDUP_DIGEST);
  assert.equal(JSON.parse(input.MessageBody).executionArn, LONG_ARN);

  const explicit = await sentInput({
    queueUrl: FIFO,
    messageGroupId: LONG_ARN,
  });
  assert.equal(explicit.MessageGroupId, GROUP_DIGEST);
  // 128 characters is the limit itself, so it is sent unchanged.
  const atLimit = "a".repeat(128);
  const kept = await sentInput({ queueUrl: FIFO, messageGroupId: atLimit });
  assert.equal(kept.MessageGroupId, atLimit);
  const over = await sentInput({
    queueUrl: FIFO,
    messageGroupId: "a".repeat(129),
  });
  assert.match(over.MessageGroupId, /^[0-9a-f]{64}$/);
});

test("the built-in client sends a signed AWS JSON 1.0 request to SQS", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
    AWS_SESSION_TOKEN: "TOKEN",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-03-04T05:06:07.000Z"),
  });
  const fetch = fakeFetch([json(200, { MessageId: "m" })]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createSQSExporter({ queueUrl: FIFO }).export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url.href, "https://sqs.us-west-2.amazonaws.com/");
  assert.equal(call.headers["content-type"], "application/x-amz-json-1.0");
  assert.equal(call.headers["x-amz-target"], "AmazonSQS.SendMessage");
  assert.match(
    call.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20260304\/us-west-2\/sqs\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/,
  );
  const body = JSON.parse(call.body);
  assert.equal(body.QueueUrl, FIFO);
  assert.equal(body.MessageGroupId, ARN);
});

test("region and endpoint options reach the built-in client", async (t) => {
  setAwsEnv(t, { AWS_ACCESS_KEY_ID: "AKID", AWS_SECRET_ACCESS_KEY: "SECRET" });
  const fetch = fakeFetch([json(200, {})]);
  t.mock.method(globalThis, "fetch", fetch);
  await createSQSExporter({
    queueUrl: STANDARD,
    region: "eu-west-1",
    endpoint: "http://localhost:4566",
  }).export(record);
  assert.equal(fetch.calls[0].url.href, "http://localhost:4566/");
  assert.match(
    fetch.calls[0].headers.authorization,
    /\/eu-west-1\/sqs\/aws4_request/,
  );
});

test("an SQS error response rejects the export", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  const fetch = fakeFetch([
    json(
      400,
      {
        __type: "com.amazonaws.sqs#QueueDoesNotExist",
        message: "The specified queue does not exist.",
      },
      { "x-amzn-requestid": "rid" },
    ),
  ]);
  t.mock.method(globalThis, "fetch", fetch);
  await assert.rejects(
    createSQSExporter({ queueUrl: STANDARD }).export(record),
    {
      name: "QueueDoesNotExist",
      status: 400,
      message: "The specified queue does not exist.",
      requestId: "rid",
    },
  );
});

test("maxRecordBytes can be set", () => {
  const exporter = createSQSExporter({ queueUrl: STANDARD, maxRecordBytes: 1 });
  assert.equal(exporter.maxRecordBytes, 1);
});
