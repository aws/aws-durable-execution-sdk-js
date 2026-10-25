import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { createOpenSearchExporter } from "../src/exporters/opensearch.js";
import { buildRecord } from "../src/index.js";
import {
  ARN,
  fakeClient,
  fakeFetch,
  jsonResponse as json,
  setAwsEnv,
} from "./helpers.js";

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

// The ARN of the helpers, encoded once: ":" is %3A, "/" is %2F and "$" is %24.
const DOC_ID =
  "arn%3Aaws%3Alambda%3Aus-east-1%3A123456789012%3Afunction%3Aworkflow%3A%24LATEST%2Fdurable-execution%2Flocal%2Frun";

test("each export PUTs the record to /<index>/_doc/<encoded executionArn>", async () => {
  const client = fakeClient();
  const exporter = createOpenSearchExporter({ client });
  assert.equal(exporter.maxRecordBytes, 10_000_000);
  await exporter.export(record);
  await exporter.export({ ...record, status: "FAILED" });
  // Both records of the execution go to the same document. So the newer one replaces it.
  assert.equal(client.requests.length, 2);
  for (const request of client.requests) {
    assert.equal(request.method, "PUT");
    assert.equal(request.path, `/durable-execution-telemetry/_doc/${DOC_ID}`);
    assert.deepEqual(request.headers, { "content-type": "application/json" });
  }
  // The record as is, with the operations array.
  assert.equal(client.requests[0].body, JSON.stringify(record));
  assert.equal(client.requests[0].json.operations[0].name, "charge");
  assert.equal(client.requests[1].json.status, "FAILED");
});

test("indexName and maxRecordBytes can be set; the id encodes !'()* too", async () => {
  const client = fakeClient();
  const exporter = createOpenSearchExporter({
    indexName: "telemetry-v1",
    client,
    maxRecordBytes: 500,
  });
  assert.equal(exporter.maxRecordBytes, 500);
  await exporter.export({ ...record, executionArn: "a:b/c (1)!*'" });
  assert.equal(
    client.requests[0].path,
    "/telemetry-v1/_doc/a%3Ab%2Fc%20%281%29%21%2A%27",
  );
});

test("the built-in client sends a PUT signed for es, with the path encoded twice", async (t) => {
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
  // OpenSearch answers an index request with a JSON body.
  const fetch = fakeFetch([json(201, { result: "created" })]);
  // The default client reads globalThis.fetch when the exporter is created.
  t.mock.method(globalThis, "fetch", fetch);
  await createOpenSearchExporter({
    endpoint: "https://my-domain.eu-central-1.es.amazonaws.com",
    region: "eu-central-1",
  }).export(record);
  assert.equal(fetch.calls.length, 1);
  const [call] = fetch.calls;
  assert.equal(call.method, "PUT");
  assert.equal(
    call.url.href,
    `https://my-domain.eu-central-1.es.amazonaws.com/durable-execution-telemetry/_doc/${DOC_ID}`,
  );
  assert.equal(call.body, JSON.stringify(record));
  // Only S3 signs x-amz-content-sha256.
  assert.equal(call.headers["x-amz-content-sha256"], undefined);

  // The canonical request, built by hand. Non-S3 services sign each path segment encoded
  // once more, so "%" becomes "%25".
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const canonical = [
    "PUT",
    `/durable-execution-telemetry/_doc/${DOC_ID.replaceAll("%", "%25")}`,
    "",
    "content-type:application/json",
    "host:my-domain.eu-central-1.es.amazonaws.com",
    "x-amz-date:20260305T000010Z",
    "x-amz-security-token:TOKEN",
    "",
    "content-type;host;x-amz-date;x-amz-security-token",
    hash(call.body),
  ].join("\n");
  const scope = "20260305/eu-central-1/es/aws4_request";
  let key = createHmac("sha256", "AWS4SECRET").update("20260305").digest();
  for (const part of ["eu-central-1", "es", "aws4_request"]) {
    key = createHmac("sha256", key).update(part).digest();
  }
  const signature = createHmac("sha256", key)
    .update(
      ["AWS4-HMAC-SHA256", "20260305T000010Z", scope, hash(canonical)].join(
        "\n",
      ),
    )
    .digest("hex");
  assert.equal(
    call.headers.authorization,
    `AWS4-HMAC-SHA256 Credential=AKID/${scope}, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=${signature}`,
  );
});

test("an OpenSearch error rejects with the status and the status text", async (t) => {
  setAwsEnv(t, {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  });
  // An OpenSearch error body has "error" and "status", but no "message" field. So the
  // client's message is the status text, and the reason is lost.
  const body = {
    error: { type: "mapper_parsing_exception", reason: "failed to parse" },
    status: 400,
  };
  const fetch = fakeFetch([
    new Response(JSON.stringify(body), {
      status: 400,
      statusText: "Bad Request",
    }),
  ]);
  t.mock.method(globalThis, "fetch", fetch);
  await assert.rejects(
    createOpenSearchExporter({
      endpoint: "https://d.us-east-1.es.amazonaws.com",
    }).export(record),
    { name: "UnknownError", status: 400, message: "Bad Request" },
  );
});
