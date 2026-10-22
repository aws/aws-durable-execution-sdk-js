import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalUri, signRequest } from "../src/transport/sigv4.js";

// Values from the official AWS SigV4 test suite.
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

test("get-vanilla", () => {
  const h = signRequest({ ...base, url: "https://example.amazonaws.com/" });
  assert.equal(h.host, "example.amazonaws.com");
  assert.equal(h["x-amz-date"], "20150830T123600Z");
  assert.equal(
    h.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});

test("get-vanilla-query-order-key-case", () => {
  const h = signRequest({
    ...base,
    url: new URL("https://example.amazonaws.com/?Param2=value2&Param1=value1"),
  });
  assert.match(
    h.authorization,
    /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/,
  );
});

test("session token is added and signed", () => {
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

test("canonical URI double-encodes an encoded ARN", () => {
  const arn =
    "arn:aws:lambda:us-east-1:123456789012:function:f:$LATEST/durable-execution/x/y";
  const path = `/2025-12-01/durable-executions/${encodeURIComponent(arn)}/checkpoint`;
  const uri = canonicalUri(path);
  assert.equal(
    uri,
    "/2025-12-01/durable-executions/arn%253Aaws%253Alambda%253Aus-east-1%253A123456789012%253Afunction%253Af%253A%2524LATEST%252Fdurable-execution%252Fx%252Fy/checkpoint",
  );
  assert.equal(canonicalUri("/"), "/");
});
