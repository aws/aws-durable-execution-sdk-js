import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createAwsClient, signRequest } from "../src/aws.js";
import { fakeFetch, jsonResponse as json, setAwsEnv } from "./helpers.js";

// Values from the official AWS SigV4 test suite, as in the lite SDK's sigv4 test.
const base = {
  method: "GET",
  credentials: {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  },
  region: "us-east-1",
  service: "service",
  date: new Date("2015-08-30T12:36:00Z"),
};

test("signRequest: get-vanilla", () => {
  const h = signRequest({ ...base, url: "https://example.amazonaws.com/" });
  assert.equal(h.host, "example.amazonaws.com");
  assert.equal(h["x-amz-date"], "20150830T123600Z");
  assert.equal(
    h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});

test("signRequest: get-vanilla-query-order-key-case", () => {
  const h = signRequest({
    ...base,
    url: new URL("https://example.amazonaws.com/?Param2=value2&Param1=value1"),
  });
  assert.match(
    h.authorization,
    /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/,
  );
});

test("signRequest: a session token is added and signed", () => {
  const h = signRequest({
    ...base,
    url: "https://example.amazonaws.com/",
    credentials: { ...base.credentials, sessionToken: "TOKEN" },
  });
  assert.equal(h["x-amz-security-token"], "TOKEN");
  assert.match(
    h.authorization,
    /SignedHeaders=host;x-amz-date;x-amz-security-token,/,
  );
});

// The "GET Object" and "PUT Object" examples of the AWS S3 documentation, "Signature
// Calculations for the Authorization Header: Transferring Payload in a Single Chunk".
const s3 = {
  credentials: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
  region: "us-east-1",
  service: "s3",
  date: new Date("2013-05-24T00:00:00Z"),
};

test("signRequest: S3 GET Object example", () => {
  const h = signRequest({
    ...s3,
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { Range: "bytes=0-9" },
  });
  assert.equal(
    h["x-amz-content-sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("signRequest: S3 PUT Object example signs the encoded key once", () => {
  // The key is test$file.text. The path carries it encoded once, as /test%24file.text.
  // A second encoding would sign /test%2524file.text.
  const h = signRequest({
    ...s3,
    method: "PUT",
    url: "https://examplebucket.s3.amazonaws.com/test%24file.text",
    headers: {
      Date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
    },
    body: "Welcome to Amazon S3.",
  });
  assert.equal(
    h["x-amz-content-sha256"],
    "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
  );
  assert.match(
    h.authorization,
    /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/,
  );
});

test("signRequest: an S3 key with spaces and a percent sign is signed encoded once", () => {
  // The key is "lite-smoke/aws-client test %.json". The canonical URI must be
  // /lite-smoke/aws-client%20test%20%25.json. A second encoding would sign %2520 and
  // %2525. The expected value comes from that canonical request, built by hand. The
  // client sent a live PUT of this key with the same rules, and S3 accepted it.
  const h = signRequest({
    ...s3,
    method: "PUT",
    url: "https://examplebucket.s3.amazonaws.com/lite-smoke/aws-client%20test%20%25.json",
    body: "{}",
  });
  assert.match(
    h.authorization,
    /Signature=0a477a06a0cbef0a0fc08aa56c50c3ada86b8ee82976e25734e87a4ed8eff549$/,
  );
});

const ENV = {
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKID",
  AWS_SECRET_ACCESS_KEY: "SECRET",
};
const client = (fetch, opts = {}) =>
  createAwsClient({ service: "logs", fetch, retryBaseMs: 1, ...opts });
const request = {
  headers: {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-target": "Logs_20140328.PutLogEvents",
  },
  body: '{"a":1}',
};

test("send POSTs a signed request and returns the parsed JSON", async (t) => {
  setAwsEnv(t, ENV);
  const fetch = fakeFetch([json(200, { nextSequenceToken: "n" })]);
  assert.deepEqual(await client(fetch).send(request), {
    nextSequenceToken: "n",
  });
  const [c] = fetch.calls;
  assert.equal(c.method, "POST");
  assert.equal(c.url.href, "https://logs.us-east-1.amazonaws.com/");
  assert.equal(c.body, '{"a":1}');
  assert.equal(c.headers["content-type"], "application/x-amz-json-1.1");
  assert.equal(c.headers["x-amz-target"], "Logs_20140328.PutLogEvents");
  assert.equal(c.headers.host, undefined);
  assert.equal(c.headers["x-amz-security-token"], undefined);
  assert.match(
    c.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/logs\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target,/,
  );
  assert.ok(c.signal instanceof AbortSignal);
});

test("an empty response body returns {}", async (t) => {
  setAwsEnv(t, ENV);
  assert.deepEqual(await client(fakeFetch([json(200)])).send(request), {});
});

test("method PUT is sent and signed; an s3 client signs the body hash", async (t) => {
  setAwsEnv(t, ENV);
  const fetch = fakeFetch([json(200)]);
  await createAwsClient({
    service: "s3",
    endpoint: "https://bucket.s3.us-east-1.amazonaws.com",
    fetch,
  }).send({ method: "PUT", path: "/a%20b.json", body: '{"a":1}' });
  const [c] = fetch.calls;
  assert.equal(c.method, "PUT");
  assert.equal(
    c.url.href,
    "https://bucket.s3.us-east-1.amazonaws.com/a%20b.json",
  );
  assert.equal(
    c.headers["x-amz-content-sha256"],
    createHash("sha256").update('{"a":1}').digest("hex"),
  );
  assert.match(
    c.headers.authorization,
    /\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date,/,
  );
  // The signature covers the method PUT.
  const date = new Date(
    c.headers["x-amz-date"].replace(
      /(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/,
      "$1-$2-$3T$4:$5:$6Z",
    ),
  );
  const expected = signRequest({
    method: "PUT",
    url: c.url,
    body: '{"a":1}',
    credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
    region: "us-east-1",
    service: "s3",
    date,
  });
  assert.equal(c.headers.authorization, expected.authorization);
});

test("path, region, endpoint and credentials options are used", async (t) => {
  setAwsEnv(t, {});
  const fetch = fakeFetch([json(200, {})]);
  await createAwsClient({
    service: "rds-data",
    region: "eu-west-1",
    endpoint: "http://localhost:4566",
    credentials: { accessKeyId: "K", secretAccessKey: "S", sessionToken: "T" },
    fetch,
  }).send({ path: "/Execute", body: "{}" });
  const [c] = fetch.calls;
  assert.equal(c.url.href, "http://localhost:4566/Execute");
  assert.equal(c.headers["x-amz-security-token"], "T");
  assert.match(
    c.headers.authorization,
    /Credential=K\/\d{8}\/eu-west-1\/rds-data\/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token,/,
  );
});

test("the region defaults to AWS_REGION", async (t) => {
  setAwsEnv(t, { ...ENV, AWS_REGION: "ap-south-1" });
  const fetch = fakeFetch([json(200, {})]);
  await createAwsClient({ service: "rds-data", fetch }).send({ body: "{}" });
  assert.equal(
    fetch.calls[0].url.origin,
    "https://rds-data.ap-south-1.amazonaws.com",
  );
});

test("the session token from the environment is sent and signed", async (t) => {
  setAwsEnv(t, { ...ENV, AWS_SESSION_TOKEN: "SESSION" });
  const fetch = fakeFetch([json(200, {})]);
  await client(fetch).send(request);
  assert.equal(fetch.calls[0].headers["x-amz-security-token"], "SESSION");
  assert.match(fetch.calls[0].headers.authorization, /x-amz-security-token/);
});

test("each request has a timeout signal of timeoutMs", async (t) => {
  setAwsEnv(t, ENV);
  // AbortSignal.timeout uses an unreferenced timer. So the fake polls with a referenced
  // timer, which keeps the test process alive until the signal aborts.
  const fetch = async (_url, init) => {
    while (!init.signal.aborted) await new Promise((r) => setTimeout(r, 5));
    throw init.signal.reason;
  };
  const started = Date.now();
  await assert.rejects(client(fetch, { timeoutMs: 20 }).send(request), {
    name: "TimeoutError",
  });
  // 3 attempts of 20 ms each.
  assert.ok(Date.now() - started >= 55);
});

test("429, 500 and a network error are retried; the third attempt succeeds", async (t) => {
  setAwsEnv(t, ENV);
  for (const first of [json(429, {}), json(500, {}), new TypeError("fetch")]) {
    const fetch = fakeFetch([first, json(503, {}), json(200, { ok: 1 })]);
    assert.deepEqual(await client(fetch).send(request), { ok: 1 });
    assert.equal(fetch.calls.length, 3);
    // Each attempt is signed again.
    assert.ok(fetch.calls[2].headers.authorization);
  }
});

test("5xx gives up after 3 attempts with the error shape", async (t) => {
  setAwsEnv(t, ENV);
  const fetch = fakeFetch([
    json(503, {}),
    json(503, {}),
    json(503, { __type: "com.amazonaws.logs#ServiceUnavailableException" }),
  ]);
  await assert.rejects(client(fetch).send(request), {
    name: "ServiceUnavailableException",
    status: 503,
  });
  assert.equal(fetch.calls.length, 3);
});

test("a network error on the last attempt is rethrown as is", async (t) => {
  setAwsEnv(t, ENV);
  const last = new TypeError("last");
  const fetch = fakeFetch([new TypeError("a"), new TypeError("b"), last]);
  await assert.rejects(client(fetch).send(request), (err) => err === last);
});

test("400 is not retried; the name comes from x-amzn-errortype", async (t) => {
  setAwsEnv(t, ENV);
  const fetch = fakeFetch([
    json(
      400,
      { message: "The specified log group does not exist." },
      {
        "x-amzn-errortype": "ResourceNotFoundException:http://internal",
        "x-amzn-requestid": "rid",
      },
    ),
  ]);
  await assert.rejects(client(fetch).send(request), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.name, "ResourceNotFoundException");
    assert.equal(err.status, 400);
    assert.equal(err.message, "The specified log group does not exist.");
    assert.equal(err.requestId, "rid");
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test("the error name falls back to __type, then code, then UnknownError", async (t) => {
  setAwsEnv(t, ENV);
  const cases = [
    [
      { __type: "ns#ResourceAlreadyExistsException", Message: "m" },
      "ResourceAlreadyExistsException",
      "m",
    ],
    [{ code: "SomeCode" }, "SomeCode", "Bad Request"],
    [undefined, "UnknownError", "Bad Request"],
  ];
  for (const [body, name, message] of cases) {
    const res = new Response(body ? JSON.stringify(body) : "not json", {
      status: 400,
      statusText: "Bad Request",
    });
    await assert.rejects(client(fakeFetch([res])).send(request), {
      name,
      message,
      requestId: undefined,
    });
  }
});

const CONTAINER_ENV = {
  AWS_REGION: "us-east-1",
  AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1:9001/creds",
  AWS_CONTAINER_AUTHORIZATION_TOKEN: "AUTH",
};
const containerCreds = (id, expiresInMs) =>
  json(200, {
    AccessKeyId: id,
    SecretAccessKey: "CSECRET",
    Token: "CTOKEN",
    Expiration: new Date(Date.now() + expiresInMs).toISOString(),
  });

test("without env credentials, the container endpoint is used and cached", async (t) => {
  setAwsEnv(t, CONTAINER_ENV);
  const fetch = fakeFetch([
    containerCreds("CKID", 60 * 60_000),
    json(200, {}),
    json(200, {}),
  ]);
  const c = client(fetch);
  await c.send(request);
  await c.send(request);
  // One credentials request, then two API requests.
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[0].url.href, "http://127.0.0.1:9001/creds");
  assert.equal(fetch.calls[0].headers.authorization, "AUTH");
  assert.ok(fetch.calls[0].signal instanceof AbortSignal);
  for (const call of fetch.calls.slice(1)) {
    assert.match(call.headers.authorization, /Credential=CKID\//);
    assert.equal(call.headers["x-amz-security-token"], "CTOKEN");
  }
});

test("container credentials are fetched again within 5 minutes of expiry", async (t) => {
  setAwsEnv(t, {
    ...CONTAINER_ENV,
    AWS_CONTAINER_AUTHORIZATION_TOKEN: undefined,
  });
  const fetch = fakeFetch([
    containerCreds("K1", 60_000),
    json(200, {}),
    containerCreds("K2", 60_000),
    json(200, {}),
  ]);
  const c = client(fetch);
  await c.send(request);
  await c.send(request);
  assert.equal(fetch.calls[0].headers.authorization, "");
  assert.match(fetch.calls[3].headers.authorization, /Credential=K2\//);
});

test("a failed container credentials request throws; the API is not called", async (t) => {
  setAwsEnv(t, CONTAINER_ENV);
  const fetch = fakeFetch([json(403, { message: "denied" })]);
  await assert.rejects(client(fetch).send(request), {
    message: "Container credentials request failed: HTTP 403",
  });
  assert.equal(fetch.calls.length, 1);
});

test("without any credentials, the request is signed with undefined keys", async (t) => {
  // The service then rejects the request. The exporter's error reaches the plugin,
  // which logs one warning.
  setAwsEnv(t, { AWS_REGION: "us-east-1" });
  const fetch = fakeFetch([json(403, {}, { "x-amzn-errortype": "Denied" })]);
  await assert.rejects(client(fetch).send(request), { name: "Denied" });
  assert.match(fetch.calls[0].headers.authorization, /Credential=undefined\//);
});
