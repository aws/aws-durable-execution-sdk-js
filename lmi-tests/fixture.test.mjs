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
  const checkpointCalls = [];
  const controls = new Map([
    ["checkpoint-loser", "hold"],
    ["checkpoint-transport", "hold"],
  ]);
  let heldGate = "hold";
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
      const controlled = [...controls].find(([key]) =>
        request.url.includes(key),
      );
      response.end(
        controlled
          ? controlled[1]
          : request.url.includes("release-all")
            ? "hold"
            : request.url.includes("hold-probe")
              ? heldGate
              : "release",
      );
    } else {
      checkpointCalls.push({
        path: decodeURIComponent(request.url),
        ...JSON.parse(body),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ CheckpointToken: "next-test-token" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  assert.equal(server.address().address, "127.0.0.1");
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
    assert.equal(resumedResult.Result, JSON.stringify("deadline-step"));
    const retryEvents = records.filter((e) => e.request === "retry-request");
    assert(retryEvents.some((e) => e.phase === "ALREADY_RELEASED"));
    assert(
      retryEvents.some(
        (e) => e.phase === "BODY" && e.operation === "after-deadline",
      ),
    );
    assert(
      !retryEvents.some(
        (e) => e.phase === "BLOCKED" || e.phase === "FIXTURE_ERROR",
      ),
    );
    // A checkpoint fault holds an acknowledged blocked/SUCCEED response.
    // Replay consumes that accepted state and must not revisit released gates.
    const checkpointInput = invocation("deadline-checkpoint");
    checkpointInput.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload =
      JSON.stringify({
        scenario: "deadline-checkpoint",
        marker: "deadline-checkpoint",
        gates: { loser: "checkpoint-loser", transport: "checkpoint-transport" },
      });
    const checkpointOriginal = handler(checkpointInput, {
      awsRequestId: "checkpoint-original",
      getRemainingTimeInMillis: () => 60000,
    });
    const waitForGate = async (gate) => {
      for (let i = 0; i < 300; i++) {
        if (
          records.some(
            (e) =>
              e.request === "checkpoint-original" &&
              e.phase === "BLOCKED" &&
              e.gate === gate,
          )
        )
          return;
        await delay(10);
      }
      assert.fail(`Checkpoint original never held ${gate}`);
    };
    let acceptedSteps;
    try {
      await waitForGate("loser");
      controls.set("checkpoint-loser", "release");
      await waitForGate("transport");
      acceptedSteps = checkpointCalls
        .filter((call) =>
          call.path.includes(checkpointInput.DurableExecutionArn),
        )
        .flatMap((call) => call.Updates ?? [])
        .filter(
          (update) => update.Type === "STEP" && update.Action === "SUCCEED",
        )
        .map((update) => ({
          Id: update.Id,
          Name: update.Name,
          Type: update.Type,
          SubType: update.SubType,
          ParentId: update.ParentId,
          Status: "SUCCEEDED",
          StartTimestamp: new Date(),
          EndTimestamp: new Date(),
          StepDetails: { Result: update.Payload },
        }));
      assert.deepEqual(acceptedSteps.map((step) => step.Name).sort(), [
        "blocked",
        "success",
      ]);
    } finally {
      controls.set("checkpoint-loser", "release");
      controls.set("checkpoint-transport", "release");
      await checkpointOriginal;
    }
    const checkpointReplay = structuredClone(checkpointInput);
    checkpointReplay.CheckpointToken = "checkpoint-retry-token";
    checkpointReplay.InitialExecutionState.Operations.push(...acceptedSteps);
    const requestsBeforeReplay = requests.length;
    const checkpointResult = await handler(checkpointReplay, {
      awsRequestId: "checkpoint-retry",
      getRemainingTimeInMillis: () => 60000,
    });
    assert.equal(
      checkpointResult.Status,
      "SUCCEEDED",
      JSON.stringify(checkpointResult),
    );
    assert.equal(
      checkpointResult.Result,
      JSON.stringify("deadline-checkpoint"),
    );
    const checkpointRetryEvents = records.filter(
      (event) => event.request === "checkpoint-retry",
    );
    assert.deepEqual(
      checkpointRetryEvents
        .filter((event) => event.phase === "BODY")
        .map((event) => event.operation),
      ["after-deadline"],
    );
    assert(
      !checkpointRetryEvents.some((event) =>
        ["BLOCKED", "ALREADY_RELEASED", "FIXTURE_ERROR"].includes(event.phase),
      ),
    );
    assert(
      !requests
        .slice(requestsBeforeReplay)
        .some(
          (request) =>
            request.method === "GET" &&
            [...controls.keys()].some((gate) => request.url.includes(gate)),
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
    const diagnostics = () =>
      handler(invocation("quiescence"), {
        awsRequestId: `diagnostic-${records.length}`,
        getRemainingTimeInMillis: () => 60000,
      });
    assert.deepEqual(JSON.parse((await diagnostics()).Result).requests, []);
    const held = invocation("barrier");
    held.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload =
      JSON.stringify({
        scenario: "barrier",
        marker: "held",
        gates: { peer: "hold-probe" },
      });
    const running = handler(held, {
      awsRequestId: "held-request",
      getRemainingTimeInMillis: () => 60000,
    });
    try {
      for (
        let i = 0;
        i < 200 &&
        !records.some(
          (e) => e.request === "held-request" && e.phase === "BLOCKED",
        );
        i++
      )
        await delay(10);
      const state = JSON.parse((await diagnostics()).Result);
      const active = state.requests.find((r) => r.request === "held-request");
      assert.equal(active.active.holds, 1);
      assert.equal(active.active.invocations, 1);
    } finally {
      heldGate = "release";
      await running;
      await delay(1200);
    }
    assert.deepEqual(JSON.parse((await diagnostics()).Result).requests, []);
    await delay(1200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
