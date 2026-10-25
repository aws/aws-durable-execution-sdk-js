import assert from "node:assert/strict";
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
