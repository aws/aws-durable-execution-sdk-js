import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createLambdaClient } from "../src/transport/lambda-client.js";
import { VERSION } from "../src/version.js";

const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:f:$LATEST/durable-execution/x/y";
const ENC_ARN = encodeURIComponent(ARN);

const ENV_KEYS = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_LAMBDA",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "AKID";
  process.env.AWS_SECRET_ACCESS_KEY = "SECRET";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function json(status, body, headers = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers,
  });
}

// Returns a fake fetch that records calls and replays the given responses in order.
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

const client = (fetch, opts = {}) =>
  createLambdaClient({ fetch, retryBaseMs: 1, ...opts });

test("checkpoint sends POST with JSON body and signed headers", async () => {
  const fetch = fakeFetch([
    json(200, { CheckpointToken: "t2", NewExecutionState: { Operations: [] } }),
  ]);
  const res = await client(fetch).checkpoint({
    DurableExecutionArn: ARN,
    CheckpointToken: "t1",
    Updates: [{ Id: "a" }],
  });
  assert.deepEqual(res, {
    CheckpointToken: "t2",
    NewExecutionState: { Operations: [] },
  });
  const [c] = fetch.calls;
  assert.equal(c.method, "POST");
  assert.equal(c.url.origin, "https://lambda.us-east-1.amazonaws.com");
  assert.equal(
    c.url.pathname,
    `/2025-12-01/durable-executions/${ENC_ARN}/checkpoint`,
  );
  const body = JSON.parse(c.body);
  assert.equal(body.CheckpointToken, "t1");
  assert.deepEqual(body.Updates, [{ Id: "a" }]);
  assert.match(body.ClientToken, /^[0-9a-f-]{36}$/);
  assert.equal(c.headers["content-type"], "application/json");
  assert.equal(
    c.headers["user-agent"],
    `aws-durable-execution-sdk-js-lite/${VERSION}`,
  );
  assert.match(
    c.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/lambda\/aws4_request/,
  );
  assert.equal(c.headers["x-amz-security-token"], undefined);
  assert.ok(c.signal instanceof AbortSignal);
});

test("getExecutionState sends GET with query and omits undefined params", async () => {
  const fetch = fakeFetch([
    json(200, { Operations: [{ Id: "x", StartTimestamp: 1700000000 }] }),
    json(200, {}),
  ]);
  const c = client(fetch);
  const res = await c.getExecutionState({
    DurableExecutionArn: ARN,
    CheckpointToken: "t",
    Marker: "m",
    MaxItems: 5,
  });
  assert.deepEqual(res, {
    Operations: [{ Id: "x", StartTimestamp: 1700000000 }],
  });
  await c.getExecutionState({ DurableExecutionArn: ARN, CheckpointToken: "t" });
  const [a, b] = fetch.calls;
  assert.equal(a.method, "GET");
  assert.equal(a.body, undefined);
  assert.equal(a.headers["content-type"], undefined);
  assert.equal(
    a.url.pathname,
    `/2025-12-01/durable-executions/${ENC_ARN}/state`,
  );
  assert.equal(a.url.search, "?CheckpointToken=t&Marker=m&MaxItems=5");
  assert.equal(b.url.search, "?CheckpointToken=t");
});

test("500 then 200 retries and reuses ClientToken, re-signing each attempt", async () => {
  const fetch = fakeFetch([
    json(500, { message: "boom" }),
    json(200, { CheckpointToken: "t2" }),
  ]);
  await client(fetch).checkpoint({
    DurableExecutionArn: ARN,
    CheckpointToken: "t1",
    Updates: [],
  });
  assert.equal(fetch.calls.length, 2);
  const [a, b] = fetch.calls.map((c) => JSON.parse(c.body).ClientToken);
  assert.equal(a, b);
  assert.ok(fetch.calls[1].headers.authorization);
});

test("explicit ClientToken is used", async () => {
  const fetch = fakeFetch([json(200, {})]);
  await client(fetch).checkpoint({
    DurableExecutionArn: ARN,
    CheckpointToken: "t",
    Updates: [],
    ClientToken: "ct",
  });
  assert.equal(JSON.parse(fetch.calls[0].body).ClientToken, "ct");
});

test("429 is retried", async () => {
  const fetch = fakeFetch([json(429, {}), json(429, {}), json(200, { ok: 1 })]);
  assert.deepEqual(
    await client(fetch).getExecutionState({ DurableExecutionArn: ARN }),
    { ok: 1 },
  );
  assert.equal(fetch.calls.length, 3);
});

test("5xx gives up after 3 attempts", async () => {
  const fetch = fakeFetch([
    json(503, {}),
    json(503, {}),
    json(503, { __type: "com.amazon#ServiceException" }),
  ]);
  await assert.rejects(
    client(fetch).getExecutionState({ DurableExecutionArn: ARN }),
    {
      name: "ServiceException",
      status: 503,
    },
  );
  assert.equal(fetch.calls.length, 3);
});

