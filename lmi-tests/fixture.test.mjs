// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { invocation } from "./local-support.mjs";

test("cloud fixture executes the SDK and records real transport boundaries", async () => {
  const records = [];
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ method: request.method, url: request.url });
    if (request.method === "PUT") {
      records.push(JSON.parse(body));
      response.writeHead(200, { ETag: '"test"' });
      response.end();
    } else if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("release");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ CheckpointToken: "next-test-token" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    AWS_REGION: "us-west-2",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_ENDPOINT_URL_S3: endpoint,
    AWS_ENDPOINT_URL_LAMBDA: endpoint,
    LMI_BUCKET: "fixture-test",
    LMI_RUN_ID: "local",
    LMI_COMMIT: "local",
  });
  try {
    // These are real AWS SDK clients against a local HTTP service. Only the
    // service boundary is fake; fixture, wrapper and lifecycle are unmodified.
    const { handler } = await import("./fixture.mjs");
    const result = await handler(invocation("success"), {
      awsRequestId: "fixture-request",
      getRemainingTimeInMillis: () => 60000,
    });
    assert.equal(result.Status, "SUCCEEDED");
    await delay(1200);
    for (const phase of [
      "ENTER",
      "CHECKPOINT",
      "CHECKPOINT_SETTLED",
      "SEND",
      "RETURN",
      "OBSERVED",
    ]) {
      assert(
        records.some((e) => e.phase === phase),
        `Missing ${phase}`,
      );
    }
    assert(records.every((e) => e.request === "fixture-request"));
    assert(
      records
        .filter((e) => e.phase === "CHECKPOINT")
        .every((e) => e.token.length === 64),
    );
    assert(
      requests.some((r) => r.method === "POST" && r.url.includes("checkpoint")),
    );
    assert.equal(new Set(records.map((e) => e.seq)).size, records.length);
    // A retry can encounter the driver's completed latch. It must complete
    // interrupted work without falsely advertising a fresh BLOCKED interval.
    const resumed = invocation("deadline-step");
    resumed.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload =
      JSON.stringify({
        scenario: "deadline-step",
        marker: "deadline-step",
        gates: { loser: "released" },
      });
    const resumedResult = await handler(resumed, {
      awsRequestId: "retry-request",
      getRemainingTimeInMillis: () => 60000,
    });
    assert.equal(resumedResult.Status, "SUCCEEDED");
    const retryEvents = records.filter((e) => e.request === "retry-request");
    assert(retryEvents.some((e) => e.phase === "ALREADY_RELEASED"));
    assert(
      !retryEvents.some(
        (e) => e.phase === "BLOCKED" || e.phase === "FIXTURE_ERROR",
      ),
    );
    // Ordinary admission gates still reject a premature release.
    const invalid = invocation("barrier");
    invalid.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload =
      JSON.stringify({
        scenario: "barrier",
        marker: "barrier",
        gates: { peer: "released" },
      });
    const invalidResult = await handler(invalid, {
      awsRequestId: "invalid-gate-request",
      getRemainingTimeInMillis: () => 60000,
    });
    assert.notEqual(invalidResult.Status, "SUCCEEDED");
    assert(
      !records.some(
        (e) => e.request === "invalid-gate-request" && e.phase === "BLOCKED",
      ),
    );
    assert(
      records.some(
        (e) =>
          e.request === "invalid-gate-request" && e.phase === "FIXTURE_ERROR",
      ),
    );
    await delay(1200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