test("400 is not retried and has the error shape", async () => {
  const fetch = fakeFetch([
    json(
      400,
      { message: "Invalid checkpoint token" },
      {
        "x-amzn-errortype": "InvalidParameterValueException:http://internal",
        "x-amzn-requestid": "rid",
      },
    ),
  ]);
  await assert.rejects(
    client(fetch).checkpoint({
      DurableExecutionArn: ARN,
      CheckpointToken: "t",
      Updates: [],
    }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, "InvalidParameterValueException");
      assert.equal(err.status, 400);
      assert.equal(err.message, "Invalid checkpoint token");
      assert.equal(err.requestId, "rid");
      return true;
    },
  );
  assert.equal(fetch.calls.length, 1);
});

test("error name falls back to body fields then UnknownError", async () => {
  const cases = [
    [
      { __type: "ns#KMSAccessDeniedException", Message: "m" },
      "KMSAccessDeniedException",
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
    await assert.rejects(
      client(fakeFetch([res])).getExecutionState({ DurableExecutionArn: ARN }),
      { name, message },
    );
  }
});

test("network errors are retried then rethrown as-is", async () => {
  const errs = [
    new TypeError("fetch failed"),
    new TypeError("fetch failed"),
    new TypeError("last"),
  ];
  const fetch = fakeFetch([...errs]);
  await assert.rejects(
    client(fetch).getExecutionState({ DurableExecutionArn: ARN }),
    (err) => err === errs[2],
  );
  assert.equal(fetch.calls.length, 3);
});

test("network error then success", async () => {
  const fetch = fakeFetch([new TypeError("fetch failed"), json(200, { a: 1 })]);
  assert.deepEqual(
    await client(fetch).getExecutionState({ DurableExecutionArn: ARN }),
    { a: 1 },
  );
});

test("endpoint precedence: AWS_ENDPOINT_URL_LAMBDA > AWS_ENDPOINT_URL > default", async () => {
  const origin = async () => {
    const fetch = fakeFetch([json(200, {})]);
    await client(fetch).getExecutionState({ DurableExecutionArn: ARN });
    return fetch.calls[0].url.origin;
  };
  assert.equal(await origin(), "https://lambda.us-east-1.amazonaws.com");
  process.env.AWS_ENDPOINT_URL = "http://general.local:1234";
  assert.equal(await origin(), "http://general.local:1234");
  process.env.AWS_ENDPOINT_URL_LAMBDA = "http://lambda.local:5678";
  assert.equal(await origin(), "http://lambda.local:5678");
});

test("session token header is sent when set", async () => {
  process.env.AWS_SESSION_TOKEN = "SESSION";
  const fetch = fakeFetch([json(200, {})]);
  await client(fetch).getExecutionState({ DurableExecutionArn: ARN });
  assert.equal(fetch.calls[0].headers["x-amz-security-token"], "SESSION");
  assert.match(fetch.calls[0].headers.authorization, /x-amz-security-token/);
});

test("without env credentials, the container credentials endpoint is used and cached", async () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI =
    "http://127.0.0.1:9001/creds";
  process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = "AUTH";
  const expiration = new Date(Date.now() + 60 * 60_000).toISOString();
  const fetch = fakeFetch([
    json(200, {
      AccessKeyId: "CKID",
      SecretAccessKey: "CSECRET",
      Token: "CTOKEN",
      Expiration: expiration,
    }),
    json(200, {}),
    json(200, {}),
  ]);
  const c = client(fetch);
  await c.getExecutionState({ DurableExecutionArn: ARN });
  await c.getExecutionState({ DurableExecutionArn: ARN });
  // One credentials request, then two API requests.
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[0].url.href, "http://127.0.0.1:9001/creds");
  assert.equal(fetch.calls[0].headers.authorization, "AUTH");
  for (const call of fetch.calls.slice(1)) {
    assert.match(call.headers.authorization, /Credential=CKID\//);
    assert.equal(call.headers["x-amz-security-token"], "CTOKEN");
  }
});

test("container credentials are fetched again when they expire within 5 minutes", async () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI =
    "http://127.0.0.1:9001/creds";
  const soon = new Date(Date.now() + 60_000).toISOString();
  const creds = (id) =>
    json(200, {
      AccessKeyId: id,
      SecretAccessKey: "S",
      Token: "T",
      Expiration: soon,
    });
  const fetch = fakeFetch([
    creds("K1"),
    json(200, {}),
    creds("K2"),
    json(200, {}),
  ]);
  const c = client(fetch);
  await c.getExecutionState({ DurableExecutionArn: ARN });
  await c.getExecutionState({ DurableExecutionArn: ARN });
  assert.match(fetch.calls[3].headers.authorization, /Credential=K2\//);
});
